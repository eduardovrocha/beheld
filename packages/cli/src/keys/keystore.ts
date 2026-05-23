/**
 * Ed25519 keystore for signed snapshots (.beheld, Phase 5).
 *
 * Uses the Web Crypto API (crypto.subtle) — zero new deps, and the verify
 * page (Etapa G, Rails) uses the same API on the browser side, so payloads
 * sign here and verify there without conversion.
 *
 * Format on disk: JWK ({ kty: "OKP", crv: "Ed25519", x, d? }).
 * - Public key: `<beheld>/keys/public.jwk`  (0644)
 * - Private key: `<beheld>/keys/private.jwk` (0600)
 * Rotated keys are archived under `<beheld>/keys/archive/<ISO>/`.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PUB_FILENAME = "public.jwk";
export const PRIV_FILENAME = "private.jwk";

export interface KeyPaths {
  dir: string;
  publicPath: string;
  privatePath: string;
  archiveDir: string;
}

export interface Ed25519Jwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  d?: string;
}

export function getKeyPaths(baseDir?: string): KeyPaths {
  const base = baseDir
    ?? (process.env.BEHELD_DATA_DIR
      ? join(process.env.BEHELD_DATA_DIR, ".beheld")
      : join(homedir(), ".beheld"));
  const dir = join(base, "keys");
  return {
    dir,
    publicPath: join(dir, PUB_FILENAME),
    privatePath: join(dir, PRIV_FILENAME),
    archiveDir: join(dir, "archive"),
  };
}

export function keysExist(baseDir?: string): boolean {
  const paths = getKeyPaths(baseDir);
  return existsSync(paths.publicPath) && existsSync(paths.privatePath);
}

function ensureDir(dir: string, mode: number): void {
  mkdirSync(dir, { recursive: true, mode });
  // mkdir's `mode` is honored only on creation — re-chmod existing dirs.
  try { chmodSync(dir, mode); } catch { /* ignore */ }
}

function writeJwk(path: string, jwk: Ed25519Jwk, mode: number): void {
  writeFileSync(path, JSON.stringify(jwk), { mode });
  try { chmodSync(path, mode); } catch { /* ignore */ }
}

function readJwk(path: string): Ed25519Jwk {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as Ed25519Jwk;
  if (parsed.kty !== "OKP" || parsed.crv !== "Ed25519" || typeof parsed.x !== "string") {
    throw new Error(`Invalid Ed25519 JWK at ${path}`);
  }
  return parsed;
}

/** Generate a fresh keypair and persist both halves with strict permissions. */
export async function generateKeys(baseDir?: string): Promise<KeyPaths> {
  const paths = getKeyPaths(baseDir);
  ensureDir(paths.dir, 0o700);

  const pair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );
  const pubJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Ed25519Jwk;
  const privJwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as Ed25519Jwk;

  writeJwk(paths.publicPath, { kty: "OKP", crv: "Ed25519", x: pubJwk.x }, 0o644);
  writeJwk(paths.privatePath, { kty: "OKP", crv: "Ed25519", x: privJwk.x, d: privJwk.d }, 0o600);

  return paths;
}

/** Generate keys only if absent — silent in normal flow (init). */
export async function ensureKeys(baseDir?: string): Promise<{ created: boolean; paths: KeyPaths }> {
  if (keysExist(baseDir)) return { created: false, paths: getKeyPaths(baseDir) };
  const paths = await generateKeys(baseDir);
  return { created: true, paths };
}

export function loadPublicJwk(baseDir?: string): Ed25519Jwk {
  return readJwk(getKeyPaths(baseDir).publicPath);
}

export async function loadPublicKey(baseDir?: string): Promise<CryptoKey> {
  const jwk = loadPublicJwk(baseDir);
  return crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, true, ["verify"]);
}

export async function loadPrivateKey(baseDir?: string): Promise<CryptoKey> {
  const jwk = readJwk(getKeyPaths(baseDir).privatePath);
  if (!jwk.d) throw new Error("Private key JWK missing 'd' component");
  return crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
}

