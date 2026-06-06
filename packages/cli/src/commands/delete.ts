import { existsSync, rmSync, unlinkSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";

import { canonicalJson } from "../bundle/canonical";
import { getApiBaseUrl } from "../config/env";
import { removeAllHooks, claudeSettingsPath, continueConfigPath } from "../config/hooks";
import * as daemonManager from "../daemon-manager";
import {
  attestationCachePath,
  loadAttestationCache,
} from "../keys/attestation-cache";
import { loadPrivateKey } from "../keys/keystore";
import { BOLD, DIM, GREEN, RED, RESET, brand } from "../ui/styles";

// ── helpers ──────────────────────────────────────────────────────────────────

function beheldDir(): string {
  return process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");
}

function apiUrl(): string {
  return getApiBaseUrl();
}

async function askConfirmPhrase(phrase: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`  Digite "${phrase}" para confirmar: `, (ans) => {
      rl.close();
      resolve(ans.trim() === phrase);
    });
  });
}

function startStep(label: string): void {
  process.stdout.write(`  ${label}…`);
}

function okStep(label: string): void {
  process.stdout.write(`\r  ${GREEN}✓${RESET}  ${label}\n`);
}

function skipStep(label: string): void {
  process.stdout.write(`\r  ${DIM}—${RESET}  ${label}\n`);
}

function failStep(label: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  process.stdout.write(`\r  ${RED}✗${RESET}  ${label}: ${msg}\n`);
}

// ── countdown for confirmation prompt ────────────────────────────────────────

function countSessions(dir: string): number {
  const sessionsDir = join(dir, "sessions");
  if (!existsSync(sessionsDir)) return 0;
  try {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    return readdirSync(sessionsDir).filter((f: string) => f.endsWith(".jsonl")).length;
  } catch {
    return 0;
  }
}

// ── server revocation ────────────────────────────────────────────────────────

/**
 * Signs `{action:"revoke", issued_at, timestamp}` with the dev's local
 * private key and POSTs it to `/api/attestation/revoke`.
 *
 * Resolves to:
 *   - `"revoked"`        — server confirmed revocation (200)
 *   - `"not_attested"`   — no local attestation cached; nothing to revoke
 *   - `"server_offline"` — network unreachable or 5xx; caller should warn
 *   - `"failed"`         — 4xx response or signature mismatch on server
 */
export type RevokeResult =
  | "revoked"
  | "not_attested"
  | "server_offline"
  | "failed";

export async function revokeRemoteAttestation(opts: {
  baseDir?: string;
  apiUrlOverride?: string;
} = {}): Promise<RevokeResult> {
  const cached = loadAttestationCache(opts.baseDir);
  if (!cached) return "not_attested";

  // dev_pubkey wire format: "ed25519-pub:<std-base64>"
  const stdB64 = cached.payload.dev_pubkey.replace(/^ed25519-pub:/, "");
  const pubBytes = Buffer.from(stdB64, "base64");
  if (pubBytes.byteLength !== 32) return "failed";
  const pubHex = pubBytes.toString("hex");

  const issuedAt = cached.payload.attested_at;
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const canonical = canonicalJson({
    action: "revoke",
    issued_at: issuedAt,
    timestamp,
  });

  const privKey = await loadPrivateKey(opts.baseDir);
  const sigBuf = await crypto.subtle.sign(
    { name: "Ed25519" },
    privKey,
    new TextEncoder().encode(canonical),
  );
  const sigHex = Buffer.from(sigBuf).toString("hex");

  const url = (opts.apiUrlOverride ?? apiUrl()) + "/api/attestation/revoke";

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        public_key: pubHex,
        issued_at: issuedAt,
        timestamp,
        signed_revocation: sigHex,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return "server_offline";
  }

  if (res.ok) return "revoked";
  if (res.status >= 500) return "server_offline";
  return "failed";
}

// ── residue cleanup (devprofile → beheld rename) ─────────────────────────────

interface ResidueResult {
  found: boolean;
  detail: string;
}

function removeMacosDevprofileResidue(home: string): ResidueResult {
  const plist = join(home, "Library", "LaunchAgents", "com.devprofile.daemon.plist");
  if (!existsSync(plist)) return { found: false, detail: "" };

  // best-effort unload (ignores "not loaded" errors)
  spawnSync("launchctl", ["unload", plist], { stdio: "ignore" });
  try {
    unlinkSync(plist);
    return { found: true, detail: "LaunchAgent removido" };
  } catch (err) {
    return { found: true, detail: `falhou ao remover plist: ${(err as Error).message}` };
  }
}

