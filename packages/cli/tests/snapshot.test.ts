import { test, expect, describe, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { payloadHash, payloadToCanonical } from "../src/bundle/canonical";
import { BUNDLE_VERSION, type Bundle, type BundlePayload } from "../src/bundle/types";

// ── shared fixture payload (matches the contract test in bundle.test.ts) ────

function fixturePayload(opts: Partial<BundlePayload> = {}): BundlePayload {
  return {
    created_at: "2026-05-14T03:00:00+00:00",
    devprofile_version: "0.2.0",
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

beforeAll(async () => {
  savedEnvUrl = process.env.DEVPROFILE_ENGINE_URL;
  savedEnvPortal = process.env.DEVPROFILE_PORTAL_URL;
  process.env.DEVPROFILE_ENGINE_URL = `http://127.0.0.1:${MOCK_PORT}`;
  // The portal lives on the same mock — keeps the test serial-safe.
  process.env.DEVPROFILE_PORTAL_URL = `http://127.0.0.1:${MOCK_PORT}`;
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
      if (req.method === "POST" && url.pathname === "/bundles") {
        lastUploadBody = await req.text();
        return bundleUploadResponder();
      }
      if (req.method === "GET" && url.pathname === "/snapshots") {
        return listResponder();
      }
      return new Response("Not Found", { status: 404 });
    },
  });
  await Bun.sleep(20);
});

afterAll(() => {
  server.stop(true);
  if (savedEnvUrl === undefined) delete process.env.DEVPROFILE_ENGINE_URL;
  else process.env.DEVPROFILE_ENGINE_URL = savedEnvUrl;
  if (savedEnvPortal === undefined) delete process.env.DEVPROFILE_PORTAL_URL;
  else process.env.DEVPROFILE_PORTAL_URL = savedEnvPortal;
});

let savedDesktopOptOut: string | undefined;
let savedDesktopDir: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "devprofile-snap-"));
  savedEnvDir = process.env.DEVPROFILE_DATA_DIR;
  process.env.DEVPROFILE_DATA_DIR = workDir;
  // Prevent tests from writing to the real ~/Desktop. Each test that wants to
  // assert the desktop-copy behaviour will unset this and set DESKTOP_DIR.
  savedDesktopOptOut = process.env.DEVPROFILE_NO_DESKTOP_COPY;
  savedDesktopDir = process.env.DEVPROFILE_DESKTOP_DIR;
  process.env.DEVPROFILE_NO_DESKTOP_COPY = "1";
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
        id: "abc123",
        url: "http://127.0.0.1/v/abc123",
        ttl_days: 30,
        created_at: "2026-05-14T00:00:00Z",
      }),
      { status: 201, headers: { "Content-Type": "application/json", "X-TTL": "30" } },
    );
});

afterEach(() => {
  if (savedEnvDir === undefined) delete process.env.DEVPROFILE_DATA_DIR;
  else process.env.DEVPROFILE_DATA_DIR = savedEnvDir;
  if (savedDesktopOptOut === undefined) delete process.env.DEVPROFILE_NO_DESKTOP_COPY;
  else process.env.DEVPROFILE_NO_DESKTOP_COPY = savedDesktopOptOut;
  if (savedDesktopDir === undefined) delete process.env.DEVPROFILE_DESKTOP_DIR;
  else process.env.DEVPROFILE_DESKTOP_DIR = savedDesktopDir;
  rmSync(workDir, { recursive: true, force: true });
});

// ── snapshot generation ─────────────────────────────────────────────────────

