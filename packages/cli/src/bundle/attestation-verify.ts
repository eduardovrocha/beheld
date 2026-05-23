/**
 * Offline identity-attestation verification (Phase 5 / F5.6.1.e).
 *
 * Mirrors the Rails AttestationVerifier service — same checks, same
 * orthogonal signals, no collapse into a single "trusted" boolean. The
 * caller composes its own tier from these signals (per the principle in
 * documents/platform-key-ops.md).
 *
 * No network: signing keys come from the embedded snapshot
 * (packages/cli/src/keys/platform-keys.json). A bundle whose attestation
 * references a `platform_key_id` not in the embedded set is reported as
 * key_status="unknown" — the CLI may then fetch a fresh list from
 * `/api/platform-keys` if the user opts into online cross-check.
 */
import { canonicalJson } from "./canonical";
import type { Bundle, BundleAttestation } from "./types";
import {
  EMBEDDED_PLATFORM_KEYS,
  type PlatformKey as EmbeddedPlatformKey,
} from "../keys/platform-keys";

export type AttestationKeyStatus = "active" | "rotated" | "revoked" | "unknown";

export interface AttestationCheck {
  /** Whether the bundle carries an attestation field at all. */
  present: boolean;
  /** Shape + required fields of the attestation are valid. */
  payload_valid: boolean;
  /** Ed25519 verification of the attestation signature against the
   *  embedded platform key succeeds. */
  signature_valid: boolean;
  /** Lifecycle status of the signing platform key in the embedded snapshot. */
  key_status?: AttestationKeyStatus;
  /** Revocation reason when key_status === "revoked". */
  revoked_reason?: string | null;
  /** `attestation.payload.dev_pubkey` resolves to the same raw 32 bytes as
   *  `bundle.public_key`. False here means someone swapped attestations
   *  between bundles. */
  dev_pubkey_matches?: boolean;
  /** GitHub identity surfaced for display. */
  github?: { user_id: number; login: string };
  /** Platform key id claimed in the attestation payload. */
  platform_key_id?: string;
  /** Human-readable explanation when a check fails. */
  reason?: string;
}

const ATTESTATION_TYPE = "beheld-identity-attestation/v1";
const SIG_RE = /^ed25519:([A-Za-z0-9+/=]+)$/;
const PUBKEY_PREFIX_RE = /^ed25519(-pub)?:/;

export async function verifyAttestation(
  bundle: Bundle,
  keys: ReadonlyArray<EmbeddedPlatformKey> = EMBEDDED_PLATFORM_KEYS,
): Promise<AttestationCheck> {
  if (!bundle.attestation) {
    return { present: false, payload_valid: false, signature_valid: false };
  }

  const att = bundle.attestation;
  const shape = validatePayloadShape(att);
  if (!shape.ok) {
    return {
      present: true,
      payload_valid: false,
      signature_valid: false,
      reason: shape.reason,
    };
  }

  const claimedKeyId = att.payload.platform_key_id;
  const key = keys.find((k) => k.key_id === claimedKeyId);

  if (!key) {
    return {
      present: true,
      payload_valid: true,
      signature_valid: false,
      key_status: "unknown",
      platform_key_id: claimedKeyId,
      github: { user_id: att.payload.github.user_id, login: att.payload.github.login },
      reason: `platform_key_id '${claimedKeyId}' not in embedded keys`,
    };
  }

  const sigCheck = await verifySignature(key, att);
  const devMatches = compareDevPubkey(att.payload.dev_pubkey, bundle.public_key);

  return {
    present: true,
    payload_valid: true,
    signature_valid: sigCheck.ok,
    key_status: classifyKeyStatus(key),
    revoked_reason: key.revoked_reason,
    dev_pubkey_matches: devMatches,
    github: { user_id: att.payload.github.user_id, login: att.payload.github.login },
    platform_key_id: key.key_id,
    reason: sigCheck.ok ? undefined : sigCheck.reason,
  };
}

// ── internals ────────────────────────────────────────────────────────────────

function validatePayloadShape(att: BundleAttestation): { ok: boolean; reason?: string } {
  if (typeof att !== "object" || att === null) {
    return { ok: false, reason: "attestation not an object" };
  }
  if (typeof att.signature !== "string" || !SIG_RE.test(att.signature)) {
    return { ok: false, reason: "malformed attestation.signature" };
  }
  if (typeof att.payload !== "object" || att.payload === null) {
    return { ok: false, reason: "missing attestation.payload" };
  }
  if (att.payload.type !== ATTESTATION_TYPE) {
    return { ok: false, reason: `unsupported attestation type: ${att.payload.type}` };
  }
  for (const f of ["platform_key_id", "dev_pubkey", "github", "attested_at"] as const) {
    if (!(f in att.payload)) {
      return { ok: false, reason: `missing attestation.payload.${f}` };
    }
  }
  for (const f of ["user_id", "login", "verified_at"] as const) {
    if (!(f in att.payload.github)) {
      return { ok: false, reason: `missing attestation.payload.github.${f}` };
    }
  }
  return { ok: true };
}

function classifyKeyStatus(key: EmbeddedPlatformKey): AttestationKeyStatus {
  if (key.revoked) return "revoked";
  if (!key.active) return "rotated";
  return "active";
}

async function verifySignature(
  key: EmbeddedPlatformKey,
  att: BundleAttestation,
): Promise<{ ok: boolean; reason?: string }> {
  const sigMatch = att.signature.match(SIG_RE);
  if (!sigMatch) return { ok: false, reason: "malformed signature" };
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64ToBytes(sigMatch[1]!);
  } catch (e) {
    return { ok: false, reason: `cannot decode signature: ${(e as Error).message}` };
  }

  let pubKey: CryptoKey;
  try {
    const pubB64 = key.public_key.replace(PUBKEY_PREFIX_RE, "");
    const pubBytes = base64ToBytes(pubB64);
    pubKey = await crypto.subtle.importKey(
      "jwk",
      { kty: "OKP", crv: "Ed25519", x: bytesToBase64Url(pubBytes) },
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch (e) {
    return { ok: false, reason: `cannot import platform pubkey: ${(e as Error).message}` };
  }

  const canonical = new TextEncoder().encode(canonicalJson(att.payload));
  let ok: boolean;
  try {
    ok = await crypto.subtle.verify({ name: "Ed25519" }, pubKey, sigBytes, canonical);
  } catch (e) {
    return { ok: false, reason: `verify threw: ${(e as Error).message}` };
  }
  return ok ? { ok: true } : { ok: false, reason: "attestation signature does not match payload" };
}

function compareDevPubkey(attDevPubkey: string, bundlePubkey: string): boolean {
  try {
    const attRaw = base64ToBytes(attDevPubkey.replace(PUBKEY_PREFIX_RE, ""));
    const bundleRaw = base64UrlToBytes(bundlePubkey.replace(PUBKEY_PREFIX_RE, ""));
    if (attRaw.length !== bundleRaw.length) return false;
    for (let i = 0; i < attRaw.length; i++) {
      if (attRaw[i] !== bundleRaw[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const std = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
  return base64ToBytes(padded);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
