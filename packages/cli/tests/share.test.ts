import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  publishBundle,
  renderQr,
  slugFromUrl,
  DEFAULT_PORTAL_URL,
  publicKeyHex,
} from "../src/bundle/share";
import {
  runShare,
  isAffirmative,
  findLatestBundlePath,
  type Prompter,
} from "../src/commands/share";
import { BUNDLE_VERSION, type Bundle } from "../src/bundle/types";

// ── fixtures ─────────────────────────────────────────────────────────────────

const MOCK_PORT = 17431;
let server: ReturnType<typeof Bun.serve>;
let lastBody: string | null;
let respond: () => Response;
let savedEnv: string | undefined;

function dummyBundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    version: BUNDLE_VERSION,
    payload: {
      created_at: "2026-05-14T00:00:00+00:00",
      beheld_version: "0.2.0",
      previous_hash: null,
      scores: {
        date: "2026-05-13",
        prompt_quality: 50, test_maturity: 20, tech_breadth: 40,
        growth_rate: 30, overall: 35, sessions_analyzed: 30,
      },
      l1: {
        total_repos: 0, total_commits: 0,
        earliest_commit: null, latest_commit: null,
        ecosystems: {}, platforms: {},
        avg_test_ratio: 0, root_commit_hashes: [],
      },
      l2: {
        platforms: {}, ecosystems: {}, workflow_distribution: {},
        project_categories: {},
        workflow_metrics: {
          test_after_ratio: 0, test_first_ratio: 0,
          median_test_delay_min: 0, edit_to_test_lag_min: 0,
          bash_to_read_ratio: 0, prompt_avg_chars: 0,
          prompt_median_chars: 0, session_avg_duration_min: 0,
          tool_variety_avg: 0, ecosystem_concentration: 0,
        },
        sessions_analyzed: 30,
        period_days: 30,
      },
    },
    hash: "sha256:" + "a".repeat(64),
    signature: "ed25519:" + "b".repeat(128),
    // raw key is "test-key-bytes" base64url-encoded — exercises publicKeyHex().
    public_key: "ed25519:dGVzdC1rZXktYnl0ZXM",
    ...overrides,
  };
}

function scriptedPrompter(answers: string[]): Prompter {
  let i = 0;
  return {
    ask: async () => answers[i++] ?? "",
    close: () => {},
  };
}

// ── HTTP mock server ────────────────────────────────────────────────────────

beforeAll(async () => {
  savedEnv = process.env.BEHELD_PORTAL_URL;
  process.env.BEHELD_PORTAL_URL = `http://127.0.0.1:${MOCK_PORT}`;
  server = Bun.serve({
    port: MOCK_PORT,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/api/v1/bundles") {
        lastBody = await req.text();
        return respond();
      }
      return new Response("Not Found", { status: 404 });
    },
  });
  await Bun.sleep(20);
});

afterAll(() => {
  server.stop(true);
  if (savedEnv === undefined) delete process.env.BEHELD_PORTAL_URL;
  else process.env.BEHELD_PORTAL_URL = savedEnv;
});

beforeEach(() => {
  lastBody = null;
  respond = () =>
    new Response(
      JSON.stringify({
        url:             "http://127.0.0.1/v/abc123def",
        account_created: true,
        bundle_id:       "42",
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
});

// ── publishBundle ───────────────────────────────────────────────────────────

describe("publishBundle", () => {
  test("default portal URL points at production", () => {
    expect(DEFAULT_PORTAL_URL).toBe("https://beheld.dev");
  });

  test("returns { ok: true, data } on 201", async () => {
    const result = await publishBundle(dummyBundle());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.url).toContain("/v/abc123def");
      expect(result.data.account_created).toBe(true);
      expect(result.data.bundle_id).toBe("42");
    }
  });

  test("body contains fingerprint (hex), base64 bundle, and no email_recovery by default", async () => {
    await publishBundle(dummyBundle());
    expect(lastBody).not.toBeNull();
    const parsed = JSON.parse(lastBody!);
    expect(parsed.fingerprint).toMatch(/^[0-9a-f]+$/);
    expect(parsed.bundle).toBeDefined();
    expect(parsed.email_recovery).toBeUndefined();

    const decoded = JSON.parse(Buffer.from(parsed.bundle, "base64").toString("utf8"));
    expect(decoded.signature).toMatch(/^ed25519:/);
  });

  test("forwards email_recovery when provided", async () => {
    await publishBundle(dummyBundle(), { emailRecovery: "dev@example.com" });
    const parsed = JSON.parse(lastBody!);
    expect(parsed.email_recovery).toBe("dev@example.com");
  });

  test("returns { ok: false, kind: 'http' } on 422", async () => {
    respond = () =>
      new Response(JSON.stringify({ error: "invalid_signature" }), { status: 422 });
    const result = await publishBundle(dummyBundle());
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "http") {
      expect(result.error.status).toBe(422);
      expect(result.error.body).toContain("invalid_signature");
    }
  });

  test("returns { ok: false, kind: 'network' } when portal unreachable", async () => {
    const saved = process.env.BEHELD_PORTAL_URL;
    process.env.BEHELD_PORTAL_URL = "http://127.0.0.1:19996";
    const result = await publishBundle(dummyBundle());
    process.env.BEHELD_PORTAL_URL = saved;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("network");
  });
});