describe("snapshotCommand — generate", () => {
  test("writes a .dpbundle file under ~/.devprofile/snapshots/", async () => {
    const { snapshotCommand } = await import("../src/commands/snapshot?v=gen1");
    await snapshotCommand();
    const snapDir = join(workDir, ".devprofile", "snapshots");
    expect(existsSync(snapDir)).toBe(true);
    const files = readdirSync(snapDir).filter((f) => f.endsWith(".dpbundle"));
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^\d{8}_[0-9a-f]{8}\.dpbundle$/);
  });

  test("snapshots directory has 0700 permissions", async () => {
    const { snapshotCommand } = await import("../src/commands/snapshot?v=gen-perms");
    await snapshotCommand();
    const snapDir = join(workDir, ".devprofile", "snapshots");
    expect(statSync(snapDir).mode & 0o777).toBe(0o700);
  });

  test("bundle has version, payload, hash, signature, public_key", async () => {
    const { snapshotCommand } = await import("../src/commands/snapshot?v=gen2");
    await snapshotCommand();
    const snapDir = join(workDir, ".devprofile", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".dpbundle"))!;
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
    const snapDir = join(workDir, ".devprofile", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".dpbundle"))!;
    const bundle = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;
    const expected = await payloadHash(bundle.payload);
    expect(bundle.hash).toBe(expected);
  });

  test("signature verifies against the embedded public_key", async () => {
    const { snapshotCommand } = await import("../src/commands/snapshot?v=gen4");
    await snapshotCommand();
    const snapDir = join(workDir, ".devprofile", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".dpbundle"))!;
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
    const out = join(workDir, "elsewhere.dpbundle");
    const { snapshotCommand } = await import("../src/commands/snapshot?v=out");
    await snapshotCommand({ output: out });
    expect(existsSync(out)).toBe(true);
    // Both copies have identical content
    const snapDir = join(workDir, ".devprofile", "snapshots");
    const primary = readdirSync(snapDir).find((f) => f.endsWith(".dpbundle"))!;
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
    expect((body.bundle_path as string).endsWith(".dpbundle")).toBe(true);
  });

  test("filename uses YYYYMMDD_<hash8>.dpbundle convention", async () => {
    const { snapshotCommand } = await import("../src/commands/snapshot?v=fname");
    await snapshotCommand();
    const snapDir = join(workDir, ".devprofile", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".dpbundle"))!;
    expect(file.startsWith("20260514_")).toBe(true);
  });

  test("auto-generates keys if missing (init hook fallback)", async () => {
    // workDir starts empty, no keys present
    const keysDir = join(workDir, ".devprofile", "keys");
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
  test("writes a copy to DEVPROFILE_DESKTOP_DIR when set", async () => {
    const desktop = mkdtempSync(join(tmpdir(), "devprofile-desktop-"));
    delete process.env.DEVPROFILE_NO_DESKTOP_COPY;
    process.env.DEVPROFILE_DESKTOP_DIR = desktop;
    try {
      const { snapshotCommand } = await import("../src/commands/snapshot?v=desktop1");
      await snapshotCommand();
      const files = readdirSync(desktop).filter((f) => f.endsWith(".dpbundle"));
      expect(files.length).toBe(1);
      // Content equals primary copy under ~/.devprofile/snapshots/
      const snapDir = join(workDir, ".devprofile", "snapshots");
      const primary = readdirSync(snapDir).find((f) => f.endsWith(".dpbundle"))!;
      expect(readFileSync(join(desktop, files[0]), "utf8")).toBe(
        readFileSync(join(snapDir, primary), "utf8"),
      );
    } finally {
      rmSync(desktop, { recursive: true, force: true });
    }
  });

  test("does NOT copy when DEVPROFILE_NO_DESKTOP_COPY=1 (default in tests)", async () => {
    // beforeEach already sets DEVPROFILE_NO_DESKTOP_COPY=1
    const desktop = mkdtempSync(join(tmpdir(), "devprofile-desktop-"));
    process.env.DEVPROFILE_DESKTOP_DIR = desktop;
    try {
      const { snapshotCommand } = await import("../src/commands/snapshot?v=desktop2");
      await snapshotCommand();
      expect(readdirSync(desktop).length).toBe(0);
    } finally {
      rmSync(desktop, { recursive: true, force: true });
    }
  });

  test("silently skips when DEVPROFILE_DESKTOP_DIR points at nonexistent path", async () => {
    delete process.env.DEVPROFILE_NO_DESKTOP_COPY;
    process.env.DEVPROFILE_DESKTOP_DIR = join(tmpdir(), "definitely-not-a-real-dir-" + Date.now());
    const { snapshotCommand } = await import("../src/commands/snapshot?v=desktop3");
    // Should not throw, primary write still works
    await snapshotCommand();
    const snapDir = join(workDir, ".devprofile", "snapshots");
    expect(readdirSync(snapDir).length).toBe(1);
  });
});

