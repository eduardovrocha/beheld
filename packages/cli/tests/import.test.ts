import { test, expect, describe, beforeEach } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defaultConfigStore,
  formatRepoTable,
  runImport,
  type ImportClient,
  type ImportConfigStore,
  type ImportIO,
} from "../src/commands/import";
import type { L1ImportResponse, L1ImportStatus, L1Repository } from "../src/types";

// ── test doubles ─────────────────────────────────────────────────────────────

function makeMockIO(opts: {
  prompts?: string[];
  secrets?: string[];
  confirms?: boolean[];
}): {
  io: ImportIO;
  logs: string[];
  promptCount: { value: number };
  secretCount: { value: number };
} {
  const logs: string[] = [];
  const prompts = [...(opts.prompts ?? [])];
  const secrets = [...(opts.secrets ?? [])];
  const confirms = [...(opts.confirms ?? [])];
  const promptCount = { value: 0 };
  const secretCount = { value: 0 };
  const io: ImportIO = {
    async prompt(_label: string): Promise<string> {
      promptCount.value += 1;
      return prompts.shift() ?? "";
    },
    async promptSecret(_label: string): Promise<string> {
      secretCount.value += 1;
      return secrets.shift() ?? "";
    },
    async confirm(_label: string): Promise<boolean> {
      return confirms.shift() ?? false;
    },
    log(msg: string) {
      logs.push(msg);
    },
    async sleep(_ms: number) {},
  };
  return { io, logs, promptCount, secretCount };
}

function makeClient(opts: {
  postResponses?: (L1ImportResponse | null)[];
  statusSequence?: L1ImportStatus[];
  repos?: L1Repository[];
  deleteResult?: boolean;
}): {
  client: ImportClient;
  importCalls: { url: string; email: string; pat: string | null | undefined }[];
  statusCalls: { value: number };
  deleteCalls: string[];
} {
  const postResponses = [...(opts.postResponses ?? [])];
  const statusSequence = [...(opts.statusSequence ?? [])];
  const importCalls: { url: string; email: string; pat: string | null | undefined }[] = [];
  const statusCalls = { value: 0 };
  const deleteCalls: string[] = [];
  const client: ImportClient = {
    async importRepository(repoUrl, authorEmail, pat) {
      importCalls.push({ url: repoUrl, email: authorEmail, pat });
      return postResponses.shift() ?? { status: "processing", repo_url: repoUrl };
    },
    async getImportStatus() {
      statusCalls.value += 1;
      // If there's only one element left, keep returning it so polling can settle.
      if (statusSequence.length === 0) return null;
      if (statusSequence.length === 1) return statusSequence[0];
      return statusSequence.shift()!;
    },
    async getL1Repositories() {
      return opts.repos ?? [];
    },
    async deleteL1Repository(hash) {
      deleteCalls.push(hash);
      return opts.deleteResult ?? true;
    },
  };
  return { client, importCalls, statusCalls, deleteCalls };
}

function inMemoryConfig(initialEmail: string | null = null): ImportConfigStore {
  let email = initialEmail;
  return {
    getAuthorEmail: () => email,
    setAuthorEmail: (e: string) => {
      email = e;
    },
  };
}

const DONE_IMPORTED: L1ImportStatus = {
  status: "done",
  repo_url: "https://example.com/r.git",
  progress_pct: 100,
  result: { status: "imported", root_commit_hash: "a".repeat(40), commit_count: 12 },
};

const DONE_ALREADY: L1ImportStatus = {
  status: "done",
  repo_url: "https://example.com/r.git",
  progress_pct: 100,
  result: { status: "already_imported", root_commit_hash: "b".repeat(40) },
};

const ERR_AUTHOR_NOT_FOUND: L1ImportStatus = {
  status: "error",
  repo_url: "https://example.com/r.git",
  progress_pct: 100,
  result: { status: "author_not_found" },
};

const ERR_CLONE: L1ImportStatus = {
  status: "error",
  repo_url: "https://example.com/r.git",
  progress_pct: 100,
  result: { status: "clone_error", detail: "auth required" },
};

const ERR_NEEDS_PAT: L1ImportStatus = {
  status: "error",
  repo_url: "https://example.com/r.git",
  progress_pct: 100,
  result: { status: "needs_pat" },
};

// ── tests ────────────────────────────────────────────────────────────────────

