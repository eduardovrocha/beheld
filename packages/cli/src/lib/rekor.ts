/**
 * Sigstore Rekor submission via @sigstore/sign (Phase 5 / F5.8 — production
 * fix May 2026).
 *
 * Beheld bundles are signed with Ed25519 raw keys (not Fulcio X.509 certs).
 * Rekor's `hashedrekord` entry type is the obvious path for "here's a hash
 * and a signature" but its Ed25519 verifier is undocumented/broken — every
 * combination tested (sign(digest), sign(hex string), sign(data)) returns
 * HTTP 400 "ed25519: invalid signature".
 *
 * The working path is the canonical Sigstore one: submit a DSSE envelope as
 * an `intoto` (or `dsse`) Rekor entry. The DSSE PAE framing prevents
 * type-confusion attacks and Rekor's DSSE verifier handles Ed25519
 * correctly. We delegate the wire-format details to @sigstore/sign so we
 * inherit their bug fixes and don't have to track Rekor's API drift.
 *
 * What this module produces for the bundle:
 *   - logIndex: numeric position in the public Rekor log
 *   - uuid:     entry hash (sha256 of the canonicalized body), used by
 *               verifier-facing tools
 *   - integratedTime: ISO timestamp of inclusion
 *   - signedEntryTimestamp: SET issued by Rekor (base64)
 *
 * Public URL pattern for humans:
 *   https://search.sigstore.dev/?logIndex=<N>
 * Pattern for API/auditing tools:
 *   https://rekor.sigstore.dev/api/v1/log/entries/<uuid>
 *
 * Failure semantics: discriminated union so the CLI can surface an honest
 * message ("encoding", "timeout", "network", "rejected") instead of the
 * pre-fix catch-all "rede indisponível".
 */
import * as cryptoNode from "node:crypto";

import { DSSEBundleBuilder, RekorWitness } from "@sigstore/sign";
import type { Signer, Signature } from "@sigstore/sign/dist/signer/signer";

import { getRekorUrl } from "../config/env";
import type { RekorEntry } from "../bundle/types";

/** Production Rekor URL. Exported as a stable constant for tests and
 *  `rekorEntryUrl`'s explicit fallback parameter. At runtime, callers
 *  use `defaultBaseUrl()` so `BEHELD_ENV=development` and
 *  `BEHELD_REKOR_URL` override apply. */
export const REKOR_PUBLIC_BASE_URL = "https://rekor.sigstore.dev";
const SUBMIT_PATH = "/api/v1/log/entries";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_PAYLOAD_TYPE = "application/vnd.in-toto+json";

/** Resolve the Rekor base URL at call time so test env overrides take effect
 *  even after the module has been imported. */
function defaultBaseUrl(): string {
  return getRekorUrl();
}

/** Wraps an Ed25519 raw 32-byte public key (hex) in the PEM envelope
 *  sigstore-js expects in the KeyMaterial.publicKey field. */
const ED25519_SPKI_PREFIX_HEX = "302a300506032b6570032100";

export function ed25519HexToPem(hexPubKey: string): string {
  if (hexPubKey.length !== 64) {
    throw new Error(`Ed25519 public key must be 32 bytes (64 hex), got ${hexPubKey.length}`);
  }
  const der = Buffer.concat([
    Buffer.from(ED25519_SPKI_PREFIX_HEX, "hex"),
    Buffer.from(hexPubKey, "hex"),
  ]);
  const lines = der.toString("base64").match(/.{1,64}/g) ?? [der.toString("base64")];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

/** Public Rekor URL for a given entry UUID — auditor-facing JSON. */
export function rekorEntryUrl(uuid: string, baseUrl: string = REKOR_PUBLIC_BASE_URL): string {
  return `${baseUrl}${SUBMIT_PATH}/${uuid}`;
}

/** User-friendly Sigstore search UI URL for a given log index. Safe to put
 *  in the public HTML retrato — anyone can open it and see the inclusion. */
export function rekorSearchUrl(logIndex: number): string {
  return `https://search.sigstore.dev/?logIndex=${logIndex}`;
}

export interface SubmitOptions {
  /** Override the Rekor base URL (test seam). */
  baseUrl?: string;
  /** Override the per-request timeout in ms (test seam). Default 8000. */
  timeoutMs?: number;
}

/** Concrete failure reason — the CLI uses this to print an honest message. */
export type RekorFailureReason =
  | "encoding"
  | "timeout"
  | "network"
  | "rejected"
  | "malformed";

export type RekorSubmitResult =
  | { ok: true; entry: RekorEntry }
  | { ok: false; reason: RekorFailureReason; detail: string };

export interface SubmitArgs {
  /** Bytes of the payload to be sealed in the DSSE envelope. Beheld uses
   *  the canonical bundle.payload JSON as the payload. */
  payloadBytes: Uint8Array;
  /** Web Crypto Ed25519 private key (e.g. from loadPrivateKey()). */
  privateKey: CryptoKey;
  /** Raw 32-byte hex of the matching Ed25519 public key. */
  publicKeyHex: string;
  /** Optional payloadType for the DSSE envelope. Defaults to
   *  application/vnd.in-toto+json which Rekor's intoto type expects. */
  payloadType?: string;
}

/** Build a Signer wrapping the Web Crypto Ed25519 key for @sigstore/sign.
 *  Returns a Buffer signature + the PEM-wrapped public key as KeyMaterial. */
function makeSigner(privateKey: CryptoKey, publicKeyHex: string): Signer {
  const pubPem = ed25519HexToPem(publicKeyHex);
  return {
    async sign(data: Buffer): Promise<Signature> {
      const sigBuf = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, data);
      return {
        signature: Buffer.from(sigBuf),
        key: { $case: "publicKey", publicKey: pubPem, hint: "" },
      };
    },
  };
}

