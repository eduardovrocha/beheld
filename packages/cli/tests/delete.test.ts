import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { revokeRemoteAttestation, __test } from "../src/commands/delete";
import { saveAttestationCache, type CachedAttestation } from "../src/keys/attestation-cache";
import { generateKeys, loadPublicJwk } from "../src/keys/keystore";

const ORIGINAL_FETCH = globalThis.fetch;

let workDir: string;
let savedDataDir: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "beheld-delete-"));
  savedDataDir = process.env.BEHELD_DATA_DIR;
  process.env.BEHELD_DATA_DIR = workDir;
});

afterEach(() => {
  if (savedDataDir === undefined) delete process.env.BEHELD_DATA_DIR;
  else process.env.BEHELD_DATA_DIR = savedDataDir;
  rmSync(workDir, { recursive: true, force: true });
  globalThis.fetch = ORIGINAL_FETCH;
});

function dataDir(): string {
  return join(workDir, ".beheld");
}

async function plantAttestationAndKeys(): Promise<{ attestation: CachedAttestation }> {
  await generateKeys();
  const pubJwk = loadPublicJwk();
  // attestation-cache wire format: dev_pubkey is "ed25519-pub:<std-b64>".
  // Convert JWK x (base64url) → std-b64.
  const stdB64 = Buffer.from(pubJwk.x, "base64url").toString("base64");

  const attestation: CachedAttestation = {
    payload: {
      type: "beheld-identity-attestation/v1",
      platform_key_id: "beheld-platform-2026-q2",
      dev_pubkey: `ed25519-pub:${stdB64}`,
      github: { user_id: 42, login: "octocat", verified_at: "2026-05-19T18:00:00Z" },
      attested_at: "2026-05-19T18:00:00Z",
    },
    signature: "ed25519:AAAA",
  };
  saveAttestationCache(attestation);
  return { attestation };
}

// ── revokeRemoteAttestation ─────────────────────────────────────────────────

describe("revokeRemoteAttestation", () => {
  test("returns 'not_attested' when there's no cached attestation", async () => {
    expect(await revokeRemoteAttestation()).toBe("not_attested");
  });

  test("signs payload + POSTs to /api/attestation/revoke with hex fields", async () => {
    await plantAttestationAndKeys();

    let captured: { url: string; body: Record<string, unknown> } | null = null;
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(input), body: JSON.parse(String(init?.body ?? "{}")) };
      return new Response(JSON.stringify({ revoked: true }), { status: 200 });
    }) as typeof fetch;

    const result = await revokeRemoteAttestation({
      apiUrlOverride: "https://test.invalid",
    });

    expect(result).toBe("revoked");
    expect(captured).not.toBeNull();
    expect(captured!.url).toBe("https://test.invalid/api/attestation/revoke");
    expect(captured!.body.public_key).toMatch(/^[0-9a-f]{64}$/);
    expect(captured!.body.signed_revocation).toMatch(/^[0-9a-f]{128}$/);
    expect(captured!.body.issued_at).toBe("2026-05-19T18:00:00Z");
    expect(typeof captured!.body.timestamp).toBe("string");
  });

  test("returns 'server_offline' when fetch throws (network unreachable)", async () => {
    await plantAttestationAndKeys();
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    expect(await revokeRemoteAttestation({ apiUrlOverride: "http://nowhere" })).toBe(
      "server_offline",
    );
  });

  test("returns 'server_offline' for 5xx responses", async () => {
    await plantAttestationAndKeys();
    globalThis.fetch = mock(async () =>
      new Response("oops", { status: 503 }),
    ) as typeof fetch;

    expect(await revokeRemoteAttestation({ apiUrlOverride: "http://x" })).toBe(
      "server_offline",
    );
  });

  test("returns 'failed' for 4xx responses (e.g. signature mismatch)", async () => {
    await plantAttestationAndKeys();
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ error: "bad sig" }), { status: 422 }),
    ) as typeof fetch;

    expect(await revokeRemoteAttestation({ apiUrlOverride: "http://x" })).toBe("failed");
  });
});

// ── devprofile residue cleanup ──────────────────────────────────────────────

describe("scrubClaudeSettingsDevprofile", () => {
  test("removes string entries that mention devprofile from permissions allowlist", () => {
    const home = workDir;
    const settingsPath = join(home, ".claude", "settings.json");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        permissions: {
          allow: [
            "Bash(devprofile stop *)",
            "Bash(beheld view *)",
            "Read(//Users/eduardovrocha/.devprofile/**)",
          ],
          deny: [],
        },
        otherField: "untouched",
      }),
    );

    const r = __test.scrubClaudeSettingsDevprofile(home);
    expect(r.found).toBe(true);

    const after = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      permissions: { allow: string[]; deny: string[] };
      otherField: string;
    };
    expect(after.permissions.allow).toEqual(["Bash(beheld view *)"]);
    expect(after.permissions.deny).toEqual([]);
    expect(after.otherField).toBe("untouched");
  });

  test("no-ops when settings.json has no devprofile references", () => {
    const home = workDir;
    const settingsPath = join(home, ".claude", "settings.json");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ permissions: { allow: ["Bash(beheld *)"] } }));

    const r = __test.scrubClaudeSettingsDevprofile(home);
    expect(r.found).toBe(false);
  });
});

describe("cleanupDevprofileResidues (per-platform)", () => {
  test("macOS plist branch removes the file when present", () => {
    const home = workDir;
    const plistDir = join(home, "Library", "LaunchAgents");
    mkdirSync(plistDir, { recursive: true });
    const plist = join(plistDir, "com.devprofile.daemon.plist");
    writeFileSync(plist, "<?xml version='1.0'?>");

    const r = __test.removeMacosDevprofileResidue(home);
    expect(r.found).toBe(true);
    expect(existsSync(plist)).toBe(false);
  });

  test("Linux systemd branch removes the unit file when present", () => {
    const home = workDir;
    const unitDir = join(home, ".config", "systemd", "user");
    mkdirSync(unitDir, { recursive: true });
    const unit = join(unitDir, "devprofile.service");
    writeFileSync(unit, "[Unit]\n");

    const r = __test.removeLinuxDevprofileResidue(home);
    expect(r.found).toBe(true);
    expect(existsSync(unit)).toBe(false);
  });

  test("both platform helpers no-op when residue is absent", () => {
    expect(__test.removeMacosDevprofileResidue(workDir).found).toBe(false);
    expect(__test.removeLinuxDevprofileResidue(workDir).found).toBe(false);
  });
});

// ── countSessions ───────────────────────────────────────────────────────────

describe("countSessions", () => {
  test("returns 0 when sessions dir doesn't exist", () => {
    expect(__test.countSessions(dataDir())).toBe(0);
  });

  test("counts only .jsonl files in sessions/", () => {
    const sess = join(dataDir(), "sessions");
    mkdirSync(sess, { recursive: true });
    writeFileSync(join(sess, "a.jsonl"), "");
    writeFileSync(join(sess, "b.jsonl"), "");
    writeFileSync(join(sess, "ignored.txt"), "");
    expect(__test.countSessions(dataDir())).toBe(2);
  });
});
