import { test, expect, describe, beforeEach, afterEach, beforeAll, afterAll, mock } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { payloadHash, payloadToCanonical } from "../src/bundle/canonical";
import { BUNDLE_VERSION, type Bundle, type BundlePayload } from "../src/bundle/types";
import type { RekorSubmitResult } from "../src/lib/rekor";

// ── Rekor mock seam ────────────────────────────────────────────────────────
//
// Pre-fix, snapshot tests intercepted POST /api/v1/log/entries on the mock
// engine server. That stopped working when we moved to @sigstore/sign — the
// library does signed-entry-timestamp verification against Rekor's public
// key, so a fetch-level mock can't easily impersonate the real Rekor.
//
// Instead, mock the lib/rekor module entirely: tests inject a deterministic
// RekorSubmitResult via `mockRekorResult`. The wire-format integration is
// covered separately in rekor.test.ts (live behind REKOR_LIVE=1).

let mockRekorResult: RekorSubmitResult = {
  ok: false, reason: "rejected", detail: "default — tests override per-case",
};
let rekorCallCount = 0;

// Re-export the real module's other functions so this mock stays compatible
// with verify.ts / rekor.test.ts which also import from lib/rekor. Bun's
// mock.module is global — only `submitToRekor` is overridden; everything
// else falls through to the real implementation.
const realRekor = await import("../src/lib/rekor");
mock.module("../src/lib/rekor", () => ({
  ...realRekor,
  submitToRekor: async () => {
    rekorCallCount += 1;
    return mockRekorResult;
  },
}));

// ── shared fixture payload (matches the contract test in bundle.test.ts) ────

function fixturePayload(opts: Partial<BundlePayload> = {}): BundlePayload {
  return {
    created_at: "2026-05-14T03:00:00+00:00",
    beheld_version: "0.2.0",
    previous_hash: null,
    scores: {
      date: "2026-05-13",
      prompt_quality: 50,
      test_maturity: 20,
      tech_breadth: 40,
      growth_rate: 30,
      overall: 35,
      sessions_analyzed: 30,
    },
    l1: {
      total_repos: 0,
      total_commits: 0,
      earliest_commit: null,
      latest_commit: null,
      ecosystems: {},
      platforms: {},
      avg_test_ratio: 0,
      root_commit_hashes: [],
    },
    l2: {
      platforms: { docker: 10 },
      ecosystems: { rails: 8 },
      workflow_distribution: { tdd: 0.2 },
      project_categories: { saas_b2b: 1.0 },
      workflow_metrics: {
        test_after_ratio: 0.6,
        test_first_ratio: 0,
        median_test_delay_min: 0,
        edit_to_test_lag_min: 0,
        bash_to_read_ratio: 0,
        prompt_avg_chars: 0,
        prompt_median_chars: 0,
        session_avg_duration_min: 0,
        tool_variety_avg: 0,
        ecosystem_concentration: 0,
      },
      sessions_analyzed: 30,
      period_days: 30,
    },
    ...opts,
  };
}

// ── mock engine: serves /snapshot/payload, /snapshot/save, /snapshots ───────

const MOCK_PORT = 17400;
let server: ReturnType<typeof Bun.serve>;
let workDir: string;
let savedEnvDir: string | undefined;
let savedEnvUrl: string | undefined;
let payloadResponder: () => Response;
let saveBodies: unknown[];
let savedHashes: string[];
let listResponder: () => Response;
let bundleUploadResponder: () => Response;
let lastUploadBody: string | null;
let savedEnvPortal: string | undefined;
let savedEnvRekor: string | undefined;
/** Tests inject a Rekor response by toggling this between runs. The mock
 *  engine serves /api/v1/log/entries with whatever's currently here. */
let rekorResponder: () => Response;

