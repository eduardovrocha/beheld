/**
 * Bundle publish — uploads a signed .beheld to the portal's
 * `POST /api/v1/bundles` endpoint and returns the public URL.
 *
 * The portal verifies the Ed25519 signature against the fingerprint we send
 * alongside the bundle. If verification fails, the bundle is rejected and
 * never stored. The dev's private key never leaves the machine.
 *
 * Pure functions: filesystem and prompt concerns live in commands/share.ts
 * and commands/snapshot.ts. The portal base URL is read from the central
 * env config module (`BEHELD_ENV` + `BEHELD_PORTAL_URL` override).
 */
import { getPortalUrl } from "../config/env";
import type { Bundle } from "./types";

/** Production portal URL — kept as an exported constant for tests and
 *  legacy importers (e.g. `commands/auth.ts`). The actual resolution at
 *  runtime uses the central env config so `BEHELD_ENV=development` and
 *  `BEHELD_PORTAL_URL` overrides apply. */
export const DEFAULT_PORTAL_URL = "https://beheld.dev";

export interface PublishResponse {
  url: string;
  account_created: boolean;
  bundle_id: string;
}

export type PublishError =
  | { kind: "network"; message: string }
  | { kind: "http"; status: number; body: string };

export type PublishResult =
  | { ok: true; data: PublishResponse }
  | { ok: false; error: PublishError };

export interface PublishOptions {
  /** Optional fetch override — used by tests to stub the network. */
  fetcher?: typeof fetch;
  /** Optional recovery email — sent only on first publish. */
  emailRecovery?: string | null;
  /** Optional abort timeout in ms (defaults to 10s). */
  timeoutMs?: number;
}

function portalUrl(): string {
  return getPortalUrl();
}

/** Strip the `ed25519:` / `sha256:` / etc. prefix when present. */
function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/** JWK `x` (base64url, unpadded) → raw bytes hex. The portal expects the
 *  fingerprint as a hex public key — same form the auth flow already uses. */
export function publicKeyHex(bundle: Bundle): string {
  const raw = stripPrefix(bundle.public_key, "ed25519:");
  return Buffer.from(raw, "base64url").toString("hex");
}

export async function publishBundle(
  bundle: Bundle,
  options: PublishOptions = {},
): Promise<PublishResult> {
  const fetcher = options.fetcher ?? fetch;
  const bundleB64 = Buffer.from(JSON.stringify(bundle), "utf8").toString("base64");
  const body: Record<string, string> = {
    fingerprint: publicKeyHex(bundle),
    bundle:      bundleB64,
  };
  if (options.emailRecovery) body.email_recovery = options.emailRecovery;

  let r: Response;
  try {
    r = await fetcher(`${portalUrl()}/api/v1/bundles`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch (e) {
    return { ok: false, error: { kind: "network", message: (e as Error).message } };
  }

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return { ok: false, error: { kind: "http", status: r.status, body: text } };
  }

  const data = (await r.json()) as PublishResponse;
  return { ok: true, data };
}

/** Extract the slug from a URL like https://beheld.dev/v/abc123def. */
export function slugFromUrl(url: string): string | null {
  const m = url.match(/\/v\/([A-Za-z0-9]+)\/?$/);
  return m ? m[1] : null;
}

// ── QR rendering (terminal-unicode) ──────────────────────────────────────────

export async function renderQr(text: string, opts: { small?: boolean } = {}): Promise<string> {
  const qrcode = (await import("qrcode-terminal")).default;
  return new Promise((resolve) => {
    qrcode.generate(text, { small: opts.small ?? true }, (out: string) => resolve(out));
  });
}
