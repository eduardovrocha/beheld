/**
 * Sigstore Rekor submission (Phase 5 / F5.8).
 *
 * Submits a `hashedrekord` entry — the payload's SHA-256, the Ed25519
 * signature, and the dev's public key — to the public append-only log at
 * https://rekor.sigstore.dev. Anyone can later resolve the returned UUID
 * to confirm that the bundle existed at a given timestamp.
 *
 * Submission failures (network, timeout, HTTP errors) never throw: the
 * function returns null and the snapshot proceeds without the rekor field.
 * A bundle without rekor verifies cryptographically — it just sits at the
 * `engine_verified` tier instead of `fully_verifiable`.
 */
import type { RekorEntry } from "../bundle/types";

export const REKOR_PUBLIC_BASE_URL = "https://rekor.sigstore.dev";
const SUBMIT_PATH = "/api/v1/log/entries";
const TIMEOUT_MS = 10_000;

/** Resolve the Rekor base URL at call time so test env overrides take effect
 *  even after the module has been imported. */
function defaultBaseUrl(): string {
  return process.env.BEHELD_REKOR_URL ?? REKOR_PUBLIC_BASE_URL;
}

/** DER SubjectPublicKeyInfo prefix for Ed25519 (RFC 8410). 12 bytes,
 *  followed by the 32 raw key bytes → 44-byte DER blob. */
const ED25519_SPKI_PREFIX_HEX = "302a300506032b6570032100";

/** Public Rekor URL for a given entry UUID. Safe to print in CLI output. */
export function rekorEntryUrl(uuid: string, baseUrl: string = REKOR_PUBLIC_BASE_URL): string {
  return `${baseUrl}${SUBMIT_PATH}/${uuid}`;
}

function hexToBuffer(hex: string): Buffer {
  const clean = hex.replace(/^0x/, "");
  if (clean.length % 2 !== 0) throw new Error(`invalid hex length: ${clean.length}`);
  return Buffer.from(clean, "hex");
}

/** Wraps an Ed25519 raw 32-byte public key (hex) in the DER SPKI envelope
 *  Rekor's hashedrekord type expects, returning the result as base64. */
export function ed25519HexToDerB64(hexPubKey: string): string {
  const raw = hexToBuffer(hexPubKey);
  if (raw.length !== 32) throw new Error(`Ed25519 public key must be 32 bytes, got ${raw.length}`);
  const der = Buffer.concat([Buffer.from(ED25519_SPKI_PREFIX_HEX, "hex"), raw]);
  return der.toString("base64");
}

/** Build the hashedrekord request body Rekor's POST endpoint accepts. */
export function buildHashedRekord(args: {
  payloadHashHex: string;
  signatureHex: string;
  publicKeyHex: string;
}): object {
  const sigB64 = hexToBuffer(args.signatureHex).toString("base64");
  const pubB64 = ed25519HexToDerB64(args.publicKeyHex);
  return {
    kind: "hashedrekord",
    apiVersion: "0.0.1",
    spec: {
      data: {
        hash: {
          algorithm: "sha256",
          value: args.payloadHashHex.toLowerCase(),
        },
      },
      signature: {
        content: sigB64,
        publicKey: {
          content: pubB64,
        },
      },
    },
  };
}

/** Parse the Rekor response into the on-wire fields the bundle stores.
 *  Tolerates both `verification.inclusionProof.logIndex` and top-level
 *  `logIndex` since Rekor responses have shifted over versions. */
export function parseRekorResponse(json: unknown): RekorEntry | null {
  if (json == null || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  // The response is keyed by uuid → entry body.
  const keys = Object.keys(obj);
  if (keys.length === 0) return null;
  const uuid = keys[0]!;
  const entry = obj[uuid] as Record<string, unknown> | undefined;
  if (!entry || typeof entry !== "object") return null;

  const verification = entry.verification as Record<string, unknown> | undefined;
  const inclusionProof = verification?.inclusionProof as
    | Record<string, unknown>
    | undefined;

  let logIndex: number | null = null;
  if (typeof inclusionProof?.logIndex === "number") {
    logIndex = inclusionProof.logIndex;
  } else if (typeof entry.logIndex === "number") {
    logIndex = entry.logIndex;
  }
  if (logIndex == null) return null;

  const integratedTimeRaw = entry.integratedTime;
  let integratedTime: string;
  if (typeof integratedTimeRaw === "number") {
    integratedTime = new Date(integratedTimeRaw * 1000).toISOString();
  } else if (typeof integratedTimeRaw === "string") {
    integratedTime = integratedTimeRaw;
  } else {
    integratedTime = new Date().toISOString();
  }

  const set =
    (typeof verification?.signedEntryTimestamp === "string"
      ? (verification.signedEntryTimestamp as string)
      : null) ?? "";

  return {
    logIndex,
    uuid,
    integratedTime,
    signedEntryTimestamp: set,
  };
}

export interface SubmitOptions {
  /** Override the Rekor base URL (test seam). */
  baseUrl?: string;
  /** Custom fetch implementation (test seam). */
  fetchImpl?: typeof fetch;
  /** Override the per-request timeout in ms (test seam). */
  timeoutMs?: number;
}

/** Submit the bundle's signed hash to Rekor. Returns the inclusion record on
 *  success, or null on ANY failure — by contract this function never throws,
 *  so the caller can treat it as a best-effort enrichment.
 *
 *  All three inputs are hex strings (without any `sha256:` / `ed25519:`
 *  prefix the bundle uses internally). */
export async function submitToRekor(
  payloadHashHex: string,
  signatureHex: string,
  publicKeyHex: string,
  opts: SubmitOptions = {},
): Promise<RekorEntry | null> {
  const baseUrl = opts.baseUrl ?? defaultBaseUrl();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  let body: object;
  try {
    body = buildHashedRekord({ payloadHashHex, signatureHex, publicKeyHex });
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(`${baseUrl}${SUBMIT_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res || res.status !== 201) return null;
    const json = await res.json().catch(() => null);
    return parseRekorResponse(json);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Re-fetch a Rekor entry to confirm the bundle hash matches what was logged.
 *  Used by `beheld verify --verify-rekor`. Returns the entry or null. */
export async function fetchRekorEntry(
  uuid: string,
  opts: SubmitOptions = {},
): Promise<unknown | null> {
  const baseUrl = opts.baseUrl ?? defaultBaseUrl();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}${SUBMIT_PATH}/${uuid}`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!res || !res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