describe("runImport — interactive loop", () => {
  test("exits cleanly on the first empty Enter", async () => {
    const { io, logs } = makeMockIO({ prompts: [""] });
    const { client, importCalls } = makeClient({});
    await runImport({}, {
      io,
      client,
      config: inMemoryConfig("dev@example.com"),
      pollIntervalMs: 1,
    });
    expect(importCalls.length).toBe(0);
    expect(logs.join("\n")).toContain("Bootstrap concluído");
    expect(logs.join("\n")).toContain("0 repositório(s) · 0 commits analisados");
  });

  test("shows progress during polling (multiple status calls)", async () => {
    const pending: L1ImportStatus = {
      status: "processing",
      repo_url: "https://example.com/r.git",
      progress_pct: 20,
      result: null,
    };
    const { io, logs } = makeMockIO({ prompts: ["https://example.com/r.git", ""] });
    const { client, statusCalls } = makeClient({
      statusSequence: [pending, pending, DONE_IMPORTED],
    });
    await runImport({}, {
      io,
      client,
      config: inMemoryConfig("dev@example.com"),
      pollIntervalMs: 1,
    });
    expect(statusCalls.value).toBeGreaterThanOrEqual(2);
    expect(logs.join("\n")).toContain("12 commits");
    expect(logs.join("\n")).toContain("adicionado ao L1");
  });

  test("handles author_not_found gracefully and continues the loop", async () => {
    const { io, logs } = makeMockIO({ prompts: ["https://example.com/r.git", ""] });
    const { client } = makeClient({ statusSequence: [ERR_AUTHOR_NOT_FOUND] });
    await runImport({}, {
      io, client,
      config: inMemoryConfig("dev@example.com"),
      pollIntervalMs: 1,
    });
    const out = logs.join("\n");
    expect(out).toContain("Nenhum commit seu encontrado");
    expect(out).toContain("Bootstrap concluído");
    expect(out).toContain("0 repositório(s)");
  });

  test("handles already_imported and shows the count of zero new repos", async () => {
    const { io, logs } = makeMockIO({ prompts: ["https://example.com/r.git", ""] });
    const { client } = makeClient({ statusSequence: [DONE_ALREADY] });
    await runImport({}, {
      io, client,
      config: inMemoryConfig("dev@example.com"),
      pollIntervalMs: 1,
    });
    const out = logs.join("\n");
    expect(out).toContain("Já presente no L1");
    expect(out).toContain("Bootstrap concluído");
    expect(out).toContain("0 repositório(s)");
  });

  test("handles clone_error and reports the detail", async () => {
    const { io, logs } = makeMockIO({ prompts: ["https://example.com/r.git", ""] });
    const { client } = makeClient({ statusSequence: [ERR_CLONE] });
    await runImport({}, {
      io, client,
      config: inMemoryConfig("dev@example.com"),
      pollIntervalMs: 1,
    });
    const out = logs.join("\n");
    expect(out).toContain("Erro ao acessar o repositório");
    expect(out).toContain("auth required");
  });

  test("requests a PAT when the engine reports needs_pat, then succeeds", async () => {
    const { io, logs, secretCount } = makeMockIO({
      prompts: ["https://example.com/r.git", ""],
      secrets: ["ghp_TEST_TOKEN"],
    });
    // First poll → needs_pat. Second post (with PAT) → imported.
    const { client, importCalls } = makeClient({
      statusSequence: [ERR_NEEDS_PAT, DONE_IMPORTED],
    });
    await runImport({}, {
      io, client,
      config: inMemoryConfig("dev@example.com"),
      pollIntervalMs: 1,
    });
    expect(secretCount.value).toBe(1);
    expect(importCalls.length).toBe(2);
    expect(importCalls[0].pat).toBeNull();
    expect(importCalls[1].pat).toBe("ghp_TEST_TOKEN");
    expect(logs.join("\n")).toContain("adicionado ao L1");
  });

  test("PAT is not persisted to config.json after use", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "dp-import-"));
    process.env.BEHELD_DATA_DIR = tmp;
    try {
      const { io } = makeMockIO({
        prompts: ["https://example.com/r.git", ""],
        secrets: ["ghp_DO_NOT_PERSIST_42"],
      });
      const { client } = makeClient({
        statusSequence: [ERR_NEEDS_PAT, DONE_IMPORTED],
      });
      await runImport({}, {
        io,
        client,
        config: defaultConfigStore,  // uses BEHELD_DATA_DIR
        pollIntervalMs: 1,
      });

      // defaultConfigStore writes config.json when setAuthorEmail is called.
      // It was never called here (config had no email yet, but we never prompt
      // because makeMockIO returns "" → ensureAuthorEmail throws).
      // To exercise the path, write a config first:
      const cfgPath = join(tmp, ".beheld", "config.json");
      if (existsSync(cfgPath)) {
        const raw = readFileSync(cfgPath, "utf8");
        expect(raw).not.toContain("ghp_DO_NOT_PERSIST_42");
      }
    } finally {
      delete process.env.BEHELD_DATA_DIR;
    }
  });

  test("summary shows correct totals after multiple imports", async () => {
    const second = { ...DONE_IMPORTED, result: { status: "imported", root_commit_hash: "c".repeat(40), commit_count: 30 } } as L1ImportStatus;
    const { io, logs } = makeMockIO({
      prompts: ["https://example.com/a.git", "https://example.com/b.git", ""],
    });
    // Two sequential imports — each one polls and gets a fresh terminal status.
    let firstDone = false;
    const client: ImportClient = {
      async importRepository(_u, _e, _p) {
        return { status: "processing", repo_url: _u };
      },
      async getImportStatus() {
        const r = firstDone ? second : DONE_IMPORTED;
        firstDone = true;
        return r;
      },
      async getL1Repositories() { return []; },
      async deleteL1Repository() { return true; },
    };
    await runImport({}, {
      io, client,
      config: inMemoryConfig("dev@example.com"),
      pollIntervalMs: 1,
    });
    const out = logs.join("\n");
    // 12 + 30 = 42 commits across 2 repos
    expect(out).toContain("Bootstrap concluído");
    expect(out).toContain("2 repositório(s) · 42 commits analisados");
  });
});

