/**
 * `beheld auth` — authenticate with the portal and open the dev dashboard.
 *
 * Flow:
 *   1. Load the dev's Ed25519 keypair from ~/.beheld/keys/
 *   2. Derive the fingerprint (hex public key)
 *   3. POST /api/v1/auth/challenge { fingerprint } → { nonce }
 *   4. Sign the nonce bytes with the private key
 *   5. POST /api/v1/auth/verify { fingerprint, nonce, signature } → { session_token, redirect_url }
 *   6. Open the dashboard URL in the browser
 */
import { loadPublicJwk, loadPrivateKey, keysExist, publicKeyFingerprint } from "../keys/keystore";
import { DEFAULT_PORTAL_URL } from "../bundle/share";

const bold  = (s: string) => `\x1b[1m${s}\x1b[22m`;
const DIM   = "\x1b[2m";
const RESET = "\x1b[0m";
const ok    = (s: string) => `\x1b[32m✓\x1b[39m ${s}`;
const fail  = (s: string) => `\x1b[31m✗\x1b[39m ${s}`;

function portalUrl(): string {
  return (process.env.BEHELD_PORTAL_URL ?? DEFAULT_PORTAL_URL).replace(/\/+$/, "");
}

function fingerprint(jwk: { x: string }): string {
  return Buffer.from(jwk.x, "base64url").toString("hex");
}

export async function authCommand(): Promise<void> {
  console.log(`${DIM}beheld auth${RESET}`);

  if (!keysExist()) {
    console.log(fail("Chaves não encontradas. Rode `beheld init` primeiro."));
    process.exit(1);
  }

  const pubJwk = loadPublicJwk();
  const fp = fingerprint(pubJwk);
  const privKey = await loadPrivateKey();
  const base = portalUrl();

  console.log(`  ${DIM}fingerprint:${RESET} ${fp.slice(0, 16)}…`);
  console.log(`  ${DIM}portal:${RESET}      ${base}`);

  // 1. Challenge
  let nonce: string;
  try {
    const r = await fetch(`${base}/api/v1/auth/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint: fp }),
    });
    if (!r.ok) {
      const body = await r.text();
      if (r.status === 404) {
        console.log(fail("Conta não encontrada. Publique seu perfil primeiro com `beheld share`."));
      } else {
        console.log(fail(`Challenge falhou: HTTP ${r.status} — ${body.slice(0, 200)}`));
      }
      process.exit(1);
    }
    const data = await r.json() as { nonce: string };
    nonce = data.nonce;
  } catch (e) {
    console.log(fail(`Não foi possível conectar ao portal: ${(e as Error).message}`));
    process.exit(1);
  }

  // 2. Sign the nonce bytes
  const nonceBytes = Uint8Array.from(Buffer.from(nonce, "hex"));
  const sigBytes = new Uint8Array(await crypto.subtle.sign("Ed25519", privKey, nonceBytes));
  const sigHex = Buffer.from(sigBytes).toString("hex");

  // 3. Verify
  let redirectUrl: string;
  try {
    const r = await fetch(`${base}/api/v1/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint: fp, nonce, signature: sigHex }),
    });
    if (!r.ok) {
      const body = await r.text();
      console.log(fail(`Verificação falhou: HTTP ${r.status} — ${body.slice(0, 200)}`));
      process.exit(1);
    }
    const data = await r.json() as { session_token: string; redirect_url: string };
    redirectUrl = `${base}${data.redirect_url}`;
  } catch (e) {
    console.log(fail(`Erro na verificação: ${(e as Error).message}`));
    process.exit(1);
  }

  console.log(ok("Autenticado"));
  console.log(`  ${bold(redirectUrl)}`);

  // 4. Open browser
  const { exec } = await import("node:child_process");
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  exec(`${cmd} "${redirectUrl}"`);
}
