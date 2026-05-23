/**
 * Canonical JSON + SHA-256 for .beheld payloads.
 *
 * Twin of engine/src/bundle.py. Rules MUST stay byte-identical:
 *   - Object keys sorted alphabetically at every depth.
 *   - Compact separators (JSON.stringify default: no spaces).
 *   - UTF-8 encoding.
 *
 * Cross-language drift is caught by tests that compare hashes of the same
 * fixture serialized in both languages.
 */
import type { BundlePayload } from "./types";

function sortDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortDeep);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortDeep(obj[key]);
  }
  return out;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

export function payloadToCanonical(payload: BundlePayload): string {
  return canonicalJson(payload);
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function payloadHash(payload: BundlePayload): Promise<string> {
  const bytes = new TextEncoder().encode(payloadToCanonical(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${toHex(digest)}`;
}