describe("snapshotCommand — --share", () => {
  test("uploads the bundle and prints the short URL", async () => {
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
    expect(out).toContain("id:");
    expect(out).toContain("abc123");
    expect(out).toContain("30 dias");
    // QR rendering produces block characters
    expect(out).toMatch(/[█▀▄]/);
    // The actual bundle was uploaded
    expect(lastUploadBody).not.toBeNull();
    const uploaded = JSON.parse(lastUploadBody!);
    expect(uploaded.hash).toMatch(/^sha256:/);
    expect(uploaded.signature).toMatch(/^ed25519:/);
  });

  test("does not abort the snapshot when upload fails", async () => {
    bundleUploadResponder = () =>
      new Response(JSON.stringify({ error: "ouch" }), { status: 500 });
    const { snapshotCommand } = await import("../src/commands/snapshot?v=share2");
    const logs: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      await snapshotCommand({ share: true });
    } finally {
      console.log = realLog;
    }
    const out = logs.join("\n");
    expect(out).toContain("Snapshot gerado");      // local bundle still produced
    expect(out).toContain("Upload falhou");
    expect(out).toContain("HTTP 500");
  });

  test("highlights deduplicated when server returns it", async () => {
    bundleUploadResponder = () =>
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
    const { snapshotCommand } = await import("../src/commands/snapshot?v=share3");
    const logs: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      await snapshotCommand({ share: true });
    } finally {
      console.log = realLog;
    }
    expect(logs.join("\n")).toContain("deduplicado");
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
            bundle_path: "/tmp/b.dpbundle",
          },
          {
            id: 1,
            hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            previous_hash: null,
            created_at: "2026-05-14T02:00:00+00:00",
            bundle_path: "/tmp/a.dpbundle",
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
    expect(out).toContain("/tmp/a.dpbundle");
    expect(out).toContain("•");                  // genesis marker
    expect(out).toContain("→");                  // linked marker
  });
});

// ── F6.8: L1/L2 composition surfaced by `devprofile snapshot` ────────────────

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
    expect(out).toContain("não disponível (execute devprofile import)");
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
    const snapDir = join(workDir, ".devprofile", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".dpbundle"))!;
    const bundle = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;
    expect(bundle.payload).toHaveProperty("l1");
    expect(bundle.payload).toHaveProperty("l2");
    expect(bundle.payload).not.toHaveProperty("signals");
  });
});

// ── attestation injection (Phase 5 / F5.6.1.e) ──────────────────────────────

describe("snapshotCommand — attestation injection", () => {
  function writeAttestationCache(workDir: string, attestation: object): void {
    const dir = join(workDir, ".devprofile");
    require("node:fs").mkdirSync(dir, { recursive: true });
    require("node:fs").writeFileSync(
      join(dir, "attestation.json"),
      JSON.stringify(attestation, null, 2) + "\n",
    );
  }

  const sampleAttestation = {
    payload: {
      type: "devprofile-identity-attestation/v1",
      platform_key_id: "devprofile-platform-2026-q2",
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
    const snapDir = join(workDir, ".devprofile", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".dpbundle"))!;
    const bundle = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;
    expect(bundle.attestation).toBeUndefined();
  });

  test("embute o conteúdo exato da cache quando ela existe", async () => {
    writeAttestationCache(workDir, sampleAttestation);
    const { snapshotCommand } = await import("../src/commands/snapshot?v=att-yes");
    await snapshotCommand();
    const snapDir = join(workDir, ".devprofile", "snapshots");
    const file = readdirSync(snapDir).find((f) => f.endsWith(".dpbundle"))!;
    const bundle = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;
    expect(bundle.attestation).toEqual(sampleAttestation);
  });

  test("attestation NÃO afeta o bundle hash (vive no wrapper, fora do payload)", async () => {
    // Snapshot sem attestation
    const { snapshotCommand: snap1 } = await import("../src/commands/snapshot?v=att-hash-no");
    await snap1();
    const snapDir = join(workDir, ".devprofile", "snapshots");
    let file = readdirSync(snapDir).find((f) => f.endsWith(".dpbundle"))!;
    const bundleNoAtt = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;

    // Cleanup
    rmSync(snapDir, { recursive: true, force: true });

    // Snapshot com attestation
    writeAttestationCache(workDir, sampleAttestation);
    const { snapshotCommand: snap2 } = await import("../src/commands/snapshot?v=att-hash-yes");
    await snap2();
    file = readdirSync(snapDir).find((f) => f.endsWith(".dpbundle"))!;
    const bundleWithAtt = JSON.parse(readFileSync(join(snapDir, file), "utf8")) as Bundle;

    // Same payload → same hash
    expect(bundleWithAtt.hash).toBe(bundleNoAtt.hash);
    expect(bundleWithAtt.attestation).toBeDefined();
    expect(bundleNoAtt.attestation).toBeUndefined();
  });
});