beforeAll(async () => {
  savedEnvUrl = process.env.BEHELD_ENGINE_URL;
  savedEnvPortal = process.env.BEHELD_PORTAL_URL;
  savedEnvRekor = process.env.BEHELD_REKOR_URL;
  process.env.BEHELD_ENGINE_URL = `http://127.0.0.1:${MOCK_PORT}`;
  // The portal AND the Rekor stub all live on the same mock — keeps the test
  // serial-safe and stops snapshot from reaching out to rekor.sigstore.dev.
  process.env.BEHELD_PORTAL_URL = `http://127.0.0.1:${MOCK_PORT}`;
  process.env.BEHELD_REKOR_URL = `http://127.0.0.1:${MOCK_PORT}`;
  server = Bun.serve({
    port: MOCK_PORT,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/snapshot/payload") {
        return payloadResponder();
      }
      if (req.method === "POST" && url.pathname === "/snapshot/save") {
        const body = await req.json();
        saveBodies.push(body);
        savedHashes.push((body as { hash: string }).hash);
        return new Response(JSON.stringify({ ok: true, id: 1, hash: (body as { hash: string }).hash }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (req.method === "POST" && url.pathname === "/api/v1/bundles") {
        lastUploadBody = await req.text();
        return bundleUploadResponder();
      }
      if (req.method === "GET" && url.pathname === "/snapshots") {
        return listResponder();
      }
      if (req.method === "POST" && url.pathname === "/api/v1/log/entries") {
        return rekorResponder();
      }
      return new Response("Not Found", { status: 404 });
    },
  });
  await Bun.sleep(20);
});

afterAll(() => {
  server.stop(true);
  if (savedEnvUrl === undefined) delete process.env.BEHELD_ENGINE_URL;
  else process.env.BEHELD_ENGINE_URL = savedEnvUrl;
  if (savedEnvPortal === undefined) delete process.env.BEHELD_PORTAL_URL;
  else process.env.BEHELD_PORTAL_URL = savedEnvPortal;
  if (savedEnvRekor === undefined) delete process.env.BEHELD_REKOR_URL;
  else process.env.BEHELD_REKOR_URL = savedEnvRekor;
});

let savedDesktopOptOut: string | undefined;
let savedDesktopDir: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "beheld-snap-"));
  savedEnvDir = process.env.BEHELD_DATA_DIR;
  process.env.BEHELD_DATA_DIR = workDir;
  // Prevent tests from writing to the real ~/Desktop. Each test that wants to
  // assert the desktop-copy behaviour will unset this and set DESKTOP_DIR.
  savedDesktopOptOut = process.env.BEHELD_NO_DESKTOP_COPY;
  savedDesktopDir = process.env.BEHELD_DESKTOP_DIR;
  process.env.BEHELD_NO_DESKTOP_COPY = "1";
  saveBodies = [];
  savedHashes = [];
  lastUploadBody = null;
  payloadResponder = () =>
    new Response(JSON.stringify(fixturePayload()), {
      headers: { "Content-Type": "application/json" },
    });
  listResponder = () =>
    new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
  bundleUploadResponder = () =>
    new Response(
      JSON.stringify({
        url:             "http://127.0.0.1/v/abc123",
        account_created: true,
        bundle_id:       "42",
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  // Default: pretend Rekor is unreachable so snapshots emit rekor: null. Tests
  // that need a success path override this within the test body.
  rekorResponder = () => new Response("upstream down", { status: 500 });
  // Module-level Rekor stub (see top of file). Default: failure; tests that
  // need success set `mockRekorResult` to { ok: true, entry: ... } first.
  mockRekorResult = {
    ok: false, reason: "rejected",
    detail: "default 500 — set mockRekorResult per-test",
  };
  rekorCallCount = 0;
});

afterEach(() => {
  if (savedEnvDir === undefined) delete process.env.BEHELD_DATA_DIR;
  else process.env.BEHELD_DATA_DIR = savedEnvDir;
  if (savedDesktopOptOut === undefined) delete process.env.BEHELD_NO_DESKTOP_COPY;
  else process.env.BEHELD_NO_DESKTOP_COPY = savedDesktopOptOut;
  if (savedDesktopDir === undefined) delete process.env.BEHELD_DESKTOP_DIR;
  else process.env.BEHELD_DESKTOP_DIR = savedDesktopDir;
  rmSync(workDir, { recursive: true, force: true });
});

// ── snapshot generation ─────────────────────────────────────────────────────

describe("snapshotCommand — generate", () => {
  test("writes a .beheld file under ~/.beheld/snapshots/", async () => {
    const { snapshotCommand } = await import("../src/commands/snapshot?v=gen1");
    await snapshotCommand();
    const snapDir = join(workDir, ".beheld", "snapshots");
    expect(existsSync(snapDir)).toBe(true);
    const files = readdirSync(snapDir).filter((f) => f.endsWith(".beheld"));
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^\d{8}_[0-9a-f]{8}\.beheld$/);
  });

  test("snapshots directory has 0700 permissions", async () => {
    const { snapshotCommand } = await import("../src/commands/snapshot?v=gen-perms");
    await snapshotCommand();
    const snapDir = join(workDir, ".beheld", "snapshots");
    expect(statSync(snapDir).mode & 0o777).toBe(0o700);
  });

  test("bundle has version, payload, hash, signature, public_key", async () => {
    const { snapshotCommand } = await import("../src/commands/snapshot?v=gen2");
    await snapshotCommand();
    const snapDir = join(workDir, ".beheld", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".beheld"))!;
    const bundle = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;
    expect(bundle.version).toBe(BUNDLE_VERSION);
    expect(bundle.payload).toBeDefined();
    expect(bundle.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(bundle.signature).toMatch(/^ed25519:[0-9a-f]{128}$/); // 64 bytes hex
    expect(bundle.public_key).toMatch(/^ed25519:[A-Za-z0-9_-]+$/);
  });

  test("hash matches recomputed canonical payload hash (determinism)", async () => {
    const { snapshotCommand } = await import("../src/commands/snapshot?v=gen3");
    await snapshotCommand();
    const snapDir = join(workDir, ".beheld", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".beheld"))!;
    const bundle = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;
    const expected = await payloadHash(bundle.payload);
    expect(bundle.hash).toBe(expected);
  });

  test("signature verifies against the embedded public_key", async () => {
    const { snapshotCommand } = await import("../src/commands/snapshot?v=gen4");
    await snapshotCommand();
    const snapDir = join(workDir, ".beheld", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".beheld"))!;
    const bundle = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;

    const pubX = bundle.public_key.replace(/^ed25519:/, "");
    const pubKey = await crypto.subtle.importKey(
      "jwk",
      { kty: "OKP", crv: "Ed25519", x: pubX },
      { name: "Ed25519" },
      true,
      ["verify"],
    );
    const sigHex = bundle.signature.replace(/^ed25519:/, "");
    const sigBytes = Uint8Array.from(sigHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    const canonical = new TextEncoder().encode(payloadToCanonical(bundle.payload));
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, pubKey, sigBytes, canonical);
    expect(ok).toBe(true);
  });

  test("--output writes a second copy", async () => {
    const out = join(workDir, "elsewhere.beheld");
    const { snapshotCommand } = await import("../src/commands/snapshot?v=out");
    await snapshotCommand({ output: out });
    expect(existsSync(out)).toBe(true);
    // Both copies have identical content
    const snapDir = join(workDir, ".beheld", "snapshots");
    const primary = readdirSync(snapDir).find((f) => f.endsWith(".beheld"))!;
    expect(readFileSync(join(snapDir, primary), "utf8")).toBe(readFileSync(out, "utf8"));
  });

  test("registers the snapshot with /snapshot/save (with bundle_path)", async () => {
    const { snapshotCommand } = await import("../src/commands/snapshot?v=save1");
    await snapshotCommand();
    expect(saveBodies.length).toBe(1);
    const body = saveBodies[0] as Record<string, unknown>;
    expect(body.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(typeof body.payload_json).toBe("string");
    expect(typeof body.bundle_path).toBe("string");
    expect((body.bundle_path as string).endsWith(".beheld")).toBe(true);
  });

  test("filename uses YYYYMMDD_<hash8>.beheld convention", async () => {
    const { snapshotCommand } = await import("../src/commands/snapshot?v=fname");
    await snapshotCommand();
    const snapDir = join(workDir, ".beheld", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".beheld"))!;
    expect(file.startsWith("20260514_")).toBe(true);
  });

  test("auto-generates keys if missing (init hook fallback)", async () => {
    // workDir starts empty, no keys present
    const keysDir = join(workDir, ".beheld", "keys");
    expect(existsSync(keysDir)).toBe(false);
    const { snapshotCommand } = await import("../src/commands/snapshot?v=ensurekeys");
    await snapshotCommand();
    expect(existsSync(join(keysDir, "private.jwk"))).toBe(true);
    expect(existsSync(join(keysDir, "public.jwk"))).toBe(true);
  });
});

