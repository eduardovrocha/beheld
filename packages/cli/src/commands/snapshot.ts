import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { BUNDLE_VERSION, type Bundle, type BundlePayload } from "../bundle/types";
import { payloadHash, payloadToCanonical } from "../bundle/canonical";
import { composition } from "../bundle/verify";
import { renderQr, uploadBundle } from "../bundle/share";
import {
  ensureKeys,
  loadPrivateKey,
  loadPublicJwk,
  publicKeyFingerprint,
} from "../keys/keystore";
import { loadAttestationCache } from "../keys/attestation-cache";
import { ok, fail, warn, arrow, meta, bold, brand, DIM, RESET } from "../ui/styles";
import { renderSnapshotHtml, type SnapshotHtmlData } from "../ui/snapshot-html";

const ENGINE_URL = process.env.DEVPROFILE_ENGINE_URL ?? "http://127.0.0.1:7338";

interface SnapshotOptions {
  output?: string;
  share?: boolean;
  html?: boolean;
  authorName?: string;
}

interface SnapshotRow {
  id: number;
  hash: string;
  previous_hash: string | null;
  created_at: string;
  bundle_path: string | null;
}

function dataDir(): string {
  return process.env.DEVPROFILE_DATA_DIR
    ? join(process.env.DEVPROFILE_DATA_DIR, ".devprofile")
    : join(homedir(), ".devprofile");
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bundleFilename(createdAt: string, hash: string): string {
  // 2026-05-14T03:42:00+00:00 → 20260514
  const dateStr = createdAt.slice(0, 10).replace(/-/g, "");
  // sha256:abc... → abc
  const hashShort = hash.slice("sha256:".length, "sha256:".length + 8);
  return `${dateStr}_${hashShort}.dpbundle`;
}

/** Resolve the convenience-copy directory. Returns null when no usable
 *  destination exists — caller should silently skip in that case.
 *
 *  Precedence:
 *    1. DEVPROFILE_DESKTOP_DIR env (explicit override, e.g. for tests or CI)
 *    2. ~/Desktop if it exists (works on macOS, Windows, and most Linux setups)
 *    3. null
 *
 *  Set DEVPROFILE_NO_DESKTOP_COPY=1 to opt out entirely.
 */
function desktopCopyDir(): string | null {
  if (process.env.DEVPROFILE_NO_DESKTOP_COPY === "1") return null;
  const override = process.env.DEVPROFILE_DESKTOP_DIR;
  if (override) return existsSync(override) ? override : null;
  const candidate = join(homedir(), "Desktop");
  return existsSync(candidate) ? candidate : null;
}

export async function snapshotCommand(opts: SnapshotOptions = {}): Promise<void> {
  console.log(brand("capturando o momento"));
  await ensureKeys();

  // 1. Engine builds the payload (no signing yet)
  let payload: BundlePayload;
  try {
    const r = await fetch(`${ENGINE_URL}/snapshot/payload`, { method: "POST" });
    if (r.status === 409) {
      const body = await r.json().catch(() => ({ detail: "" }));
      console.error("✗ Sem dados suficientes para gerar um snapshot ainda.");
      console.error(`  ${body.detail || "Use o Claude Code por algumas sessões e tente novamente."}`);
      process.exit(1);
    }
    if (!r.ok) {
      console.error(fail(`Engine respondeu ${r.status}`));
      console.error(`     ${DIM}Execute: devprofile start${RESET}`);
      process.exit(1);
    }
    payload = (await r.json()) as BundlePayload;
  } catch (err) {
    console.error(fail("Engine offline ou inacessível"));
    console.error(`     ${DIM}Execute: devprofile start${RESET}`);
    process.exit(1);
  }

  // 2. Canonicalize, hash, sign
  const canonical = payloadToCanonical(payload);
  const hash = await payloadHash(payload);
  const privKey = await loadPrivateKey();
  const sigBuf = await crypto.subtle.sign(
    { name: "Ed25519" },
    privKey,
    new TextEncoder().encode(canonical),
  );
  const pubJwk = loadPublicJwk();

  // Embed the identity attestation if the dev has run `devprofile attest`.
  // The attestation lives at the wrapper level so adding it doesn't change
  // the bundle hash (Phase 5 / F5.6.1.e).
  const attestation = loadAttestationCache();

  const bundle: Bundle = {
    version: BUNDLE_VERSION,
    payload,
    hash,
    signature: `ed25519:${toHex(sigBuf)}`,
    public_key: `ed25519:${pubJwk.x}`,
    ...(attestation ? { attestation } : {}),
  };

  // 3. Write bundle to disk (always to ~/.devprofile/snapshots/, plus --output if given)
  const snapDir = join(dataDir(), "snapshots");
  mkdirSync(snapDir, { recursive: true, mode: 0o700 });
  const fileName = bundleFilename(payload.created_at, hash);
  const primaryPath = join(snapDir, fileName);
  const serialized = JSON.stringify(bundle, null, 2) + "\n";
  writeFileSync(primaryPath, serialized);

  let outputPath: string | undefined;
  if (opts.output) {
    writeFileSync(opts.output, serialized);
    outputPath = opts.output;
  }

  // Convenience copy to the desktop so the user can find the bundle without
  // having to know about ~/.devprofile/snapshots/. Skipped silently if the
  // target dir doesn't exist or DEVPROFILE_NO_DESKTOP_COPY=1.
  let desktopPath: string | undefined;
  const desktop = desktopCopyDir();
  if (desktop) {
    desktopPath = join(desktop, fileName);
    try {
      writeFileSync(desktopPath, serialized);
    } catch {
      desktopPath = undefined; // silent — primary already on disk
    }
  }

  // 4. Register in DB
  let saveOk = true;
  try {
    const saveResp = await fetch(`${ENGINE_URL}/snapshot/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hash,
        previous_hash: payload.previous_hash,
        payload_json: canonical,
        bundle_path: primaryPath,
      }),
    });
    saveOk = saveResp.ok;
  } catch {
    saveOk = false;
  }

  const fp = await publicKeyFingerprint(pubJwk);
  console.log("");
  console.log(ok("Snapshot gerado"));
  console.log(`     ${DIM}hash:${RESET}         ${bold(hash.slice(0, 24))}…`);
  console.log(`     ${DIM}arquivo:${RESET}      ${primaryPath}`);
  if (desktopPath) console.log(`     ${DIM}desktop:${RESET}      ${desktopPath}`);
  if (outputPath)  console.log(`     ${DIM}cópia:${RESET}        ${outputPath}`);
  console.log(`     ${DIM}assinado por:${RESET} ${fp}`);

  // L1 / L2 composition surfaced from the just-signed payload (Phase 6 / F6.8).
  const comp = composition(payload as unknown as Record<string, unknown>);
  console.log("");
  console.log(`  ${bold("Perfil capturado")}`);
  console.log(`     ${DIM}Base histórica:${RESET}       ${comp.base}`);
  console.log(`     ${DIM}Trajetória observada:${RESET} ${comp.trajectory}`);

  if (!saveOk) {
    console.log("");
    console.log(warn("Bundle criado no disco mas não registrado na chain"));
    console.log(`     ${DIM}Execute \`devprofile snapshot\` novamente quando o engine subir.${RESET}`);
  }

  if (opts.html === true) {
    await writeHtmlRetrato(bundle, primaryPath, opts.authorName);
  }

  console.log("");

  if (opts.share === true) {
    await shareBundle(bundle);
  }
}

async function writeHtmlRetrato(
  bundle: Bundle,
  bundlePath: string,
  authorName: string | undefined,
): Promise<void> {
  // Pull identity + emergent + signals from the engine. The bundle we have is
  // the canonical signed artifact; the engine just hands us the human-facing
  // overlays (identity phrase, temporal diff) in one extra round-trip.
  let extras: { identity: SnapshotHtmlData["identity"]; emergent: SnapshotHtmlData["emergent"]; signals: SnapshotHtmlData["signals"] } | null = null;
  try {
    const r = await fetch(`${ENGINE_URL}/snapshot/html-data`, { method: "POST" });
    if (r.ok) {
      const body = (await r.json()) as { identity: SnapshotHtmlData["identity"]; emergent: SnapshotHtmlData["emergent"]; signals: SnapshotHtmlData["signals"] };
      extras = { identity: body.identity, emergent: body.emergent, signals: body.signals };
    }
  } catch {
    // engine offline — fall through
  }

  if (!extras) {
    console.log("");
    console.log(warn("Engine offline — HTML não gerado"));
    console.log(`     ${DIM}O .dpbundle local continua válido. Tente novamente quando o engine subir.${RESET}`);
    return;
  }

  const html = renderSnapshotHtml({
    bundle,
    signals: extras.signals,
    identity: extras.identity,
    emergent: extras.emergent,
    authorName,
  });

  const htmlPath = bundlePath.replace(/\.dpbundle$/, ".html");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(htmlPath, html, "utf8");

  console.log("");
  console.log(ok("Retrato HTML gerado"));
  console.log(`     ${DIM}arquivo:${RESET}    ${htmlPath}`);
  console.log(`     ${DIM}identity:${RESET}   ${extras.identity.identity_long}`);
  console.log(`     ${DIM}confidence:${RESET} ${extras.identity.confidence} ${meta(`(via ${extras.identity.generation_path})`)}`);
}

async function shareBundle(bundle: Bundle): Promise<void> {
  const result = await uploadBundle(bundle);
  if (!result.ok) {
    console.log(warn("Upload falhou — o bundle local continua válido"));
    if (result.error.kind === "network") {
      console.log(`     ${DIM}Rede: ${result.error.message}${RESET}`);
    } else {
      console.log(`     ${DIM}HTTP ${result.error.status}:${RESET} ${result.error.body.slice(0, 200)}`);
    }
    console.log("");
    return;
  }

  const { id, url, ttl_days, deduplicated } = result.data;
  const qr = await renderQr(url, { small: true });

  console.log(qr);
  console.log(`  ${bold(url)}`);
  if (ttl_days !== null) {
    console.log(`  ${DIM}TTL:${RESET} ${ttl_days} dias${deduplicated ? meta("  (deduplicado — já existia)") : ""}`);
  } else if (deduplicated) {
    console.log(`  ${meta("(deduplicado — já existia)")}`);
  }
  console.log(`  ${DIM}id:${RESET}  ${id}`);
  console.log("");
}

export async function snapshotListCommand(): Promise<void> {
  console.log(brand("histórico de momentos"));
  let rows: SnapshotRow[];
  try {
    const r = await fetch(`${ENGINE_URL}/snapshots`);
    if (!r.ok) {
      console.error(fail(`Engine respondeu ${r.status}`));
      console.error(`     ${DIM}Execute: devprofile start${RESET}`);
      process.exit(1);
    }
    rows = (await r.json()) as SnapshotRow[];
  } catch {
    console.error(fail("Engine offline"));
    console.error(`     ${DIM}Execute: devprofile start${RESET}`);
    process.exit(1);
  }

  if (rows.length === 0) {
    console.log("");
    console.log(`  ${DIM}Nenhum snapshot ainda.${RESET} Execute: ${bold("devprofile snapshot")}`);
    console.log("");
    return;
  }

  console.log("");
  console.log(`  ${bold(`${rows.length} snapshot(s)`)}`);
  console.log("");
  for (const row of rows) {
    const short = row.hash.slice("sha256:".length, "sha256:".length + 12);
    const date = row.created_at.slice(0, 19).replace("T", " ");
    const marker = row.previous_hash ? `${DIM}→${RESET}` : `${DIM}•${RESET}`; // • = genesis
    const path = row.bundle_path ?? `${DIM}(arquivo removido)${RESET}`;
    console.log(`  ${marker} ${DIM}${date}${RESET}  ${short}  ${path}`);
  }
  console.log("");
}
