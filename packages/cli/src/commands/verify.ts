import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { composition, summarize, verifyBundle, verifyChain, type BundleResolver } from "../bundle/verify";
import { verifyAttestation } from "../bundle/attestation-verify";
import type { Bundle } from "../bundle/types";
import { fail, brand, GREEN, RED, YELLOW, DIM, RESET } from "../ui/styles";

interface VerifyOptions {
  chain?: boolean;
}

function snapshotsDir(): string {
  const base = process.env.DEVPROFILE_DATA_DIR
    ? join(process.env.DEVPROFILE_DATA_DIR, ".devprofile")
    : join(homedir(), ".devprofile");
  return join(base, "snapshots");
}

/** Reads all .dpbundle files in ~/.devprofile/snapshots/ and indexes by hash. */
function localResolver(): BundleResolver {
  const dir = snapshotsDir();
  const cache = new Map<string, Bundle>();
  if (existsSync(dir)) {
    for (const fname of readdirSync(dir)) {
      if (!fname.endsWith(".dpbundle")) continue;
      try {
        const b = JSON.parse(readFileSync(join(dir, fname), "utf8")) as Bundle;
        if (typeof b.hash === "string") cache.set(b.hash, b);
      } catch {
        // ignore unreadable / malformed files — verify reports them per-bundle
      }
    }
  }
  return async (hash: string) => cache.get(hash) ?? null;
}

function mark(ok: boolean): string {
  return ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
}

export async function verifyCommand(
  filePath: string,
  opts: VerifyOptions = {},
): Promise<void> {
  console.log(brand("checando autenticidade"));
  if (!filePath) {
    console.error(fail("Caminho do bundle é obrigatório"));
    console.error(`     ${DIM}Uso: devprofile verify <arquivo.dpbundle>${RESET}`);
    process.exit(1);
  }
  if (!existsSync(filePath)) {
    console.error(fail(`Arquivo não encontrado: ${filePath}`));
    process.exit(1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (e) {
    console.error(fail(`JSON inválido: ${(e as Error).message}`));
    process.exit(1);
  }

  const result = await verifyBundle(raw);

  console.log(`  Verificação: ${filePath}`);
  console.log(`    ${mark(result.checks.schema.ok)} schema    ${result.checks.schema.reason ?? ""}`);
  console.log(`    ${mark(result.checks.hash.ok)} hash      ${result.checks.hash.reason ?? ""}`);
  console.log(`    ${mark(result.checks.signature.ok)} signature ${result.checks.signature.reason ?? ""}`);

  // L1 / L2 section status (Phase 6 / F6.8).
  const l1 = result.checks.l1_section;
  const l2 = result.checks.l2_section;
  if (l1.ok) {
    console.log(`    ${mark(true)} L1        ${l1.repo_count ?? 0} repositórios`);
  } else {
    console.log(`    ${YELLOW}⚠${RESET} L1        ${l1.reason ?? "ausente"}`);
  }
  if (l2.ok) {
    console.log(`    ${mark(true)} L2        ${l2.session_count ?? 0} sessões`);
  } else {
    console.log(`    ${mark(false)} L2        ${l2.reason ?? "ausente"}`);
  }

  let chainOk = true;
  if (opts.chain && result.ok) {
    const chainResult = await verifyChain(raw as Bundle, localResolver());
    chainOk = chainResult.ok;
    const detail = chainResult.ok
      ? `(${chainResult.links_verified} links)`
      : chainResult.reason ?? "?";
    console.log(`    ${mark(chainResult.ok)} chain     ${detail}`);
  } else if (opts.chain) {
    console.log(`    ${YELLOW}–${RESET} chain     skipped (bundle itself failed)`);
    chainOk = false;
  }

  // Identity attestation (Phase 5 / F5.6.1). Optional — bundles without one
  // are still cryptographically valid; we just report identity_unverified.
  const attCheck = result.checks.schema.ok
    ? await verifyAttestation(raw as Bundle)
    : null;
  if (attCheck) {
    if (!attCheck.present) {
      console.log(`    ${YELLOW}–${RESET} identity  ausente (bundle sem attestation — identity_unverified)`);
    } else if (!attCheck.payload_valid) {
      console.log(`    ${mark(false)} identity  ${attCheck.reason ?? "payload inválido"}`);
    } else {
      const allGood = attCheck.signature_valid && attCheck.dev_pubkey_matches && attCheck.key_status === "active";
      const gh = attCheck.github;
      const ghLabel = gh ? `${gh.login} (id=${gh.user_id})` : "?";
      console.log(`    ${mark(allGood)} identity  github: ${ghLabel}`);
      console.log(`      ${mark(attCheck.signature_valid)} platform signature${attCheck.reason && !attCheck.signature_valid ? `  ${DIM}${attCheck.reason}${RESET}` : ""}`);
      console.log(`      ${mark(!!attCheck.dev_pubkey_matches)} dev pubkey bind`);
      const status = attCheck.key_status ?? "?";
      const statusMark = status === "active" ? mark(true)
        : status === "rotated" ? `${YELLOW}~${RESET}`
        : status === "revoked" ? mark(false)
        : `${YELLOW}?${RESET}`;
      const statusDetail = status === "revoked" && attCheck.revoked_reason
        ? `  ${DIM}${attCheck.revoked_reason}${RESET}`
        : "";
      console.log(`      ${statusMark} platform key status: ${status}${statusDetail}`);
    }
  }

  if (result.ok) {
    const comp = composition((raw as Bundle).payload as unknown as Record<string, unknown>);
    console.log("");
    console.log(`  ${summarize((raw as Bundle).payload)}`);
    console.log(`    Base histórica:       ${comp.base}`);
    console.log(`    Trajetória observada: ${comp.trajectory}`);
  }
  console.log("");

  if (!result.ok || !chainOk) process.exit(1);
}