// ── share flag ──────────────────────────────────────────────────────────────

// ── desktop convenience copy ────────────────────────────────────────────────

describe("snapshotCommand — desktop convenience copy", () => {
  test("writes a copy to BEHELD_DESKTOP_DIR when set", async () => {
    const desktop = mkdtempSync(join(tmpdir(), "beheld-desktop-"));
    delete process.env.BEHELD_NO_DESKTOP_COPY;
    process.env.BEHELD_DESKTOP_DIR = desktop;
    try {
      const { snapshotCommand } = await import("../src/commands/snapshot?v=desktop1");
      await snapshotCommand();
      const files = readdirSync(desktop).filter((f) => f.endsWith(".beheld"));
      expect(files.length).toBe(1);
      // Content equals primary copy under ~/.beheld/snapshots/
      const snapDir = join(workDir, ".beheld", "snapshots");
      const primary = readdirSync(snapDir).find((f) => f.endsWith(".beheld"))!;
      expect(readFileSync(join(desktop, files[0]), "utf8")).toBe(
        readFileSync(join(snapDir, primary), "utf8"),
      );
    } finally {
      rmSync(desktop, { recursive: true, force: true });
    }
  });

  test("does NOT copy when BEHELD_NO_DESKTOP_COPY=1 (default in tests)", async () => {
    // beforeEach already sets BEHELD_NO_DESKTOP_COPY=1
    const desktop = mkdtempSync(join(tmpdir(), "beheld-desktop-"));
    process.env.BEHELD_DESKTOP_DIR = desktop;
    try {
      const { snapshotCommand } = await import("../src/commands/snapshot?v=desktop2");
      await snapshotCommand();
      expect(readdirSync(desktop).length).toBe(0);
    } finally {
      rmSync(desktop, { recursive: true, force: true });
    }
  });

  test("silently skips when BEHELD_DESKTOP_DIR points at nonexistent path", async () => {
    delete process.env.BEHELD_NO_DESKTOP_COPY;
    process.env.BEHELD_DESKTOP_DIR = join(tmpdir(), "definitely-not-a-real-dir-" + Date.now());
    const { snapshotCommand } = await import("../src/commands/snapshot?v=desktop3");
    // Should not throw, primary write still works
    await snapshotCommand();
    const snapDir = join(workDir, ".beheld", "snapshots");
    expect(readdirSync(snapDir).length).toBe(1);
  });
});

