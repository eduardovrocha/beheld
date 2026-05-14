/**
 * Offline .dpbundle verification (Phase 5 / F5.3.8).
 *
 * Pure functions — no filesystem, no network. The CLI command at
 * commands/verify.ts wires these to disk I/O + console output.
 *
 * Three independent checks:
 *   1. schema    — shape sanity (defensive — `verifyBundle` is sometimes given
 *                  unknown input loaded from disk by a user)
 *   2. hash      — recomputed SHA-256 of canonical(payload) matches bundle.hash
 *   3. signature — Ed25519 verify with the embedded public_key
 *
 * Optional fourth check via `verifyChain`:
 *   4. chain     — walks previous_hash recursively, verifying each link
 */
import { payloadHash, payloadToCanonical } from "./canonical";
import type { Bundle, BundlePayload } from "./types";

export interface CheckResult {
  ok: boolean;
  reason?: string;
}

export interface VerifyResult {
  ok: boolean;
  checks: {
    schema: CheckResult;
    hash: CheckResult;
    signature: CheckResult;
  };
}

const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const SIG_RE = /^ed25519:[0-9a-f]{128}$/;
const PUBKEY_RE = /^ed25519:[A-Za-z0-9_-]+$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateSchema(raw: unknown): CheckResult {
  if (!isObject(raw)) return { ok: false, reason: "not a JSON object" };
  if (raw.version === undefined) return { ok: false, reason: "missing 'version'" };
  if (typeof raw.hash !== "string" || !HASH_RE.test(raw.hash))
    return { ok: false, reason: "malformed 'hash'" };
  if (typeof raw.signature !== "string" || !SIG_RE.test(raw.signature))
    return { ok: false, reason: "malformed 'signature'" };
  if (typeof raw.public_key !== "string" || !PUBKEY_RE.test(raw.public_key))
    return { ok: false, reason: "malformed 'public_key'" };
  if (!isObject(raw.payload)) return { ok: false, reason: "missing or invalid 'payload'" };
  const payload = raw.payload as Record<string, unknown>;
  for (const required of ["created_at", "devprofile_version", "previous_hash", "scores", "signals"]) {
    if (!(required in payload)) {
      return { ok: false, reason: `payload missing '${required}'` };
    }
  }
  return { ok: true };
}

async function verifyHash(bundle: Bundle): Promise<CheckResult> {
  const recomputed = await payloadHash(bundle.payload);
  if (recomputed === bundle.hash) return { ok: true };
  return {
    ok: false,
    reason: `hash mismatch — expected ${recomputed.slice(0, 24)}…, found ${bundle.hash.slice(0, 24)}…`,
  };
}

async function verifySignature(bundle: Bundle): Promise<CheckResult> {
  const x = bundle.public_key.replace(/^ed25519:/, "");
  let pubKey: CryptoKey;
  try {
    pubKey = await crypto.subtle.importKey(
      "jwk",
      { kty: "OKP", crv: "Ed25519", x },
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch (e) {
    return { ok: false, reason: `cannot import public_key: ${(e as Error).message}` };
  }

  const sigHex = bundle.signature.replace(/^ed25519:/, "");
  const sigMatches = sigHex.match(/.{2}/g);
  if (!sigMatches) return { ok: false, reason: "signature not valid hex" };
  const sigBytes = Uint8Array.from(sigMatches.map((b) => parseInt(b, 16)));

  const canonical = new TextEncoder().encode(payloadToCanonical(bundle.payload));

  let ok: boolean;
  try {
    ok = await crypto.subtle.verify({ name: "Ed25519" }, pubKey, sigBytes, canonical);
  } catch (e) {
    return { ok: false, reason: `verify threw: ${(e as Error).message}` };
  }
  return ok ? { ok: true } : { ok: false, reason: "signature does not match payload" };
}

export async function verifyBundle(raw: unknown): Promise<VerifyResult> {
  const schema = validateSchema(raw);
  if (!schema.ok) {
    return {
      ok: false,
      checks: {
        schema,
        hash: { ok: false, reason: "skipped (schema failed)" },
        signature: { ok: false, reason: "skipped (schema failed)" },
      },
    };
  }
  const bundle = raw as Bundle;
  const hashCheck = await verifyHash(bundle);
  const sigCheck = hashCheck.ok
    ? await verifySignature(bundle)
    : { ok: false, reason: "skipped (hash failed)" };
  return {
    ok: schema.ok && hashCheck.ok && sigCheck.ok,
    checks: { schema, hash: hashCheck, signature: sigCheck },
  };
}

// ── chain verification ──────────────────────────────────────────────────────

export type BundleResolver = (hash: string) => Promise<Bundle | null>;

export interface ChainResult extends CheckResult {
  links_verified: number;
}

const MAX_CHAIN_DEPTH = 1000;

export async function verifyChain(
  bundle: Bundle,
  resolve: BundleResolver,
): Promise<ChainResult> {
  let current: Bundle = bundle;
  let links = 0;

  while (current.payload.previous_hash !== null) {
    if (links >= MAX_CHAIN_DEPTH) {
      return { ok: false, links_verified: links, reason: "chain too deep — possible cycle" };
    }
    const prevHash = current.payload.previous_hash;
    const prev = await resolve(prevHash);
    if (!prev) {
      return {
        ok: false,
        links_verified: links,
        reason: `previous bundle ${prevHash.slice(0, 24)}… not found locally`,
      };
    }
    if (prev.hash !== prevHash) {
      return {
        ok: false,
        links_verified: links,
        reason: `resolved bundle hash differs from link (resolver returned wrong file?)`,
      };
    }
    const prevResult = await verifyBundle(prev);
    if (!prevResult.ok) {
      const failed = Object.entries(prevResult.checks).find(([, v]) => !v.ok);
      return {
        ok: false,
        links_verified: links,
        reason: `previous bundle ${prevHash.slice(0, 24)}… failed ${failed?.[0]}: ${failed?.[1].reason ?? "?"}`,
      };
    }
    current = prev;
    links++;
  }

  return { ok: true, links_verified: links };
}

// ── helper: extract embedded data for display ───────────────────────────────

export function summarize(payload: BundlePayload): string {
  const s = payload.scores;
  return `score ${s.overall}/100 · ${s.sessions_analyzed} sessões · ${payload.created_at.slice(0, 10)}`;
}
