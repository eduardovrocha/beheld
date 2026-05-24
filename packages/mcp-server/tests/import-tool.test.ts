import { test, expect, describe } from "bun:test";

import {
  formatImportResult,
  formatImportUsage,
  handleImport,
  type ImportDeps,
} from "../src/tools/beheld-tool";
import type {
  ImportInitResponse,
  ImportResult,
  ImportStatusResponse,
} from "../src/types/import";

// ── Test harness ─────────────────────────────────────────────────────────────

interface MockEngineOptions {
  health?: { ok: boolean } | null;
  /** If set, the call to importRepository throws on invocation. */
  importThrows?: boolean;
  /** Sequence of polling responses, consumed in order. The last one is reused
   *  indefinitely if polling outlives the array. */
  statusSequence?: ImportStatusResponse[];
  /** If set, getImportStatus throws on every call. */
  statusThrows?: boolean;
}

interface MockEngine {
  client: ImportDeps["engine"];
  importCalls: Array<{
    repoUrl: string;
    authorEmail: string;
    pat: string | null;
  }>;
  statusCalls: number;
  healthCalls: number;
}

function makeEngine(opts: MockEngineOptions = {}): MockEngine {
  const importCalls: MockEngine["importCalls"] = [];
  let statusIndex = 0;
  const m: MockEngine = {
    importCalls,
    statusCalls: 0,
    healthCalls: 0,
    client: {
      async health() {
        m.healthCalls += 1;
        return opts.health === undefined ? { ok: true } : opts.health;
      },
      async importRepository(
        repoUrl: string,
        authorEmail: string,
        pat: string | null,
      ): Promise<ImportInitResponse> {
        importCalls.push({ repoUrl, authorEmail, pat });
        if (opts.importThrows) throw new Error("network down");
        return { status: "processing", repo_url: repoUrl };
      },
      async getImportStatus(): Promise<ImportStatusResponse> {
        m.statusCalls += 1;
        if (opts.statusThrows) throw new Error("network blip");
        const seq = opts.statusSequence ?? [];
        if (seq.length === 0) {
          return { status: "idle", repo_url: null, progress_pct: 0, result: null };
        }
        const idx = Math.min(statusIndex, seq.length - 1);
        statusIndex += 1;
        return seq[idx];
      },
    } as unknown as ImportDeps["engine"],
  };
  return m;
}

const fastSleep = (): Promise<void> => Promise.resolve();

function depsWith(engine: MockEngine, email: string | null = "dev@example.com"): ImportDeps {
  return {
    engine: engine.client,
    sleep: fastSleep,
    pollIntervalMs: 1,
    timeoutMs: 1_000,
    readAuthorEmail: () => email,
  };
}

function done(result: ImportResult): ImportStatusResponse {
  const terminal = result.status === "imported" || result.status === "already_imported"
    ? "done"
    : "error";
  return {
    status: terminal,
    repo_url: "https://example.test/r",
    progress_pct: 100,
    result,
  };
}

const RUNNING: ImportStatusResponse = {
  status: "processing",
  repo_url: "https://example.test/r",
  progress_pct: 40,
  result: null,
};

// ── handleImport — URL gating ────────────────────────────────────────────────

describe("handleImport — URL gating", () => {
  test("test_import_action_url_empty_returns_usage_message", async () => {
    const engine = makeEngine();
    const out = await handleImport("", depsWith(engine));
    expect(out).toBe(formatImportUsage());
    expect(engine.importCalls.length).toBe(0);
  });

  test("test_import_action_url_undefined_returns_usage_message", async () => {
    const engine = makeEngine();
    const out = await handleImport(undefined, depsWith(engine));
    expect(out).toBe(formatImportUsage());
    expect(engine.importCalls.length).toBe(0);
  });
});

// ── handleImport — preconditions ─────────────────────────────────────────────

describe("handleImport — engine availability", () => {
  test("test_import_action_engine_offline_returns_start_hint", async () => {
    const engine = makeEngine({ health: null });
    const out = await handleImport("https://github.com/u/r", depsWith(engine));
    expect(out).toContain("Engine offline");
    expect(out).toContain("beheld start");
    expect(engine.importCalls.length).toBe(0);
  });

  test("test_import_action_engine_post_throws_returns_offline_hint", async () => {
    const engine = makeEngine({ importThrows: true });
    const out = await handleImport("https://github.com/u/r", depsWith(engine));
    expect(out).toContain("Engine offline");
  });
});

