/**
 * Tests for the single-source VERSION invariant and the `beheld update`
 * regression that exposed it.
 *
 * Bug background — commit 0efe9e6:
 *   `commands/update.ts` had `const VERSION = "0.3.2"` while the entrypoint
 *   declared "0.4.1". Comparison `latest === VERSION` was unreachable when
 *   the remote returned the real binary version. `commands/init.ts` carried
 *   the same stale constant and wrote it into config.json. Both now consume
 *   `src/version.ts`.
 *
 *   The companion Rails endpoint `GET /api/version` was added in the same
 *   PR — without it, `fetchLatestVersion` returned null (404) and surfaced
 *   the catch-all "Não foi possível verificar a versão disponível." This
 *   file covers the CLI side; the backend behaviour is tested in
 *   `web/source/backend/spec/requests/version_spec.rb`.
 */
import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";

import { VERSION } from "../src/version";
import { VERSION as VERSION_INDEX } from "../src/index";
import { updateCommand } from "../src/commands/update";

// ── Single-source invariant ───────────────────────────────────────────────

describe("VERSION — single source of truth", () => {
  test("src/index re-exports the same VERSION as src/version", () => {
    expect(VERSION_INDEX).toBe(VERSION);
  });

  test("VERSION is a non-empty semver string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
    // Loose semver — major.minor.patch with optional pre-release.
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  });

  test("commands/init.ts and commands/update.ts do not redeclare VERSION", async () => {
    // Regression: both files used to ship `const VERSION = "0.3.2"` as a
    // local constant. After 0efe9e6 they import it from src/version. If
    // someone re-adds a local declaration this test won't catch it directly
    // (TS allows shadowing), but the next test — comparing the imported
    // values — does.
    const initSrc = await Bun.file(
      new URL("../src/commands/init.ts", import.meta.url),
    ).text();
    const updateSrc = await Bun.file(
      new URL("../src/commands/update.ts", import.meta.url),
    ).text();
    expect(initSrc).not.toMatch(/const\s+VERSION\s*=/);
    expect(updateSrc).not.toMatch(/const\s+VERSION\s*=/);
    // Confirm they DO import from the canonical place.
    expect(initSrc).toMatch(/from\s+"\.\.\/version"/);
    expect(updateSrc).toMatch(/from\s+"\.\.\/version"/);
  });
});

// ── update flow ────────────────────────────────────────────────────────────
//
// `updateCommand` returns early in three branches before any download /
// daemon work — these are the branches the bug lived in. We intercept the
// global fetch (same trick used by snapshot.test.ts) and capture stdout to
// assert on the user-visible copy.

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_API_URL = process.env.BEHELD_API_URL;

interface CaptureHandle {
  output: string;
  restore: () => void;
}

function captureStdout(): CaptureHandle {
  const chunks: string[] = [];
  const originalLog = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args: unknown[]) => {
    chunks.push(args.map((a) => String(a)).join(" ") + "\n");
  };
  // process.stdout.write returns a boolean — keep the same signature.
  (process.stdout as unknown as { write: typeof process.stdout.write }).write =
    ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;
  return {
    get output() { return chunks.join(""); },
    restore() {
      console.log = originalLog;
      (process.stdout as unknown as { write: typeof process.stdout.write }).write = originalWrite;
    },
  };
}

/** Strip ANSI escape sequences so assertions can match the literal copy. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("updateCommand — version comparison flow", () => {
  beforeEach(() => {
    // The fake URL is never actually hit — fetch is fully mocked. We still
    // override BEHELD_API_URL so getApiBaseUrl() doesn't accidentally pick
    // up the user's real env and reshape the test.
    process.env.BEHELD_API_URL = "http://test.invalid";
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_API_URL === undefined) delete process.env.BEHELD_API_URL;
    else process.env.BEHELD_API_URL = ORIGINAL_API_URL;
  });

  test("REGRESSION — server reports same version as binary → 'já é a versão mais recente'", async () => {
    // This is the test that would have failed before 0efe9e6. With the
    // stale VERSION="0.3.2" and the binary at 0.4.1, the comparison
    // `latest === VERSION` couldn't succeed even with a working endpoint.
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(url).toContain("/api/version");
      return new Response(JSON.stringify({ version: VERSION }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const cap = captureStdout();
    try {
      await updateCommand();
    } finally {
      cap.restore();
    }

    const clean = stripAnsi(cap.output);
    expect(clean).toContain(`Beheld ${VERSION} já é a versão mais recente.`);
    // Must NOT have proceeded into the download path.
    expect(clean).not.toContain("Atualizar agora?");
    expect(clean).not.toContain("Baixando");
  });

  test("network failure → 'Não foi possível verificar a versão disponível'", async () => {
    // /api/version returns 404 (the exact production state pre-deploy of
    // VersionsController) — fetchLatestVersion sees !res.ok and returns
    // null. CLI surfaces the friendly catch-all.
    globalThis.fetch = mock(async () =>
      new Response("not found", { status: 404 }),
    ) as typeof fetch;

    const cap = captureStdout();
    try {
      await updateCommand();
    } finally {
      cap.restore();
    }
    expect(stripAnsi(cap.output)).toContain("Não foi possível verificar a versão disponível.");
  });

  test("fetch throws (DNS / timeout) → same catch-all message", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("ENOTFOUND test.invalid");
    }) as typeof fetch;

    const cap = captureStdout();
    try {
      await updateCommand();
    } finally {
      cap.restore();
    }
    expect(stripAnsi(cap.output)).toContain("Não foi possível verificar a versão disponível.");
  });

  test("malformed JSON body → null version → catch-all message", async () => {
    globalThis.fetch = mock(async () =>
      new Response("not even json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    const cap = captureStdout();
    try {
      await updateCommand();
    } finally {
      cap.restore();
    }
    expect(stripAnsi(cap.output)).toContain("Não foi possível verificar a versão disponível.");
  });

  test("JSON without 'version' field → null → catch-all message", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ release: "0.4.1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    const cap = captureStdout();
    try {
      await updateCommand();
    } finally {
      cap.restore();
    }
    expect(stripAnsi(cap.output)).toContain("Não foi possível verificar a versão disponível.");
  });

  test("endpoint URL — fetchLatestVersion hits exactly <api>/version", async () => {
    let observedUrl = "";
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      observedUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      // Return same version so the comparison short-circuits and the
      // command returns without prompting.
      return new Response(JSON.stringify({ version: VERSION }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const cap = captureStdout();
    try {
      await updateCommand();
    } finally {
      cap.restore();
    }
    // getApiUrl() returns `${BEHELD_API_URL}/api`; update appends `/version`.
    // The full URL is therefore `<BEHELD_API_URL>/api/version`.
    expect(observedUrl).toBe("http://test.invalid/api/version");
  });
});
