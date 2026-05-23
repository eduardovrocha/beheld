import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  attestationCachePath,
  clearAttestationCache,
  loadAttestationCache,
  saveAttestationCache,
  type CachedAttestation,
} from "../src/keys/attestation-cache";

let workDir: string;
let savedEnv: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "beheld-attest-cache-"));
  savedEnv = process.env.BEHELD_DATA_DIR;
  process.env.BEHELD_DATA_DIR = workDir;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.BEHELD_DATA_DIR;
  else process.env.BEHELD_DATA_DIR = savedEnv;
  rmSync(workDir, { recursive: true, force: true });
});

const SAMPLE: CachedAttestation = {
  payload: {
    type: "beheld-identity-attestation/v1",
    platform_key_id: "beheld-platform-2026-q2",
    dev_pubkey: "ed25519-pub:ao/AsOyFTMrORd9irGlQjbxI5C7Qb4TfZVi7sgnoyio=",
    github: {
      user_id: 12345,
      login: "octocat",
      verified_at: "2026-05-19T18:00:00Z",
    },
    attested_at: "2026-05-19T18:00:00Z",
  },
  signature: "ed25519:AAAA",
};

describe("attestation-cache", () => {
  test("loadAttestationCache retorna null quando não existe", () => {
    expect(loadAttestationCache()).toBeNull();
  });

  test("save + load roundtrip preserva o conteúdo exato", () => {
    saveAttestationCache(SAMPLE);
    expect(loadAttestationCache()).toEqual(SAMPLE);
  });

  test("save grava no path esperado dentro de BEHELD_DATA_DIR/.beheld", () => {
    saveAttestationCache(SAMPLE);
    const expected = join(workDir, ".beheld", "attestation.json");
    expect(existsSync(expected)).toBe(true);
    expect(attestationCachePath()).toBe(expected);
  });

  test("save aplica perms 0600 ao arquivo", () => {
    saveAttestationCache(SAMPLE);
    const mode = statSync(attestationCachePath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("loadAttestationCache retorna null pra arquivo corrompido", () => {
    saveAttestationCache(SAMPLE);
    Bun.write(attestationCachePath(), "not json {{");
    // Bun.write is async — use sync version
    const fs = require("node:fs");
    fs.writeFileSync(attestationCachePath(), "not json {{");
    expect(loadAttestationCache()).toBeNull();
  });

  test("clearAttestationCache remove o arquivo e retorna true", () => {
    saveAttestationCache(SAMPLE);
    expect(clearAttestationCache()).toBe(true);
    expect(existsSync(attestationCachePath())).toBe(false);
  });

  test("clearAttestationCache retorna false quando não há arquivo", () => {
    expect(clearAttestationCache()).toBe(false);
  });
});