describe("handleImport — author email gate", () => {
  test("test_import_action_no_author_email_returns_wizard_hint", async () => {
    const engine = makeEngine();
    const out = await handleImport("https://github.com/u/r", depsWith(engine, null));
    expect(out).toContain("Email de commit não configurado");
    expect(out).toContain("beheld import");
    expect(engine.importCalls.length).toBe(0);
  });
});

// ── handleImport — terminal states from polling ──────────────────────────────

describe("handleImport — terminal states", () => {
  test("test_import_action_needs_pat_returns_terminal_instruction", async () => {
    const engine = makeEngine({
      statusSequence: [done({ status: "needs_pat" })],
    });
    const out = await handleImport("https://github.com/u/r", depsWith(engine));
    expect(out).toContain("Repositório privado");
    expect(out).toContain("https://github.com/u/r");
    expect(out).toContain("beheld import");
  });

  test("test_import_action_already_imported_returns_message", async () => {
    const engine = makeEngine({
      statusSequence: [done({ status: "already_imported", root_commit_hash: "abc" })],
    });
    const out = await handleImport("https://github.com/u/r", depsWith(engine));
    expect(out).toContain("Já importado");
    expect(out).toContain("https://github.com/u/r");
  });

  test("test_import_action_author_not_found_returns_hint_with_email", async () => {
    const engine = makeEngine({
      statusSequence: [done({ status: "author_not_found" })],
    });
    const out = await handleImport("https://github.com/u/r", depsWith(engine, "alice@x.io"));
    expect(out).toContain("alice@x.io");
    expect(out).toContain("https://github.com/u/r");
    expect(out).toContain("config.json");
  });

  test("test_import_action_clone_error_returns_error_message", async () => {
    const engine = makeEngine({
      statusSequence: [done({ status: "clone_error", detail: "404" })],
    });
    const out = await handleImport("https://github.com/u/bad", depsWith(engine));
    expect(out).toContain("Não foi possível clonar");
    expect(out).toContain("https://github.com/u/bad");
  });

  test("test_import_action_polls_until_done_and_formats_result", async () => {
    const finalResult: ImportResult = {
      status: "imported",
      root_commit_hash: "deadbeef",
      commit_count: 847,
      ecosystems: ["rails", "python", "docker"],
      test_ratio: 0.38,
      first_commit_at: "2019-03-14T00:00:00Z",
      last_commit_at: "2026-05-23T00:00:00Z",
    };
    const engine = makeEngine({
      statusSequence: [RUNNING, RUNNING, RUNNING, done(finalResult)],
    });
    const out = await handleImport("https://github.com/u/r", depsWith(engine));
    // Must have waited through all three running iterations + final done.
    expect(engine.statusCalls).toBe(4);
    expect(out).toContain("✓ https://github.com/u/r");
    expect(out).toContain("847 commits");
    expect(out).toContain("rails, python, docker");
    expect(out).toContain("test ratio: 38%");
    expect(out).toContain("período: 2019-03 → 2026-05");
    expect(out).toContain("Perfil atualizado");
  });

  test("test_import_action_timeout_returns_background_message", async () => {
    // Always-running engine — polling never observes a terminal state.
    const engine = makeEngine({ statusSequence: [RUNNING] });
    const out = await handleImport("https://github.com/u/r", {
      engine: engine.client,
      sleep: fastSleep,
      pollIntervalMs: 1,
      timeoutMs: 5, // budget exhausts immediately
      readAuthorEmail: () => "dev@example.com",
    });
    expect(out).toContain("Importação em andamento");
    expect(out).toContain("background");
    expect(out).toContain("beheld import --list");
  });

  test("test_import_action_error_state_returns_error", async () => {
    const engine = makeEngine({
      statusSequence: [
        {
          status: "error",
          repo_url: "https://example.test/r",
          progress_pct: 100,
          // No `result` payload — surface a generic failure.
          result: null,
        },
      ],
    });
    const out = await handleImport("https://github.com/u/r", depsWith(engine));
    expect(out).toContain("Falha na importação");
  });
});