describe("snapshotCommand — --share", () => {
  test("uploads the bundle to /api/v1/bundles and prints the public URL", async () => {
    const { snapshotCommand } = await import("../src/commands/snapshot?v=share1");
    const logs: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      await snapshotCommand({ share: true });
    } finally {
      console.log = realLog;
    }
    const out = logs.join("\n");
    expect(out).toContain("http://127.0.0.1/v/abc123");
    expect(out).toMatch(/[█▀▄]/); // QR rendering
    // The actual bundle was uploaded as { fingerprint, bundle } payload.
    expect(lastUploadBody).not.toBeNull();
    const uploaded = JSON.parse(lastUploadBody!);
    expect(uploaded.fingerprint).toMatch(/^[0-9a-f]+$/);
    expect(uploaded.bundle).toBeDefined();
  });

  test("does not abort the snapshot when upload fails (local bundle intact, exit 0)", async () => {
    bundleUploadResponder = () =>
      new Response(JSON.stringify({ error: "ouch" }), { status: 500 });
    const { snapshotCommand } = await import("../src/commands/snapshot?v=share2");
    const logs: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };

    // snapshot --share treats the publish step as best-effort: if it fails we
    // log the error but the command itself succeeds (the local .beheld was
    // already written). Standalone `beheld share` is the one that exits 1.
    let exitCalled = false;
    const realExit = process.exit;
    process.exit = ((_code?: number) => { exitCalled = true; }) as typeof process.exit;

    try {
      await snapshotCommand({ share: true });
    } finally {
      console.log = realLog;
      process.exit = realExit;
    }

    const out = logs.join("\n");
    expect(out).toContain("Snapshot gerado");   // local bundle still produced
    expect(out).toContain("Falha no upload");
    expect(out).toContain("HTTP 500");
    expect(exitCalled).toBe(false);
  });

  test("flags account_created when the portal created a fresh account", async () => {
    bundleUploadResponder = () =>
      new Response(
        JSON.stringify({
          url:             "http://127.0.0.1/v/freshSlug",
          account_created: true,
          bundle_id:       "1",
        }),
        { status: 201 },
      );
    const { snapshotCommand } = await import("../src/commands/snapshot?v=share3");
    const logs: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      await snapshotCommand({ share: true });
    } finally {
      console.log = realLog;
    }
    expect(logs.join("\n")).toContain("conta criada");
  });

  test("does NOT upload when --share is omitted", async () => {
    const { snapshotCommand } = await import("../src/commands/snapshot?v=no-share");
    await snapshotCommand({});
    expect(lastUploadBody).toBeNull();
  });
});