function removeLinuxDevprofileResidue(home: string): ResidueResult {
  const service = join(home, ".config", "systemd", "user", "devprofile.service");
  if (!existsSync(service)) return { found: false, detail: "" };

  spawnSync("systemctl", ["--user", "stop", "devprofile.service"], { stdio: "ignore" });
  spawnSync("systemctl", ["--user", "disable", "devprofile.service"], { stdio: "ignore" });
  try {
    unlinkSync(service);
    return { found: true, detail: "systemd unit removida" };
  } catch (err) {
    return { found: true, detail: `falhou ao remover unit: ${(err as Error).message}` };
  }
}

/**
 * Scans ~/.claude/settings.json for stale `devprofile` references in the
 * permissions allowlist (the actual hook integration is already handled by
 * removeAllHooks → removeClaudeCodeHooks).
 */
function scrubClaudeSettingsDevprofile(home: string): ResidueResult {
  const path = join(home, ".claude", "settings.json");
  if (!existsSync(path)) return { found: false, detail: "" };
  try {
    const { readFileSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    const raw = readFileSync(path, "utf8");
    const json = JSON.parse(raw) as Record<string, unknown>;
    let touched = false;

    const permissions = json.permissions as Record<string, unknown> | undefined;
    if (permissions && typeof permissions === "object") {
      for (const k of Object.keys(permissions)) {
        const list = permissions[k];
        if (Array.isArray(list)) {
          const filtered = list.filter(
            (entry) => !(typeof entry === "string" && /devprofile/.test(entry)),
          );
          if (filtered.length !== list.length) {
            permissions[k] = filtered;
            touched = true;
          }
        }
      }
    }

    if (!touched) return { found: false, detail: "" };
    writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
    return { found: true, detail: "entries devprofile removidas" };
  } catch (err) {
    return { found: true, detail: `falhou: ${(err as Error).message}` };
  }
}

function cleanupDevprofileResidues(): { foundAny: boolean; messages: string[] } {
  const home = homedir();
  const messages: string[] = [];
  let foundAny = false;

  if (osPlatform() === "darwin") {
    const r = removeMacosDevprofileResidue(home);
    if (r.found) {
      foundAny = true;
      messages.push(`LaunchAgent devprofile: ${r.detail}`);
    }
  } else if (osPlatform() === "linux") {
    const r = removeLinuxDevprofileResidue(home);
    if (r.found) {
      foundAny = true;
      messages.push(`systemd devprofile.service: ${r.detail}`);
    }
  }

  const s = scrubClaudeSettingsDevprofile(home);
  if (s.found) {
    foundAny = true;
    messages.push(`~/.claude/settings.json: ${s.detail}`);
  }

  return { foundAny, messages };
}

// ── flow: --remote ───────────────────────────────────────────────────────────

async function runRemote(): Promise<void> {
  console.log(
    `\n  ${RED}Isso invalidará bundles já compartilhados que referenciam essa attestation.${RESET}`,
  );
  const confirmed = await askConfirmPhrase("revogar");
  if (!confirmed) {
    console.log("Abortado.");
    return;
  }

  startStep("Revogando attestation no servidor");
  const result = await revokeRemoteAttestation();
  switch (result) {
    case "revoked":
      okStep("Attestation revogada no servidor");
      break;
    case "not_attested":
      skipStep("Nenhuma attestation local encontrada — nada a revogar");
      break;
    case "server_offline":
      failStep("Servidor indisponível", new Error("não foi possível conectar"));
      console.log(
        `  ${DIM}Tente novamente quando o servidor estiver acessível.${RESET}`,
      );
      break;
    case "failed":
      failStep("Servidor rejeitou a revogação", new Error("422 ou similar"));
      break;
  }
}

// ── flow: --local (or implicit when no flag — legacy) ────────────────────────

async function runLocal(opts: { skipConfirm?: boolean } = {}): Promise<void> {
  const dir = beheldDir();

  if (!opts.skipConfirm) {
    const total = countSessions(dir);
    console.log(
      `\n  ${RED}Isso apagará ${total} sessões de dados locais. Não pode ser desfeito.${RESET}`,
    );
    const confirmed = await askConfirmPhrase("apagar tudo");
    if (!confirmed) {
      console.log("Abortado.");
      return;
    }
  }

  startStep("Parando daemon");
  try {
    await daemonManager.stop();
    okStep("Daemon parado");
  } catch {
    skipStep("Daemon não estava em execução");
  }

  startStep("Apagando ~/.beheld/");
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    okStep("~/.beheld/ removido");
  } catch (err) {
    failStep("~/.beheld/ removido", err);
  }
}