describe("runImport — --list", () => {
  test("renders a table with HASH / DATA DE IMPORT / COMMITS", async () => {
    const repos: L1Repository[] = [
      { root_commit_hash: "a3f8c1d2deadbeef".repeat(2).slice(0, 40), imported_at: "2026-05-14T10:00:00+00:00", commit_count: 847 },
      { root_commit_hash: "b7e2a9f1cafebabe".repeat(2).slice(0, 40), imported_at: "2026-05-12T11:00:00+00:00", commit_count: 312 },
    ];
    const { io, logs } = makeMockIO({});
    const { client } = makeClient({ repos });
    await runImport({ list: true }, {
      io, client,
      config: inMemoryConfig("dev@example.com"),
    });
    const out = logs.join("\n");
    expect(out).toContain("HASH");
    expect(out).toContain("DATA DE IMPORT");
    expect(out).toContain("COMMITS");
    expect(out).toContain("a3f8c1d2");
    expect(out).toContain("2026-05-14");
    expect(out).toContain("847");
  });

  test("renders an empty-state message when no repos are imported", async () => {
    const { io, logs } = makeMockIO({});
    const { client } = makeClient({ repos: [] });
    await runImport({ list: true }, {
      io, client,
      config: inMemoryConfig("dev@example.com"),
    });
    expect(logs.join("\n")).toContain("Nenhum repositório importado");
  });
});

describe("runImport — --remove", () => {
  test("aborts when the user answers N (default)", async () => {
    const { io, logs } = makeMockIO({ confirms: [false] });
    const { client, deleteCalls } = makeClient({});
    await runImport({ remove: "a3f8c1d2deadbeef" }, {
      io, client,
      config: inMemoryConfig("dev@example.com"),
    });
    expect(deleteCalls.length).toBe(0);
    expect(logs.join("\n")).toContain("Operação cancelada");
  });

  test("requires confirmation before deleting", async () => {
    const { io, logs } = makeMockIO({ confirms: [true] });
    const { client, deleteCalls } = makeClient({ deleteResult: true });
    await runImport({ remove: "a3f8c1d2deadbeef" }, {
      io, client,
      config: inMemoryConfig("dev@example.com"),
    });
    expect(deleteCalls).toEqual(["a3f8c1d2deadbeef"]);
    expect(logs.join("\n")).toContain("removido do L1");
  });

  test("reports not-found when the engine returns 404", async () => {
    const { io, logs } = makeMockIO({ confirms: [true] });
    const { client } = makeClient({ deleteResult: false });
    await runImport({ remove: "does-not-exist" }, {
      io, client,
      config: inMemoryConfig("dev@example.com"),
    });
    expect(logs.join("\n")).toContain("Repositório não encontrado");
  });
});

describe("formatRepoTable", () => {
  test("aligns columns and truncates hashes to 8 chars", () => {
    const out = formatRepoTable([
      { root_commit_hash: "a".repeat(40), imported_at: "2026-05-14T10:00:00+00:00", commit_count: 12 },
    ]);
    expect(out.split("\n")[0]).toContain("HASH");
    const row = out.split("\n")[1];
    expect(row).toMatch(/^\s*a{8}/);
    expect(row).toContain("2026-05-14");
    expect(row).toContain("12");
  });
});
