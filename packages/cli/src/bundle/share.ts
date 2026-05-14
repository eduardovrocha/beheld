/**
 * Bundle upload + QR rendering (Phase 5 / F5.4).
 *
 * Pure functions: filesystem and CLI concerns live in commands/snapshot.ts.
 * The portal base URL is read from DEVPROFILE_PORTAL_URL (defaults to the
 * production portal). Failures are typed so the caller can degrade gracefully —
 * the local .dpbundle was already written before the share attempt.
 */
import type { Bundle } from "./types";

export const DEFAULT_PORTAL_URL = "https://devprofile.app";

export interface ShareResponse {
  id: string;
  url: string;
  ttl_days: number | null;
  created_at: string;
  deduplicated?: boolean;
}

export type ShareError =
  | { kind: "network"; message: string }
  | { kind: "http"; status: number; body: string };

export type ShareResult =
  | { ok: true; data: ShareResponse }
  | { ok: false; error: ShareError };

function portalUrl(): string {
  return (process.env.DEVPROFILE_PORTAL_URL ?? DEFAULT_PORTAL_URL).replace(/\/+$/, "");
}

export async function uploadBundle(bundle: Bundle): Promise<ShareResult> {
  const body = JSON.stringify(bundle);
  let r: Response;
  try {
    r = await fetch(`${portalUrl()}/bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return { ok: false, error: { kind: "network", message: (e as Error).message } };
  }

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return { ok: false, error: { kind: "http", status: r.status, body: text } };
  }

  const data = (await r.json()) as ShareResponse;
  return { ok: true, data };
}

// ── QR rendering (terminal-unicode) ──────────────────────────────────────────

/** Render a QR code to a string using qrcode-terminal. Wrapped as a Promise
 *  because the lib's generate() takes a callback. */
export async function renderQr(text: string, opts: { small?: boolean } = {}): Promise<string> {
  const qrcode = (await import("qrcode-terminal")).default;
  return new Promise((resolve) => {
    qrcode.generate(text, { small: opts.small ?? true }, (out: string) => resolve(out));
  });
}
