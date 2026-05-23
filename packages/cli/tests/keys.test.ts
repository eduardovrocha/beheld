import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ensureKeys,
  generateKeys,
  getKeyPaths,
  importPrivateKey,
  keysExist,
  loadPrivateKey,
  loadPublicJwk,
  loadPublicKey,
  publicKeyFingerprint,
  rotateKeys,
} from "../src/keys/keystore";

let workDir: string;
let savedEnv: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "beheld-keys-"));
  savedEnv = process.env.BEHELD_DATA_DIR;
  process.env.BEHELD_DATA_DIR = workDir;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.BEHELD_DATA_DIR;
  else process.env.BEHELD_DATA_DIR = savedEnv;
  rmSync(workDir, { recursive: true, force: true });
});

// ── paths ────────────────────────────────────────────────────────────────────

describe("getKeyPaths", () => {
  test("uses BEHELD_DATA_DIR when set", () => {
    const p = getKeyPaths();
    expect(p.dir).toBe(join(workDir, ".beheld", "keys"));
    expect(p.publicPath).toContain("public.jwk");
    expect(p.privatePath).toContain("private.jwk");
  });

  test("explicit baseDir overrides env", () => {
    const p = getKeyPaths(join(workDir, "custom"));
    expect(p.dir).toBe(join(workDir, "custom", "keys"));
  });
});

// ── generate ─────────────────────────────────────────────────────────────────

describe("generateKeys", () => {
  test("creates public.jwk and private.jwk", async () => {
    await generateKeys();
    const p = getKeyPaths();
    expect(existsSync(p.publicPath)).toBe(true);
    expect(existsSync(p.privatePath)).toBe(true);
  });

  test("private key file has 0600 permissions", async () => {
    await generateKeys();
    const stat = statSync(getKeyPaths().privatePath);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("public key file has 0644 permissions", async () => {
    await generateKeys();
    const stat = statSync(getKeyPaths().publicPath);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o644);
  });

  test("keys dir has 0700 permissions", async () => {
    await generateKeys();
    const stat = statSync(getKeyPaths().dir);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  test("private JWK contains 'd' field (secret half)", async () => {
    await generateKeys();
    const priv = JSON.parse(readFileSync(getKeyPaths().privatePath, "utf8"));
    expect(priv.d).toBeDefined();
    expect(priv.kty).toBe("OKP");
    expect(priv.crv).toBe("Ed25519");
  });

  test("public JWK does NOT contain 'd' (leak protection)", async () => {
    await generateKeys();
    const pub = JSON.parse(readFileSync(getKeyPaths().publicPath, "utf8"));
    expect(pub.d).toBeUndefined();
    expect(pub.x).toBeDefined();
  });
});

// ── ensureKeys (idempotent) ──────────────────────────────────────────────────

describe("ensureKeys", () => {
  test("creates keys when absent", async () => {
    const r = await ensureKeys();
    expect(r.created).toBe(true);
    expect(keysExist()).toBe(true);
  });

  test("is a no-op when keys already exist", async () => {
    await ensureKeys();
    const pubBefore = readFileSync(getKeyPaths().publicPath, "utf8");
    const r = await ensureKeys();
    const pubAfter = readFileSync(getKeyPaths().publicPath, "utf8");
    expect(r.created).toBe(false);
    expect(pubAfter).toBe(pubBefore);
  });
});

// ── sign / verify roundtrip ──────────────────────────────────────────────────

describe("sign/verify roundtrip", () => {
  test("private key signs and public key verifies", async () => {
    await generateKeys();
    const priv = await loadPrivateKey();
    const pub = await loadPublicKey();
    const data = new TextEncoder().encode("hello bundle");
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, priv, data);
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, pub, sig, data);
    expect(ok).toBe(true);
  });

  test("tampered data fails verification", async () => {
    await generateKeys();
    const priv = await loadPrivateKey();
    const pub = await loadPublicKey();
    const data = new TextEncoder().encode("hello bundle");
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, priv, data);
    const tampered = new TextEncoder().encode("hello bundle!"); // 1 byte different
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, pub, sig, tampered);
    expect(ok).toBe(false);
  });
});

// ── rotate ───────────────────────────────────────────────────────────────────

