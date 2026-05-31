import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── tipos públicos ───────────────────────────────────────────────────────────

export interface SupervisorBackoffState {
  /** Timestamps (ms epoch) de falhas de auto-restart, ordenados ascendente. */
  engine_restart_failures: number[];
  /** Quando a suspensão disparou (ms epoch); null = ativo. */
  suspended_at: number | null;
  /** Mensagem humana descrevendo o motivo da suspensão. */
  suspended_reason: string | null;
}

// ── constantes (exportadas pra integração + testes) ──────────────────────────

export const BACKOFF_WINDOW_MS = 5 * 60 * 1000; // 5 min
export const BACKOFF_THRESHOLD = 3;             // 3 falhas

// ── default state ────────────────────────────────────────────────────────────

function defaultState(): SupervisorBackoffState {
  return {
    engine_restart_failures: [],
    suspended_at: null,
    suspended_reason: null,
  };
}

// ── paths ────────────────────────────────────────────────────────────────────

function beheldDir(): string {
  return process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");
}

export function backoffStatePath(): string {
  return join(beheldDir(), "supervisor-backoff.json");
}

// ── funções puras ────────────────────────────────────────────────────────────

/**
 * Remove timestamps fora da janela [now - windowMs, now].
 * Pura — não muta o array original.
 */
export function pruneStaleFailures(
  failures: number[],
  now: number,
  windowMs: number,
): number[] {
  const cutoff = now - windowMs;
  return failures.filter((t) => t >= cutoff);
}

/**
 * Decide se o backoff deve disparar.
 * Pura — apenas conta os elementos.
 */
export function shouldSuspend(failures: number[], threshold: number): boolean {
  return failures.length >= threshold;
}

/**
 * Adiciona uma falha (com now) e poda timestamps fora da janela.
 * NÃO modifica suspended_at — essa transição é responsabilidade do caller.
 * Pura — retorna novo estado.
 */
export function recordFailure(
  state: SupervisorBackoffState,
  now: number,
): SupervisorBackoffState {
  const failures = pruneStaleFailures(
    [...state.engine_restart_failures, now],
    now,
    BACKOFF_WINDOW_MS,
  );
  return {
    ...state,
    engine_restart_failures: failures,
  };
}

/**
 * Estado limpo — usado por `beheld start` para retomar auto-restart.
 * Pura.
 */
export function clearBackoff(): SupervisorBackoffState {
  return defaultState();
}

/**
 * Suspenso sse suspended_at !== null.
 * Pura.
 */
export function isSuspended(state: SupervisorBackoffState): boolean {
  return state.suspended_at !== null;
}

// ── persistência (impura, testável com BEHELD_DATA_DIR) ──────────────────────

/**
 * Carrega o estado de ~/.beheld/supervisor-backoff.json.
 * Arquivo ausente ou JSON inválido → retorna estado default sem crashar.
 */
export function loadBackoffState(): SupervisorBackoffState {
  const fp = backoffStatePath();
  if (!existsSync(fp)) return defaultState();
  try {
    const raw = JSON.parse(readFileSync(fp, "utf8")) as Partial<SupervisorBackoffState>;
    // Validação defensiva — só campos com shape conhecido.
    const failures = Array.isArray(raw.engine_restart_failures)
      ? raw.engine_restart_failures.filter((t): t is number => typeof t === "number")
      : [];
    return {
      engine_restart_failures: failures,
      suspended_at: typeof raw.suspended_at === "number" ? raw.suspended_at : null,
      suspended_reason: typeof raw.suspended_reason === "string" ? raw.suspended_reason : null,
    };
  } catch {
    return defaultState();
  }
}

/**
 * Persiste o estado em ~/.beheld/supervisor-backoff.json com mode 0o600.
 * Cria ~/.beheld/ se ausente (mode 0o700) — pattern do daemon-manager.
 */
export function saveBackoffState(state: SupervisorBackoffState): void {
  mkdirSync(beheldDir(), { recursive: true, mode: 0o700 });
  writeFileSync(backoffStatePath(), JSON.stringify(state), { mode: 0o600 });
}
