import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { BUNDLE_VERSION, type Bundle, type BundlePayload } from "../bundle/types";
import { payloadHash, payloadToCanonical } from "../bundle/canonical";
import {
  ensureKeys,
  loadPrivateKey,
  loadPublicJwk,
  publicKeyFingerprint,
} from "../keys/keystore";

const ENGINE_URL = process.env.DEVPROFILE_ENGINE_URL ?? "http://127.0.0.1:7338";

interface SnapshotOptions {
  output?: string;
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

export async function snapshotCommand(opts: SnapshotOptions = {}): Promise<void> {
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
      console.error(`✗ Engine respondeu ${r.status}. Execute: devprofile start`);
      process.exit(1);
    }
    payload = (await r.json()) as BundlePayload;
  } catch (err) {
    console.error("✗ Engine offline ou inacessível. Execute: devprofile start");
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

  const bundle: Bundle = {
    version: BUNDLE_VERSION,
    payload,
    hash,
    signature: `ed25519:${toHex(sigBuf)}`,
    public_key: `ed25519:${pubJwk.x}`,
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
  console.log("  ✓ Snapshot gerado");
  console.log(`    hash:         ${hash.slice(0, 24)}...`);
  console.log(`    arquivo:      ${primaryPath}`);
  if (outputPath) console.log(`    cópia:        ${outputPath}`);
  console.log(`    assinado por: ${fp}`);
  if (!saveOk) {
    console.log("");
    console.log("  ⚠️  Bundle criado no disco mas não registrado na chain.");
    console.log("     Execute `devprofile snapshot` novamente quando o engine subir.");
  }
  console.log("");
}

export async function snapshotListCommand(): Promise<void> {
  let rows: SnapshotRow[];
  try {
    const r = await fetch(`${ENGINE_URL}/snapshots`);
    if (!r.ok) {
      console.error(`✗ Engine respondeu ${r.status}. Execute: devprofile start`);
      process.exit(1);
    }
    rows = (await r.json()) as SnapshotRow[];
  } catch {
    console.error("✗ Engine offline. Execute: devprofile start");
    process.exit(1);
  }

  if (rows.length === 0) {
    console.log("");
    console.log("  Nenhum snapshot ainda. Execute: devprofile snapshot");
    console.log("");
    return;
  }

  console.log("");
  console.log(`  ${rows.length} snapshot(s):`);
  console.log("");
  for (const row of rows) {
    const short = row.hash.slice("sha256:".length, "sha256:".length + 12);
    const date = row.created_at.slice(0, 19).replace("T", " ");
    const marker = row.previous_hash ? "→" : "•"; // • = genesis
    const path = row.bundle_path ?? "(arquivo removido)";
    console.log(`  ${marker} ${date}  ${short}  ${path}`);
  }
  console.log("");
}