/** Move current key pair into archive/<timestamp>/, then generate fresh keys. */
export async function rotateKeys(baseDir?: string): Promise<{ archived: string; paths: KeyPaths }> {
  const paths = getKeyPaths(baseDir);
  if (!keysExist(baseDir)) {
    throw new Error("No keys to rotate — run `beheld init` or `beheld keys import` first");
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveTarget = join(paths.archiveDir, stamp);
  ensureDir(archiveTarget, 0o700);
  renameSync(paths.publicPath, join(archiveTarget, PUB_FILENAME));
  renameSync(paths.privatePath, join(archiveTarget, PRIV_FILENAME));
  await generateKeys(baseDir);
  return { archived: archiveTarget, paths };
}

// ── Import: accepts JWK or PEM (PKCS#8) ──────────────────────────────────────

const PEM_PRIV_RE = /-----BEGIN (?:PRIVATE|ED25519 PRIVATE) KEY-----/;

async function pemPrivateToJwk(pem: string): Promise<Ed25519Jwk> {
  const body = pem.replace(/-----BEGIN[^-]+-----|-----END[^-]+-----|\s/g, "");
  let der: Uint8Array;
  try {
    der = Uint8Array.from(Buffer.from(body, "base64"));
  } catch {
    throw new Error("Failed to base64-decode PEM body");
  }
  let imported: CryptoKey;
  try {
    imported = await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, true, ["sign"]);
  } catch (e) {
    throw new Error(`PEM is not a valid Ed25519 PKCS#8 private key: ${String(e)}`);
  }
  const jwk = (await crypto.subtle.exportKey("jwk", imported)) as Ed25519Jwk;
  return { kty: "OKP", crv: "Ed25519", x: jwk.x, d: jwk.d };
}

function parseJwkInput(content: string): Ed25519Jwk {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Content is neither a valid JWK (JSON) nor a PEM block");
  }
  const obj = parsed as Partial<Ed25519Jwk>;
  if (obj.kty !== "OKP" || obj.crv !== "Ed25519" || typeof obj.x !== "string") {
    throw new Error("JWK must have kty=OKP and crv=Ed25519");
  }
  if (typeof obj.d !== "string") {
    throw new Error("JWK is a public key only — provide the private key with the 'd' field");
  }
  return { kty: "OKP", crv: "Ed25519", x: obj.x, d: obj.d };
}

/** Imports a private key from a file (JWK or PEM); writes both halves to disk. */
export async function importPrivateKey(sourcePath: string, baseDir?: string): Promise<KeyPaths> {
  const content = readFileSync(sourcePath, "utf8");
  let priv: Ed25519Jwk;
  if (PEM_PRIV_RE.test(content)) {
    priv = await pemPrivateToJwk(content);
  } else {
    priv = parseJwkInput(content);
  }

  // Derive public via subtle (export-import roundtrip on the public side)
  const keyObj = await crypto.subtle.importKey("jwk", priv, { name: "Ed25519" }, true, ["sign"]);
  const fullJwk = (await crypto.subtle.exportKey("jwk", keyObj)) as Ed25519Jwk;

  const paths = getKeyPaths(baseDir);
  ensureDir(paths.dir, 0o700);
  writeJwk(paths.publicPath, { kty: "OKP", crv: "Ed25519", x: fullJwk.x }, 0o644);
  writeJwk(paths.privatePath, { kty: "OKP", crv: "Ed25519", x: fullJwk.x, d: fullJwk.d }, 0o600);
  return paths;
}

/** Short identifier for a public key — first 16 hex chars of SHA-256(x). */
export async function publicKeyFingerprint(jwk: Ed25519Jwk): Promise<string> {
  const xBytes = Uint8Array.from(Buffer.from(jwk.x, "base64url"));
  const digest = await crypto.subtle.digest("SHA-256", xBytes);
  return Buffer.from(digest).toString("hex").slice(0, 16);
}