// ── error paths ─────────────────────────────────────────────────────────────

describe("snapshotCommand — error handling", () => {
  test("exits 1 with friendly message on engine 409 (no scores yet)", async () => {
    payloadResponder = () =>
      new Response(JSON.stringify({ detail: "no scores available" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    const { snapshotCommand } = await import("../src/commands/snapshot?v=409");
    let exitCode: number | null = null;
    const realExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error("EXIT");
    }) as typeof process.exit;
    try {
      await snapshotCommand();
    } catch (e) {
      expect((e as Error).message).toBe("EXIT");
    } finally {
      process.exit = realExit;
    }
    expect(exitCode).toBe(1);
  });
});

// ── list ────────────────────────────────────────────────────────────────────

describe("snapshotListCommand", () => {
  test("prints 'Nenhum snapshot' when list is empty", async () => {
    const { snapshotListCommand } = await import("../src/commands/snapshot?v=list-empty");
    const logs: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      await snapshotListCommand();
    } finally {
      console.log = realLog;
    }
    expect(logs.join("\n")).toContain("Nenhum snapshot");
  });

  test("prints entries with date, short hash and bundle path", async () => {
    listResponder = () =>
      new Response(
        JSON.stringify([
          {
            id: 2,
            hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            previous_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            created_at: "2026-05-14T03:00:00+00:00",
            bundle_path: "/tmp/b.beheld",
          },
          {
            id: 1,
            hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            previous_hash: null,
            created_at: "2026-05-14T02:00:00+00:00",
            bundle_path: "/tmp/a.beheld",
          },
        ]),
        { headers: { "Content-Type": "application/json" } },
      );
    const { snapshotListCommand } = await import("../src/commands/snapshot?v=list-rows");
    const logs: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      await snapshotListCommand();
    } finally {
      console.log = realLog;
    }
    const out = logs.join("\n");
    expect(out).toContain("2 snapshot");
    expect(out).toContain("bbbbbbbbbbbb");      // newest short hash
    expect(out).toContain("aaaaaaaaaaaa");      // genesis short hash
    expect(out).toContain("/tmp/a.beheld");
    expect(out).toContain("•");                  // genesis marker
    expect(out).toContain("→");                  // linked marker
  });
});

// ── F6.8: L1/L2 composition surfaced by `beheld snapshot` ────────────────

