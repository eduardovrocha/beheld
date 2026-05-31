/**
 * Contador de instalações cross-repo.
 *
 * Uma única requisição na vida da instalação:
 *   POST https://beheld.dev/api/install/register
 *   { id: <uuid-v4>, os: <"macos"|"linux">, version: <semver> }
 *
 * Como funciona:
 *   - Na primeira execução do install, geramos um UUID e gravamos em
 *     ~/.beheld/install-id (mode 0o600).
 *   - O arquivo IS a fonte de verdade. Sua presença = "já registrado".
 *   - Atualizações e reinstalações não tocam o arquivo nem re-postam.
 *   - rm -rf ~/.beheld/ apaga e o próximo init conta como nova instalação;
 *     ocorre raramente e é aceitável.
 *
 * Como desligar:
 *   BEHELD_NO_TELEMETRY=1 → nada é enviado, nada é gravado, nada aparece
 *   no output do init. Opt-out invisível.
 *
 * Falhas no POST não interrompem o install. Arquivo é gravado MESMO se
 * a rede falha — assim a segunda execução nunca tenta de novo. Sem retry.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const REGISTER_URL = "https://beheld.dev/api/install/register";
export const REQUEST_TIMEOUT_MS = 3_000;

export interface RegisterPayload {
  id: string;
  os: "macos" | "linux";
  version: string;
}

export interface RegisterResult {
  sent: boolean;
  reason?: string;
}

// ── paths ────────────────────────────────────────────────────────────────────

function beheldDir(): string {
  return process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");
}

export function installIdPath(): string {
  return join(beheldDir(), "install-id");
}

// ── detecção de ambiente ─────────────────────────────────────────────────────

export function getOsTag(): "macos" | "linux" | null {
  const p = platform();
  if (p === "darwin") return "macos";
  if (p === "linux") return "linux";
  // Outras plataformas (windows, freebsd, etc.) não são suportadas e não
  // registram. Coerente com o disclosure: o contador só mede macos|linux.
  return null;
}

export function isOptedOut(): boolean {
  const v = process.env.BEHELD_NO_TELEMETRY;
  if (v === undefined || v === "") return false;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

export function isFirstInstall(): boolean {
  return !existsSync(installIdPath());
}

// ── construção e envio do payload ────────────────────────────────────────────

export function getRegisterPayload(version: string): RegisterPayload | null {
  const os = getOsTag();
  if (os === null) return null;
  return {
    id: randomUUID(),
    os,
    version,
  };
}

/**
 * Grava ~/.beheld/install-id ANTES de qualquer chamada de rede. A presença
 * do arquivo define "já registrado" — falha do POST não causa retry, e
 * sucesso do POST não é necessário pra evitar duplicação.
 */
export async function registerFirstInstall(
  payload: RegisterPayload,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<RegisterResult> {
  // 1. Garantir que ~/.beheld/ existe (mode 0o700 — padrão do projeto).
  try {
    mkdirSync(beheldDir(), { recursive: true, mode: 0o700 });
  } catch {
    // Se nem o dir consegue ser criado, não há como gravar; aborta silenciosamente.
    return { sent: false, reason: "beheld dir inacessível" };
  }

  // 2. Gravar o arquivo PRIMEIRO. Esta é a invariante crítica.
  try {
    writeFileSync(installIdPath(), payload.id, { mode: 0o600 });
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : "write falhou",
    };
  }

  // 3. POST fire-and-forget. Falha não trava o install.
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetchImpl(REGISTER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    // 204 = sucesso. 429 = rate limit, tratado como sucesso silencioso por design.
    // Outros 4xx/5xx: arquivo já está gravado, então não há retry — só reportamos.
    if (res.ok || res.status === 429) {
      return { sent: true };
    }
    return { sent: false, reason: `HTTP ${res.status}` };
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : "rede falhou",
    };
  }
}