// ── flow: --all ──────────────────────────────────────────────────────────────

async function runAll(): Promise<void> {
  const dir = beheldDir();
  const total = countSessions(dir);
  const hasAttestation = existsSync(attestationCachePath());

  console.log(
    `\n  ${RED}Remoção completa: ${total} sessões locais, attestation no servidor, hooks, e resíduos do nome antigo.${RESET}`,
  );
  const confirmed = await askConfirmPhrase("apagar tudo");
  if (!confirmed) {
    console.log("Abortado.");
    return;
  }

  console.log("\n  Iniciando remoção completa do Beheld…\n");

  // 1) Stop daemon (idempotent)
  startStep("Parando daemon");
  try {
    await daemonManager.stop();
    okStep("Daemon parado");
  } catch {
    skipStep("Daemon não estava em execução");
  }

  // 2) Revoke remote attestation (best effort)
  if (hasAttestation) {
    startStep("Revogando attestation no servidor");
    const result = await revokeRemoteAttestation();
    if (result === "revoked") okStep("Attestation revogada no servidor");
    else if (result === "server_offline") {
      process.stdout.write(
        `\r  ${DIM}⚠${RESET}  Servidor indisponível — attestation não revogada remotamente.\n`,
      );
      console.log(
        `      ${DIM}Para revogar depois: beheld delete --remote${RESET}`,
      );
    } else if (result === "failed") {
      process.stdout.write(
        `\r  ${DIM}⚠${RESET}  Servidor rejeitou a revogação — seguindo com limpeza local.\n`,
      );
    } else {
      skipStep("Nenhuma attestation local para revogar");
    }
  } else {
    skipStep("Nenhuma attestation local para revogar");
  }

  // 3) Remove local data dir
  startStep("Removendo ~/.beheld/");
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    okStep(`~/.beheld/ removido (${total} sessões)`);
  } catch (err) {
    failStep("~/.beheld/ removido", err);
  }

  // 4) Remove integration hooks (Claude Code + Continue.dev + slash command + claude mcp)
  startStep("Removendo hooks/MCP");
  try {
    await removeAllHooks();
    okStep("Hooks/MCP removidos");
  } catch (err) {
    failStep("Hooks/MCP removidos", err);
  }

  // 5) Cleanup devprofile rename residues
  startStep("Limpando resíduos do nome antigo (devprofile)");
  const residue = cleanupDevprofileResidues();
  if (residue.foundAny) {
    process.stdout.write(`\r  ${GREEN}✓${RESET}  Resíduos devprofile limpos:\n`);
    for (const m of residue.messages) {
      console.log(`      ${DIM}${m}${RESET}`);
    }
  } else {
    skipStep("Nenhum resíduo devprofile encontrado");
  }

  // Footer
  console.log(`\n  ${BOLD}Beheld removido com sucesso.${RESET}`);
  console.log(`\n  Para remover o binário:`);
  console.log(`    rm $(which beheld)`);
  console.log(`\n  Verificar limpeza:`);
  console.log(`    which beheld && echo "binário ainda presente" || echo "✓ binário removido"`);
  console.log(`    ls ~/.beheld 2>&1`);
  console.log(
    `    grep -rE "beheld|devprofile" ~/.claude/settings.json ${continueConfigPath()} 2>/dev/null`,
  );
}

// ── entry point ──────────────────────────────────────────────────────────────

interface DeleteOptions {
  local?: boolean;
  remote?: boolean;
  all?: boolean;
}

export async function deleteCommand(opts: DeleteOptions): Promise<void> {
  console.log(brand("apagando o que sobrou"));
  const { local, remote, all } = opts;

  if (!local && !remote && !all) {
    console.error("  Especifique --local, --remote ou --all");
    process.exit(1);
  }

  if (all) {
    await runAll();
    return;
  }
  if (remote) {
    await runRemote();
    return;
  }
  if (local) {
    await runLocal();
    return;
  }
}

// ── exports for tests ────────────────────────────────────────────────────────

export const __test = {
  cleanupDevprofileResidues,
  scrubClaudeSettingsDevprofile,
  removeMacosDevprofileResidue,
  removeLinuxDevprofileResidue,
  countSessions,
};

// Suppress the unused-import warning until claudeSettingsPath is needed by a future test seam.
void claudeSettingsPath;