// ── formatImportResult — purely a formatter ──────────────────────────────────

describe("formatImportResult", () => {
  test("test_import_result_truncates_ecosystems_beyond_5", () => {
    const out = formatImportResult("https://example.test/r", {
      status: "imported",
      commit_count: 12,
      ecosystems: ["a", "b", "c", "d", "e", "f", "g"],
      test_ratio: 0.5,
      first_commit_at: "2020-01-01T00:00:00Z",
      last_commit_at: "2026-05-01T00:00:00Z",
    });
    expect(out).toContain("a, b, c, d, e, ...");
    // The 6th and 7th entries must not appear individually.
    expect(out).not.toMatch(/\b, f\b/);
    expect(out).not.toMatch(/\b, g\b/);
  });

  test("test_import_result_omits_periodo_when_dates_absent", () => {
    const out = formatImportResult("https://example.test/r", {
      status: "imported",
      commit_count: 5,
      ecosystems: ["python"],
      test_ratio: 0.2,
    });
    expect(out).not.toContain("período");
  });

  test("test_import_result_omits_periodo_when_only_one_date_present", () => {
    const out = formatImportResult("https://example.test/r", {
      status: "imported",
      commit_count: 5,
      first_commit_at: "2020-01-01T00:00:00Z",
    });
    expect(out).not.toContain("período");
  });

  test("test_import_result_omits_test_ratio_when_absent", () => {
    const out = formatImportResult("https://example.test/r", {
      status: "imported",
      commit_count: 3,
    });
    expect(out).not.toContain("test ratio");
  });
});

// ── Retro-compat: action="view" surface untouched ────────────────────────────

describe("beheld tool — view action retrocompatibility", () => {
  const MOCK_PORT = 17455;
  let server: ReturnType<typeof Bun.serve> | null = null;

  function startMockEngine(): void {
    server = Bun.serve({
      port: MOCK_PORT,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        const json = (d: unknown): Response =>
          new Response(JSON.stringify(d), {
            headers: { "Content-Type": "application/json" },
          });
        if (url.pathname === "/scores/current")
          return json({
            prompt_quality: 80,
            test_maturity: 60,
            tech_breadth: 70,
            growth_rate: 65,
            overall: 69,
            sessions_analyzed: 5,
            updated_at: "2026-05-23T00:00:00Z",
          });
        if (url.pathname === "/insights")
          return json({ insights: ["foo"], generated_at: null });
        if (url.pathname === "/profile/readiness")
          return json({
            ready: true,
            sessions_count: 5,
            sessions_required: 3,
            sessions_remaining: 0,
          });
        if (url.pathname === "/profile/summary")
          return json({
            total_sessions: 5,
            platforms: [],
            ecosystems: [],
            workflow_distribution: {},
            project_categories: {},
          });
        if (url.pathname === "/health") return json({ ok: true });
        return new Response("Not Found", { status: 404 });
      },
    });
  }

  test("test_view_action_unaffected_by_new_action_param", async () => {
    startMockEngine();
    try {
      const saved = process.env.BEHELD_ENGINE_URL;
      process.env.BEHELD_ENGINE_URL = `http://127.0.0.1:${MOCK_PORT}`;
      const mod = await import("../src/tools/beheld-tool?v=retro1");
      const out = (await mod.beheldTool.handler({ action: "view", view: "scores" })) as string;
      expect(out).toContain("Prompt quality");
      expect(out).toContain("Tech breadth");
      process.env.BEHELD_ENGINE_URL = saved;
    } finally {
      server?.stop(true);
      server = null;
    }
  });

  test("test_view_action_default_when_action_omitted", async () => {
    startMockEngine();
    try {
      const saved = process.env.BEHELD_ENGINE_URL;
      process.env.BEHELD_ENGINE_URL = `http://127.0.0.1:${MOCK_PORT}`;
      const mod = await import("../src/tools/beheld-tool?v=retro2");
      const out = (await mod.beheldTool.handler({})) as string;
      expect(out).toContain("69/100");
      process.env.BEHELD_ENGINE_URL = saved;
    } finally {
      server?.stop(true);
      server = null;
    }
  });
});
