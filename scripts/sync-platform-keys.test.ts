import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSyncOutput } from "./sync-platform-keys";

function fixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "sync-platform-keys-"));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("buildSyncOutput", () => {
  test("estoura erro descritivo quando diretório web não existe", () => {
    expect(() =>
      buildSyncOutput("/__nonexistent_path__/keys", "test"),
    ).toThrow(/Missing/);
  });

  test("retorna lista vazia quando diretório existe sem chaves", () => {
    const { dir, cleanup } = fixture();
    try {
      const out = buildSyncOutput(dir, "test");
      expect(out.keys).toEqual([]);
      expect(out.source).toBe("test");
    } finally {
      cleanup();
    }
  });

  test("carrega uma chave ativa com todos os campos esperados", () => {
    const { dir, cleanup } = fixture();
    try {
      writeFileSync(
        join(dir, "beheld-platform-2026-q2.pub"),
        "AAAA-fake-pub-AAAA=\n",
      );
      writeFileSync(
        join(dir, "beheld-platform-2026-q2.info.json"),
        JSON.stringify({
          key_id: "beheld-platform-2026-q2",
          algorithm: "ed25519",
          created_at: "2026-05-19T18:13:07Z",
          active: true,
          revoked: false,
          rotated_at: null,
        }),
      );
      const out = buildSyncOutput(dir, "test/source");
      expect(out.keys).toHaveLength(1);
      const k = out.keys[0]!;
      expect(k.key_id).toBe("beheld-platform-2026-q2");
      expect(k.algorithm).toBe("ed25519");
      expect(k.public_key).toBe("ed25519-pub:AAAA-fake-pub-AAAA=");
      expect(k.active).toBe(true);
      expect(k.revoked).toBe(false);
      expect(k.rotated_at).toBeNull();
      expect(k.revoked_at).toBeNull();
      expect(k.revoked_reason).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("preserva revoked_at + revoked_reason em chaves revogadas", () => {
    const { dir, cleanup } = fixture();
    try {
      writeFileSync(join(dir, "k.pub"), "B=\n");
      writeFileSync(
        join(dir, "k.info.json"),
        JSON.stringify({
          key_id: "k",
          algorithm: "ed25519",
          created_at: "2026-01-01T00:00:00Z",
          active: false,
          revoked: true,
          revoked_at: "2026-04-21T03:00:00Z",
          revoked_reason: "test reason",
        }),
      );
      const out = buildSyncOutput(dir, "test");
      expect(out.keys[0]!.revoked).toBe(true);
      expect(out.keys[0]!.revoked_at).toBe("2026-04-21T03:00:00Z");
      expect(out.keys[0]!.revoked_reason).toBe("test reason");
    } finally {
      cleanup();
    }
  });

  test("ordena chaves alfabeticamente pelo nome do arquivo info.json", () => {
    const { dir, cleanup } = fixture();
    try {
      for (const id of ["c-key", "a-key", "b-key"]) {
        writeFileSync(join(dir, `${id}.pub`), "x=\n");
        writeFileSync(
          join(dir, `${id}.info.json`),
          JSON.stringify({
            key_id: id,
            algorithm: "ed25519",
            created_at: "2026-01-01T00:00:00Z",
            active: false,
            revoked: false,
          }),
        );
      }
      const out = buildSyncOutput(dir, "test");
      expect(out.keys.map((k) => k.key_id)).toEqual([
        "a-key",
        "b-key",
        "c-key",
      ]);
    } finally {
      cleanup();
    }
  });

  test("estoura erro quando info.json existe sem .pub correspondente", () => {
    const { dir, cleanup } = fixture();
    try {
      writeFileSync(
        join(dir, "orphan.info.json"),
        JSON.stringify({
          key_id: "orphan",
          algorithm: "ed25519",
          created_at: "2026-01-01T00:00:00Z",
          active: true,
          revoked: false,
        }),
      );
      expect(() => buildSyncOutput(dir, "test")).toThrow(/Missing \.pub file/);
    } finally {
      cleanup();
    }
  });

  test("normaliza rotated_at/revoked_at/revoked_reason ausentes para null", () => {
    const { dir, cleanup } = fixture();
    try {
      writeFileSync(join(dir, "k.pub"), "z=\n");
      writeFileSync(
        join(dir, "k.info.json"),
        JSON.stringify({
          key_id: "k",
          algorithm: "ed25519",
          created_at: "2026-01-01T00:00:00Z",
          active: true,
          revoked: false,
        }),
      );
      const out = buildSyncOutput(dir, "test");
      expect(out.keys[0]!.rotated_at).toBeNull();
      expect(out.keys[0]!.revoked_at).toBeNull();
      expect(out.keys[0]!.revoked_reason).toBeNull();
    } finally {
      cleanup();
    }
  });
});
