/**
 * Sigstore Rekor submission (Phase 5 / F5.8 — production fix May 2026).
 *
 * Submits a `hashedrekord` entry to the public append-only log at
 * https://rekor.sigstore.dev. Anyone can later resolve the returned UUID to
 * confirm that the bundle existed at a given timestamp.
 *
 * Wire-format invariants Rekor's hashedrekord verifier enforces for Ed25519:
 *   - publicKey.content MUST be base64(PEM("BEGIN PUBLIC KEY")) — DER SPKI
 *     wrapped in the BEGIN/END envelope. Raw DER base64 returns HTTP 400
 *     "failure decoding PEM".
 *   - hash.algorithm MUST be "sha512" — Rekor rejects "sha256" for Ed25519.
 *   - signature.content MUST be base64(Ed25519.Sign(SHA-512(canonical))) —
 *     the signed bytes are the SHA-512 hash, not the original payload.
 *     This is DIFFERENT from the bundle's primary signature, which signs
 *     the canonical payload bytes directly. The caller produces this
 *     "secondary signature" specifically for Rekor.
 *
 * Failure semantics: every error is reported through a discriminated union
 * so the CLI can surface an honest message ("encoding", "timeout", etc.)
 * instead of the previous catch-all "rede indisponível".
 */
import type { RekorEntry } from "../bundle/types";

export const REKOR_PUBLIC_BASE_URL = "https://rekor.sigstore.dev";
const SUBMIT_PATH = "/api/v1/log/entries";
const DEFAULT_TIMEOUT_MS = 8_000;

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

/** Wraps an Ed25519 raw 32-byte public key (hex) in the **PEM** envelope
 *  Rekor's hashedrekord verifier requires, returning base64(PEM).
 *
 *  PEM format per RFC 7468:
 *    -----BEGIN PUBLIC KEY-----
 *    <base64 of DER SPKI, line-wrapped at 64 chars>
 *    -----END PUBLIC KEY-----
 *
 *  Rekor rejects raw DER base64 with HTTP 400 "failure decoding PEM" — this
 *  bug silently turned every submission into a noop before the fix. */
export function ed25519HexToPemB64(hexPubKey: string): string {
  const raw = hexToBuffer(hexPubKey);
  if (raw.length !== 32) {
    throw new Error(`Ed25519 public key must be 32 bytes, got ${raw.length}`);
  }
  const der = Buffer.concat([Buffer.from(ED25519_SPKI_PREFIX_HEX, "hex"), raw]);
  const derB64 = der.toString("base64");
  const lines = derB64.match(/.{1,64}/g) ?? [derB64];
  const pem = `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
  return Buffer.from(pem).toString("base64");
}

/** Build the hashedrekord request body Rekor's POST endpoint accepts for
 *  Ed25519 signers. Notice the algorithm is **sha512** — Rekor's Ed25519
 *  verifier doesn't accept sha256. The `signatureHex` must be the
 *  Ed25519 signature over the 64-byte SHA-512 hash, not over the original
 *  payload (the caller is responsible for producing this signature). */
export function buildHashedRekord(args: {
  payloadHashHex: string;
  signatureHex: string;
  publicKeyHex: string;
}): object {
  const sigB64 = hexToBuffer(args.signatureHex).toString("base64");
  const pubB64 = ed25519HexToPemB64(args.publicKeyHex);
  return {
    kind: "hashedrekord",
    apiVersion: "0.0.1",
    spec: {
      data: {
        hash: {
          algorithm: "sha512",
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
  /** Override the per-request timeout in ms (test seam). Default 8000. */
  timeoutMs?: number;
}

/** Concrete failure reason — the CLI uses this to print an honest message
 *  rather than catch-all "rede indisponível". */
export type RekorFailureReason =
  | "encoding"  // local: bad hex / wrong key length — never reached Rekor
  | "timeout"   // request aborted at timeoutMs
  | "network"   // fetch threw (DNS, connection refused, TLS, etc.)
  | "rejected"  // Rekor responded but with a non-2xx status
  | "malformed"; // Rekor returned 201 but the body didn't parse

export type RekorSubmitResult =
  | { ok: true; entry: RekorEntry }
  | { ok: false; reason: RekorFailureReason; detail: string };

export interface SubmitArgs {
  /** SHA-512 hex of the canonical payload bytes (what Rekor will index). */
  rekorHashHex: string;
  /** Ed25519 signature (hex) over the SHA-512 hash bytes. This is the
   *  "secondary signature" the caller produced specifically for Rekor —
   *  it is NOT the bundle's primary signature. */
  rekorSignatureHex: string;
  /** Dev's Ed25519 public key, raw 32-byte hex. */
  publicKeyHex: string;
}

/** Submit a hashedrekord entry to Sigstore Rekor. Returns a discriminated
 *  result so the caller can render an honest message on failure.
 *
 *  By contract this function does NOT throw — every error path becomes
 *  a `{ ok: false, reason, detail }` result. */
export async function submitToRekor(
  args: SubmitArgs,
  opts: SubmitOptions = {},
): Promise<RekorSubmitResult> {
  const baseUrl = opts.baseUrl ?? defaultBaseUrl();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let body: object;
  try {
    body = buildHashedRekord({
      payloadHashHex: args.rekorHashHex,
      signatureHex: args.rekorSignatureHex,
      publicKeyHex: args.publicKeyHex,
    });
  } catch (err) {
    return { ok: false, reason: "encoding", detail: (err as Error).message };
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
    if (!res) {
      return { ok: false, reason: "network", detail: "fetch returned no response" };
    }
    if (res.status !== 201) {
      const text = (await res.text().catch(() => "")) || "";
      const snippet = text.length > 200 ? text.slice(0, 200) + "…" : text;
      return {
        ok: false,
        reason: "rejected",
        detail: `HTTP ${res.status} ${res.statusText}${snippet ? ` — ${snippet}` : ""}`,
      };
    }
    const json = await res.json().catch(() => null);
    const entry = parseRekorResponse(json);
    if (!entry) {
      return { ok: false, reason: "malformed", detail: "Rekor returned 201 but the response did not parse" };
    }
    return { ok: true, entry };
  } catch (err) {
    // AbortError on timeout vs other network errors.
    const name = (err as { name?: string }).name ?? "";
    if (name === "AbortError" || name === "TimeoutError") {
      return { ok: false, reason: "timeout", detail: `aborted after ${timeoutMs}ms` };
    }
    return { ok: false, reason: "network", detail: (err as Error).message };
  } finally {
    clearTimeout(timeout);
  }
}

/** Re-fetch a Rekor entry to confirm the bundle hash matches what was logged.
 *  Used by `beheld verify --verify-rekor`. Returns the raw JSON entry or null
 *  on any failure — the verify command treats null as "could not confirm". */
export async function fetchRekorEntry(
  uuid: string,
  opts: SubmitOptions = {},
): Promise<unknown | null> {
  const baseUrl = opts.baseUrl ?? defaultBaseUrl();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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
