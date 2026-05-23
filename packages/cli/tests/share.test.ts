import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";

import { renderQr, uploadBundle, DEFAULT_PORTAL_URL } from "../src/bundle/share";
import { BUNDLE_VERSION, type Bundle } from "../src/bundle/types";

const MOCK_PORT = 17430;
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
    public_key: "ed25519:somePublicKey",
    ...overrides,
  };
}

beforeAll(async () => {
  savedEnv = process.env.BEHELD_PORTAL_URL;
  process.env.BEHELD_PORTAL_URL = `http://127.0.0.1:${MOCK_PORT}`;
  server = Bun.serve({
    port: MOCK_PORT,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/bundles") {
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
        id: "abc123XYZ",
        url: "http://127.0.0.1/v/abc123XYZ",
        ttl_days: 30,
        created_at: "2026-05-14T00:00:00Z",
      }),
      { status: 201, headers: { "Content-Type": "application/json", "X-TTL": "30" } },
    );
});

// ── uploadBundle ─────────────────────────────────────────────────────────────

describe("uploadBundle", () => {
  test("default portal URL points at production", () => {
    expect(DEFAULT_PORTAL_URL).toBe("https://beheld.dev");
  });

  test("returns { ok: true, data } on 201", async () => {
    const result = await uploadBundle(dummyBundle());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe("abc123XYZ");
      expect(result.data.ttl_days).toBe(30);
    }
  });

  test("posts the bundle as JSON in the body", async () => {
    await uploadBundle(dummyBundle());
    expect(lastBody).not.toBeNull();
    const parsed = JSON.parse(lastBody!);
    expect(parsed.version).toBe(BUNDLE_VERSION);
    expect(parsed.hash).toMatch(/^sha256:/);
    expect(parsed.signature).toMatch(/^ed25519:/);
  });

  test("returns { ok: false, kind: 'http' } on 422", async () => {
    respond = () =>
      new Response(JSON.stringify({ errors: ["bad"] }), { status: 422 });
    const result = await uploadBundle(dummyBundle());
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "http") {
      expect(result.error.status).toBe(422);
      expect(result.error.body).toContain("bad");
    }
  });

  test("returns { ok: false, kind: 'network' } when portal unreachable", async () => {
    const saved = process.env.BEHELD_PORTAL_URL;
    process.env.BEHELD_PORTAL_URL = "http://127.0.0.1:19995";
    const result = await uploadBundle(dummyBundle());
    process.env.BEHELD_PORTAL_URL = saved;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("network");
  });

  test("propagates deduplicated flag from server", async () => {
    respond = () =>
      new Response(
        JSON.stringify({
          id: "alreadyHere",
          url: "http://127.0.0.1/v/alreadyHere",
          ttl_days: 25,
          created_at: "2026-05-10T00:00:00Z",
          deduplicated: true,
        }),
        { status: 200 },
      );
    const result = await uploadBundle(dummyBundle());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.deduplicated).toBe(true);
      expect(result.data.ttl_days).toBe(25);
    }
  });

  test("strips trailing slash from BEHELD_PORTAL_URL", async () => {
    const saved = process.env.BEHELD_PORTAL_URL;
    process.env.BEHELD_PORTAL_URL = `http://127.0.0.1:${MOCK_PORT}/`;
    const result = await uploadBundle(dummyBundle());
    process.env.BEHELD_PORTAL_URL = saved;
    expect(result.ok).toBe(true);
  });
});

// ── renderQr ─────────────────────────────────────────────────────────────────

describe("renderQr", () => {
  test("produces non-empty unicode block output", async () => {
    const out = await renderQr("https://beheld.dev/v/test123");
    expect(out.length).toBeGreaterThan(50);
    // qrcode-terminal uses block characters; "█" is the standard one for "small"
    expect(out).toMatch(/[█▀▄ ]/);
  });

  test("is deterministic for the same input", async () => {
    const a = await renderQr("https://example.com/x");
    const b = await renderQr("https://example.com/x");
    expect(a).toBe(b);
  });
});
