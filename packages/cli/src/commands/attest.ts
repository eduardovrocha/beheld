/**
 * `devprofile attest` — bind the developer's Ed25519 pubkey to a GitHub
 * identity by completing the OAuth flow with the platform backend
 * (Phase 5 / F5.6.1.d).
 *
 * Loopback HTTP variant:
 *   1. Spawn a local HTTP server on a random ephemeral port.
 *   2. Open the user's browser to `/api/auth/github/start` carrying our
 *      cli_state + cli_port + dev_pubkey.
 *   3. After GitHub authorization, the backend signs an attestation and
 *      redirects the browser to `http://localhost:<port>/callback?...`.
 *   4. Our local server receives that, validates cli_state, exchanges the
 *      claim_code for the attestation JSON via
 *      `POST /api/attestation/claim`, and writes it to the cache.
 *
 * On disk the attestation lives at `~/.devprofile/attestation.json`.
 * `devprofile snapshot` (F5.6.1.e) picks it up and embeds it in bundles.
 */
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

import { loadPublicJwk } from "../keys/keystore";
import {
  type CachedAttestation,
  saveAttestationCache,
} from "../keys/attestation-cache";
import { arrow, bold, brand, fail, meta, ok } from "../ui/styles";

const DEFAULT_API_URL = process.env.DEVPROFILE_API_URL ?? "http://localhost:3000";
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export interface AttestOptions {
  url?: string;
  /** Test seam — override the cache directory. */
  dataDir?: string;
}

export async function attestCommand(opts: AttestOptions = {}): Promise<void> {
  const baseUrl = opts.url ?? DEFAULT_API_URL;

  console.log(brand("verificando identidade GitHub"));

  const jwk = await loadPublicJwk();
  const devPubkeyStdB64 = jwkXToStdB64(jwk.x);
  const devPubkey = `ed25519-pub:${devPubkeyStdB64}`;
  const cliState = generateCliState();

  console.log(arrow(`subindo servidor local para callback`));
  const session = startCallbackServer({ cliState, timeoutMs: CALLBACK_TIMEOUT_MS });

  const startUrl = buildStartUrl({
    baseUrl,
    cliState,
    cliPort: session.port,
    devPubkey,
  });

  console.log(arrow(`abrindo navegador em ${meta(baseUrl)}`));
  await openBrowser(startUrl).catch(() => {
    console.log(arrow(`não foi possível abrir o navegador automaticamente`));
    console.log(arrow(`abra manualmente: ${startUrl}`));
  });

  let claimCode: string;
  try {
    claimCode = await session.claimCodePromise;
  } catch (err) {
    session.stop();
    console.error(fail(`flow interrompido: ${(err as Error).message}`));
    process.exit(1);
  }

  console.log(arrow(`recebendo attestation`));
  const attestation = await claimAttestation(baseUrl, claimCode);

  saveAttestationCache(attestation, opts.dataDir);

  console.log(ok("identidade atestada"));
  console.log(`  ${bold("github:")}        ${attestation.payload.github.login} (id=${attestation.payload.github.user_id})`);
  console.log(`  ${bold("platform_key:")}  ${attestation.payload.platform_key_id}`);
  console.log(`  ${bold("attested_at:")}   ${attestation.payload.attested_at}`);
}

// ── pure helpers (exported for testing) ──────────────────────────────────────

/** Convert a JWK `x` value (base64url, unpadded) to standard base64 (padded).
 *  The platform backend expects standard base64 in `dev_pubkey`. */
export function jwkXToStdB64(jwkX: string): string {
  const std = jwkX.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (std.length % 4)) % 4;
  return std + "=".repeat(padLen);
}

export function generateCliState(): string {
  return randomBytes(24).toString("base64url");
}

export function buildStartUrl(args: {
  baseUrl: string;
  cliState: string;
  cliPort: number;
  devPubkey: string;
}): string {
  const params = new URLSearchParams({
    cli_state: args.cliState,
    cli_port: String(args.cliPort),
    dev_pubkey: args.devPubkey,
  });
  return `${args.baseUrl}/api/auth/github/start?${params.toString()}`;
}

export interface CallbackParams {
  cliState: string;
  claimCode: string;
}

export function parseCallbackQuery(searchParams: URLSearchParams): CallbackParams {
  const cliState = searchParams.get("cli_state");
  const claimCode = searchParams.get("claim_code");
  if (!cliState) throw new Error("missing cli_state in callback");
  if (!claimCode) throw new Error("missing claim_code in callback");
  return { cliState, claimCode };
}

export async function claimAttestation(
  baseUrl: string,
  claimCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CachedAttestation> {
  const res = await fetchImpl(`${baseUrl}/api/attestation/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claim_code: claimCode }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`claim failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as CachedAttestation;
}

// ── loopback server ──────────────────────────────────────────────────────────

interface CallbackSession {
  port: number;
  claimCodePromise: Promise<string>;
  stop: () => void;
}

const SUCCESS_HTML = `<!doctype html>
<html><head><title>DevProfile — autorizado</title>
<meta charset="utf-8">
<style>
  body{font-family:-apple-system,Segoe UI,sans-serif;text-align:center;padding:3rem;color:#222;background:#fafafa}
  h1{color:#0a7d2c}
  p{color:#555}
</style></head>
<body>
  <h1>✓ identidade atestada</h1>
  <p>Pode fechar esta aba e voltar ao terminal.</p>
</body></html>`;

function startCallbackServer(opts: { cliState: string; timeoutMs: number }): CallbackSession {
  let resolveClaim!: (code: string) => void;
  let rejectClaim!: (err: Error) => void;
  const claimCodePromise = new Promise<string>((res, rej) => {
    resolveClaim = res;
    rejectClaim = rej;
  });

  const timeoutHandle = setTimeout(() => {
    rejectClaim(new Error("timeout aguardando callback do OAuth (5 min)"));
    try { server.stop(); } catch { /* already stopped */ }
  }, opts.timeoutMs);

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/callback") {
        return new Response("not found", { status: 404 });
      }
      try {
        const { cliState, claimCode } = parseCallbackQuery(url.searchParams);
        if (cliState !== opts.cliState) {
          rejectClaim(new Error("cli_state mismatch — possível CSRF"));
          clearTimeout(timeoutHandle);
          queueShutdown();
          return new Response("cli_state mismatch", { status: 400 });
        }
        resolveClaim(claimCode);
        clearTimeout(timeoutHandle);
        queueShutdown();
        return new Response(SUCCESS_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      } catch (err) {
        rejectClaim(err as Error);
        clearTimeout(timeoutHandle);
        queueShutdown();
        return new Response((err as Error).message, { status: 400 });
      }
    },
  });

  // Give the browser a beat to receive the response before we stop the server.
  function queueShutdown(): void {
    setTimeout(() => {
      try { server.stop(); } catch { /* already stopped */ }
    }, 100);
  }

  return {
    port: server.port,
    claimCodePromise,
    stop: () => {
      clearTimeout(timeoutHandle);
      try { server.stop(); } catch { /* already stopped */ }
    },
  };
}

async function openBrowser(url: string): Promise<void> {
  const cmd =
    process.platform === "darwin" ? ["open", url]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : ["xdg-open", url];
  const proc = spawn(cmd[0]!, cmd.slice(1), { stdio: "ignore", detached: true });
  proc.unref();
  return new Promise((resolve, reject) => {
    proc.on("error", reject);
    // Don't wait for the browser to exit — just for spawn to succeed.
    setTimeout(resolve, 50);
  });
}