describe("snapshotCommand — L1/L2 composition output", () => {
  test("shows the composition block (Base histórica + Trajetória observada)", async () => {
    const originalLog = console.log;
    const captured: string[] = [];
    console.log = (...args) => captured.push(args.join(" "));
    try {
      const { snapshotCommand } = await import("../src/commands/snapshot?v=compose1");
      await snapshotCommand();
    } finally {
      console.log = originalLog;
    }
    const out = captured.join("\n");
    expect(out).toContain("Perfil capturado");
    expect(out).toContain("Base histórica:");
    expect(out).toContain("Trajetória observada:");
  });

  test("falls back to 'não disponível' when L1 is empty", async () => {
    // The default mock payload has total_repos = 0 → empty L1.
    const originalLog = console.log;
    const captured: string[] = [];
    console.log = (...args) => captured.push(args.join(" "));
    try {
      const { snapshotCommand } = await import("../src/commands/snapshot?v=compose2");
      await snapshotCommand();
    } finally {
      console.log = originalLog;
    }
    const out = captured.join("\n");
    expect(out).toContain("não disponível (execute beheld import)");
  });

  test("shows repo and commit counts when L1 has data", async () => {
    // Swap in a payload with populated L1.
    const previousResponder = payloadResponder;
    payloadResponder = () => {
      const populated = fixturePayload({
        l1: {
          total_repos: 12,
          total_commits: 4832,
          earliest_commit: "2022-01-01T00:00:00+00:00",
          latest_commit: "2026-05-10T00:00:00+00:00",
          ecosystems: { python: true, rails: true },
          platforms: { docker: true },
          avg_test_ratio: 0.4,
          root_commit_hashes: ["a".repeat(40), "b".repeat(40)],
        },
      });
      return new Response(JSON.stringify(populated), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const originalLog = console.log;
    const captured: string[] = [];
    console.log = (...args) => captured.push(args.join(" "));
    try {
      const { snapshotCommand } = await import("../src/commands/snapshot?v=compose3");
      await snapshotCommand();
    } finally {
      console.log = originalLog;
      payloadResponder = previousResponder;
    }
    const out = captured.join("\n");
    expect(out).toContain("12 repositórios");
    expect(out).toContain("commits");
  });

  test("bundle on disk has separate l1 and l2 keys", async () => {
    const { snapshotCommand } = await import("../src/commands/snapshot?v=compose4");
    await snapshotCommand();
    const snapDir = join(workDir, ".beheld", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".beheld"))!;
    const bundle = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;
    expect(bundle.payload).toHaveProperty("l1");
    expect(bundle.payload).toHaveProperty("l2");
    expect(bundle.payload).not.toHaveProperty("signals");
  });
});

// ── attestation injection (Phase 5 / F5.6.1.e) ──────────────────────────────

describe("snapshotCommand — attestation injection", () => {
  function writeAttestationCache(workDir: string, attestation: object): void {
    const dir = join(workDir, ".beheld");
    require("node:fs").mkdirSync(dir, { recursive: true });
    require("node:fs").writeFileSync(
      join(dir, "attestation.json"),
      JSON.stringify(attestation, null, 2) + "\n",
    );
  }

  const sampleAttestation = {
    payload: {
      type: "beheld-identity-attestation/v1",
      platform_key_id: "beheld-platform-2026-q2",
      dev_pubkey: "ed25519-pub:AAAA",
      github: {
        user_id: 12345,
        login: "octocat",
        verified_at: "2026-05-19T18:00:00Z",
      },
      attested_at: "2026-05-19T18:00:00Z",
    },
    signature: "ed25519:AAAA",
  };

  test("omits attestation field quando cache não existe", async () => {
    const { snapshotCommand } = await import("../src/commands/snapshot?v=att-none");
    await snapshotCommand();
    const snapDir = join(workDir, ".beheld", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".beheld"))!;
    const bundle = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;
    expect(bundle.attestation).toBeUndefined();
  });

  test("embute o conteúdo exato da cache quando ela existe", async () => {
    writeAttestationCache(workDir, sampleAttestation);
    const { snapshotCommand } = await import("../src/commands/snapshot?v=att-yes");
    await snapshotCommand();
    const snapDir = join(workDir, ".beheld", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".beheld"))!;
    const bundle = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;
    expect(bundle.attestation).toEqual(sampleAttestation);
  });

  test("attestation NÃO afeta o bundle hash (vive no wrapper, fora do payload)", async () => {
    // Snapshot sem attestation
    const { snapshotCommand: snap1 } = await import("../src/commands/snapshot?v=att-hash-no");
    await snap1();
    const snapDir = join(workDir, ".beheld", "snapshots");
    let file = readdirSync(snapDir).find((f) => f.endsWith(".beheld"))!;
    const bundleNoAtt = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;

    // Cleanup
    rmSync(snapDir, { recursive: true, force: true });

    // Snapshot com attestation
    writeAttestationCache(workDir, sampleAttestation);
    const { snapshotCommand: snap2 } = await import("../src/commands/snapshot?v=att-hash-yes");
    await snap2();
    file = readdirSync(snapDir).find((f) => f.endsWith(".beheld"))!;
    const bundleWithAtt = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;

    // Same payload → same hash
    expect(bundleWithAtt.hash).toBe(bundleNoAtt.hash);
    expect(bundleWithAtt.attestation).toBeDefined();
    expect(bundleNoAtt.attestation).toBeUndefined();
  });
});

// ── Rekor inclusion (Phase 5 / F5.8) ────────────────────────────────────────