describe("publicKeyHex", () => {
  test("decodes ed25519:<base64url> to lowercase hex", () => {
    const b = dummyBundle();
    const hex = publicKeyHex(b);
    expect(hex).toMatch(/^[0-9a-f]+$/);
    // "test-key-bytes" → 14 ASCII bytes → 28 hex chars
    expect(hex.length).toBe(28);
  });
});

describe("slugFromUrl", () => {
  test("extracts the slug from a /v/<slug> URL", () => {
    expect(slugFromUrl("https://beheld.dev/v/abc123def")).toBe("abc123def");
    expect(slugFromUrl("http://127.0.0.1/v/xy12pqrst/")).toBe("xy12pqrst");
  });

  test("returns null when no /v/ segment is present", () => {
    expect(slugFromUrl("https://beheld.dev/dashboard")).toBeNull();
  });
});

describe("isAffirmative", () => {
  test("treats s/y/sim/yes (any case) as yes; everything else as no", () => {
    for (const yes of ["s", "S", "y", "Y", "sim", "Sim", "yes", "YES"]) {
      expect(isAffirmative(yes)).toBe(true);
    }
    for (const no of ["", "n", "N", "no", "não", "0", "x", "  "]) {
      expect(isAffirmative(no)).toBe(false);
    }
  });
});

// ── runShare (command-level) ────────────────────────────────────────────────

describe("runShare", () => {
  let tmpRoot: string;
  let snapshotsDir: string;
  let configPath: string;
  let lines: string[];

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `beheld-share-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    snapshotsDir = join(tmpRoot, "snapshots");
    configPath = join(tmpRoot, "config.json");
    mkdirSync(snapshotsDir, { recursive: true });
    lines = [];
  });

  function writeBundleFile(name: string, body: Bundle = dummyBundle()): string {
    const p = join(snapshotsDir, name);
    writeFileSync(p, JSON.stringify(body), "utf8");
    return p;
  }

  function cleanup() {
    try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
  }

  test("exits 1 with an explanatory message when no local bundle exists", async () => {
    const outcome = await runShare({
      snapshotsDir, configPath,
      out: (l) => lines.push(l),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.exitCode).toBe(1);
    expect(lines.some((l) => /Nenhum bundle encontrado/.test(l))).toBe(true);
    cleanup();
  });

  test("publishes the latest bundle and persists the slug to config.json", async () => {
    writeBundleFile("2026-05-26_aaaaaaaa.beheld");

    const outcome = await runShare({
      snapshotsDir, configPath,
      // Skip the email_recovery prompt by short-circuiting with "n".
      prompter: scriptedPrompter(["n"]),
      out: (l) => lines.push(l),
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.exitCode).toBe(0);

    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    expect(cfg.last_published_slug).toBe("abc123def");

    // Mock server received the request.
    expect(lastBody).not.toBeNull();
    cleanup();
  });

  test("on network failure: reports error, exits 1, leaves the local bundle intact", async () => {
    const bundlePath = writeBundleFile("2026-05-26_bbbbbbbb.beheld");

    // Inject a fetcher that throws like a network error.
    const failingFetcher = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const outcome = await runShare({
      snapshotsDir, configPath,
      prompter: scriptedPrompter(["n"]),
      fetcher:  failingFetcher,
      out: (l) => lines.push(l),
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.exitCode).toBe(1);
    expect(lines.some((l) => /Falha no upload/.test(l))).toBe(true);

    // Bundle file untouched.
    expect(existsSync(bundlePath)).toBe(true);
    // No config written → no slug cached.
    expect(existsSync(configPath)).toBe(false);
    cleanup();
  });

  test("persists email_recovery in config when the user provides one on first publish", async () => {
    writeBundleFile("2026-05-26_cccccccc.beheld");

    const outcome = await runShare({
      snapshotsDir, configPath,
      prompter: scriptedPrompter(["s", "dev@example.com"]),
      out: (l) => lines.push(l),
    });

    expect(outcome.ok).toBe(true);

    const parsed = JSON.parse(lastBody!);
    expect(parsed.email_recovery).toBe("dev@example.com");

    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    expect(cfg.email_recovery).toBe("dev@example.com");
    cleanup();
  });
});

describe("findLatestBundlePath", () => {
  test("returns null for an empty / missing directory", () => {
    expect(findLatestBundlePath("/nonexistent-dir-for-tests")).toBeNull();
  });

  test("returns the most recently modified .beheld in the directory", async () => {
    const dir = join(tmpdir(), `beheld-latest-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "older.beheld"), "{}");
    await Bun.sleep(15);
    writeFileSync(join(dir, "newer.beheld"), "{}");
    expect(findLatestBundlePath(dir)).toContain("newer.beheld");
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── renderQr ────────────────────────────────────────────────────────────────

describe("renderQr", () => {
  test("produces non-empty unicode block output", async () => {
    const out = await renderQr("https://beheld.dev/v/test123");
    expect(out.length).toBeGreaterThan(50);
    expect(out).toMatch(/[█▀▄ ]/);
  });
});