/** Translate sigstore-js's bigint-string + Uint8Array fields into the
 *  bundle's stable wire shape. The sha256 of canonicalizedBody is the
 *  Rekor entry UUID (the path component in the public API URL). */
function tlogToRekorEntry(tlog: {
  logIndex: string;
  integratedTime: string;
  canonicalizedBody: Uint8Array | Buffer;
  inclusionPromise?: { signedEntryTimestamp?: Uint8Array | Buffer };
}): RekorEntry {
  const body = Buffer.from(tlog.canonicalizedBody);
  const uuid = cryptoNode.createHash("sha256").update(body).digest("hex");
  const integratedTime = new Date(Number(tlog.integratedTime) * 1000).toISOString();
  const set = tlog.inclusionPromise?.signedEntryTimestamp
    ? Buffer.from(tlog.inclusionPromise.signedEntryTimestamp).toString("base64")
    : "";
  return {
    logIndex: Number(tlog.logIndex),
    uuid,
    integratedTime,
    signedEntryTimestamp: set,
  };
}

/** Map @sigstore/sign exceptions into our discriminated result. The library
 *  wraps HTTP and crypto errors in InternalError with a `code` field; we
 *  use both the code and the message to classify. */
function classifyError(err: unknown): { reason: RekorFailureReason; detail: string } {
  const e = err as { name?: string; message?: string; code?: string; cause?: unknown };
  const name = e.name ?? "";
  const code = e.code ?? "";
  const msg = e.message ?? String(err);

  if (name === "AbortError" || name === "TimeoutError" || code === "ETIMEDOUT") {
    return { reason: "timeout", detail: msg };
  }
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ENETUNREACH") {
    return { reason: "network", detail: msg };
  }
  // sigstore-js InternalError surfaces HTTP rejections under "TLOG_CREATE_ENTRY_ERROR"
  if (code === "TLOG_CREATE_ENTRY_ERROR" || /HTTP \d{3}/.test(msg)) {
    return { reason: "rejected", detail: msg };
  }
  if (/illegal base64|invalid hex|must be 32 bytes/i.test(msg)) {
    return { reason: "encoding", detail: msg };
  }
  return { reason: "network", detail: msg };
}

/** Submit a DSSE-wrapped intoto entry to Sigstore Rekor.
 *
 *  By contract, never throws — every error path becomes a
 *  `{ ok: false, reason, detail }` result so the CLI can render a
 *  reason-specific message. */
export async function submitToRekor(
  args: SubmitArgs,
  opts: SubmitOptions = {},
): Promise<RekorSubmitResult> {
  const baseUrl = opts.baseUrl ?? defaultBaseUrl();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let signer: Signer;
  try {
    signer = makeSigner(args.privateKey, args.publicKeyHex);
  } catch (err) {
    return { ok: false, reason: "encoding", detail: (err as Error).message };
  }

  const witness = new RekorWitness({
    rekorBaseURL: baseUrl,
    entryType: "dsse",
    timeout: timeoutMs,
    retry: { retries: 0 },  // single try — matches Beheld policy
  });
  const builder = new DSSEBundleBuilder({ signer, witnesses: [witness] });

  try {
    const bundle = await builder.create({
      data: Buffer.from(args.payloadBytes),
      type: args.payloadType ?? DEFAULT_PAYLOAD_TYPE,
    });
    const tlog = bundle.verificationMaterial?.tlogEntries?.[0];
    if (!tlog) {
      return {
        ok: false,
        reason: "malformed",
        detail: "Rekor accepted the submission but returned no tlog entry",
      };
    }
    return { ok: true, entry: tlogToRekorEntry(tlog) };
  } catch (err) {
    return { ok: false, ...classifyError(err) };
  }
}

/** Parse the raw Rekor entry JSON (response of GET /api/v1/log/entries/{uuid})
 *  into the wire shape used by the bundle. Used by `beheld verify --verify-rekor`
 *  to cross-check a stored RekorEntry against the live log. The submission
 *  path uses sigstore-js's own parser; this is only for read-back. */
export function parseRekorResponse(json: unknown): RekorEntry | null {
  if (json == null || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
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
    typeof verification?.signedEntryTimestamp === "string"
      ? (verification.signedEntryTimestamp as string)
      : "";

  return { logIndex, uuid, integratedTime, signedEntryTimestamp: set };
}

/** Re-fetch a Rekor entry to confirm the bundle hash matches what was logged.
 *  Used by `beheld verify --verify-rekor`. Returns the raw JSON entry or null
 *  on any failure — the verify command treats null as "could not confirm". */
export async function fetchRekorEntry(
  uuid: string,
  opts: SubmitOptions = {},
): Promise<unknown | null> {
  const baseUrl = opts.baseUrl ?? defaultBaseUrl();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${SUBMIT_PATH}/${uuid}`, {
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