describe("snapshotCommand — Rekor inclusion", () => {
  test("Rekor falha → bundle salvo com rekor: null, sem erro fatal", async () => {
    // rekorResponder defaults to 500 in beforeEach → submitToRekor returns null
    const { snapshotCommand } = await import("../src/commands/snapshot?v=rekor-fail");
    await snapshotCommand();
    const snapDir = join(workDir, ".beheld", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".beheld"))!;
    const bundle = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;
    expect(bundle.rekor).toBeNull();
  });

  test("Rekor sucesso → bundle persiste logIndex + uuid + integratedTime", async () => {
    mockRekorResult = {
      ok: true,
      entry: {
        logIndex: 777,
        uuid: "rekor-uuid-77",
        integratedTime: "2025-06-01T16:00:00.000Z",
        signedEntryTimestamp: "set==",
      },
    };
    const { snapshotCommand } = await import("../src/commands/snapshot?v=rekor-ok");
    await snapshotCommand();
    const snapDir = join(workDir, ".beheld", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".beheld"))!;
    const bundle = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;
    expect(bundle.rekor).not.toBeNull();
    expect(bundle.rekor!.logIndex).toBe(777);
    expect(bundle.rekor!.uuid).toBe("rekor-uuid-77");
    expect(bundle.rekor!.integratedTime).toBe("2025-06-01T16:00:00.000Z");
  });

  test("--no-rekor pula a submissão e mantém rekor: null", async () => {
    // If snapshot still called submitToRekor with --no-rekor, mockRekorResult
    // would have been read (rekorCallCount > 0). Assert it was NOT called.
    mockRekorResult = {
      ok: true,
      entry: { logIndex: 1, uuid: "should-not-be-used", integratedTime: "x", signedEntryTimestamp: "y" },
    };
    const { snapshotCommand } = await import("../src/commands/snapshot?v=rekor-skip");
    await snapshotCommand({ noRekor: true });
    expect(rekorCallCount).toBe(0);
    const snapDir = join(workDir, ".beheld", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".beheld"))!;
    const bundle = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;
    expect(bundle.rekor).toBeNull();
  });

  test("Rekor NÃO entra no payload assinado (vive no wrapper)", async () => {
    mockRekorResult = {
      ok: true,
      entry: {
        logIndex: 22, uuid: "u-22",
        integratedTime: "2023-11-14T00:00:00.000Z",
        signedEntryTimestamp: "x==",
      },
    };
    const { snapshotCommand } = await import("../src/commands/snapshot?v=rekor-payload-iso");
    await snapshotCommand();
    const snapDir = join(workDir, ".beheld", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".beheld"))!;
    const bundle = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;
    // Bundle hash must still match payload canonical hash — Rekor is sibling.
    const recomputed = await (async () => {
      const { payloadHash } = await import("../src/bundle/canonical");
      return payloadHash(bundle.payload);
    })();
    expect(bundle.hash).toBe(recomputed);
    expect(bundle.rekor).not.toBeNull();
  });

  test("--rekor-submit promove um bundle existente sem reescrever o payload", async () => {
    // First: generate an offline bundle (rekor null) — default mockRekorResult
    // is { ok: false, reason: rejected }.
    const { snapshotCommand: snap1 } = await import("../src/commands/snapshot?v=rekor-resub-1");
    await snap1();
    const snapDir = join(workDir, ".beheld", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".beheld"))!;
    const bundlePath = join(snapDir, file);
    const before = JSON.parse(readFileSync(bundlePath, "utf8")) as Bundle;
    expect(before.rekor).toBeNull();

    // Switch Rekor stub to success and re-submit.
    mockRekorResult = {
      ok: true,
      entry: {
        logIndex: 9001, uuid: "u-promoted",
        integratedTime: "2025-06-01T18:13:20.000Z",
        signedEntryTimestamp: "p==",
      },
    };
    const { snapshotCommand: snap2 } = await import("../src/commands/snapshot?v=rekor-resub-2");
    await snap2({ rekorSubmit: bundlePath });

    const after = JSON.parse(readFileSync(bundlePath, "utf8")) as Bundle;
    expect(after.rekor).not.toBeNull();
    expect(after.rekor!.logIndex).toBe(9001);
    // Payload + signature unchanged.
    expect(after.hash).toBe(before.hash);
    expect(after.signature).toBe(before.signature);
    expect(after.payload).toEqual(before.payload);
  });
});