describe("rotateKeys", () => {
  test("archives previous keys and produces a new pair", async () => {
    await generateKeys();
    const oldX = loadPublicJwk().x;

    const { archived } = await rotateKeys();
    expect(existsSync(archived)).toBe(true);
    expect(existsSync(join(archived, "private.jwk"))).toBe(true);
    expect(existsSync(join(archived, "public.jwk"))).toBe(true);

    const newX = loadPublicJwk().x;
    expect(newX).not.toBe(oldX);
  });

  test("previous private key still loadable from archive", async () => {
    await generateKeys();
    const priv1 = await loadPrivateKey();
    const data = new TextEncoder().encode("signed before rotation");
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, priv1, data);

    const oldPubBefore = loadPublicJwk();
    const { archived } = await rotateKeys();

    // Verify with the archived public key — proves it stayed intact
    const archivedPubJwk = JSON.parse(readFileSync(join(archived, "public.jwk"), "utf8"));
    expect(archivedPubJwk.x).toBe(oldPubBefore.x);
    const archivedPub = await crypto.subtle.importKey(
      "jwk",
      archivedPubJwk,
      { name: "Ed25519" },
      true,
      ["verify"],
    );
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, archivedPub, sig, data);
    expect(ok).toBe(true);
  });

  test("throws when no keys exist", async () => {
    await expect(rotateKeys()).rejects.toThrow(/no keys to rotate/i);
  });

  test("multiple rotations produce distinct archive directories", async () => {
    await generateKeys();
    await rotateKeys();
    await new Promise((r) => setTimeout(r, 10));
    await rotateKeys();
    const archives = readdirSync(getKeyPaths().archiveDir);
    expect(archives.length).toBe(2);
  });
});

// ── import: JWK ──────────────────────────────────────────────────────────────

describe("importPrivateKey — JWK", () => {
  test("imports a JWK file and sign/verify works", async () => {
    // Generate elsewhere, then write as a JWK and import
    const tempPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const tempPriv = await crypto.subtle.exportKey("jwk", tempPair.privateKey);
    const srcPath = join(workDir, "imported.jwk");
    writeFileSync(srcPath, JSON.stringify({
      kty: "OKP",
      crv: "Ed25519",
      x: tempPriv.x,
      d: tempPriv.d,
    }));

    await importPrivateKey(srcPath);
    expect(keysExist()).toBe(true);

    const pub = await loadPublicKey();
    const data = new TextEncoder().encode("after import");
    const priv = await loadPrivateKey();
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, priv, data);
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, pub, sig, data);
    expect(ok).toBe(true);
  });

  test("rejects a JWK without 'd' (public-only)", async () => {
    const srcPath = join(workDir, "pub-only.jwk");
    writeFileSync(srcPath, JSON.stringify({
      kty: "OKP",
      crv: "Ed25519",
      x: "abc123",
    }));
    await expect(importPrivateKey(srcPath)).rejects.toThrow(/private key/);
  });

  test("rejects non-Ed25519 JWK", async () => {
    const srcPath = join(workDir, "rsa.jwk");
    writeFileSync(srcPath, JSON.stringify({
      kty: "RSA",
      crv: "P-256",
      x: "abc",
      d: "def",
    }));
    await expect(importPrivateKey(srcPath)).rejects.toThrow(/OKP|Ed25519/);
  });

  test("rejects malformed content", async () => {
    const srcPath = join(workDir, "garbage.jwk");
    writeFileSync(srcPath, "not json and not pem");
    await expect(importPrivateKey(srcPath)).rejects.toThrow();
  });
});

// ── import: PEM ──────────────────────────────────────────────────────────────

describe("importPrivateKey — PEM", () => {
  test("imports a PKCS#8 PEM Ed25519 private key", async () => {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
    const b64 = Buffer.from(pkcs8).toString("base64");
    const lines = b64.match(/.{1,64}/g)!.join("\n");
    const pem = `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
    const srcPath = join(workDir, "key.pem");
    writeFileSync(srcPath, pem);

    await importPrivateKey(srcPath);
    expect(keysExist()).toBe(true);

    // Public key derived from import matches the public half of the source pair
    const sourcePubJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const importedPubJwk = loadPublicJwk();
    expect(importedPubJwk.x).toBe(sourcePubJwk.x as string);
  });
});

// ── publicKeyFingerprint ─────────────────────────────────────────────────────

describe("publicKeyFingerprint", () => {
  test("is deterministic for the same key", async () => {
    await generateKeys();
    const jwk = loadPublicJwk();
    const a = await publicKeyFingerprint(jwk);
    const b = await publicKeyFingerprint(jwk);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  test("differs across distinct keys", async () => {
    await generateKeys();
    const f1 = await publicKeyFingerprint(loadPublicJwk());
    await rotateKeys();
    const f2 = await publicKeyFingerprint(loadPublicJwk());
    expect(f1).not.toBe(f2);
  });
});
