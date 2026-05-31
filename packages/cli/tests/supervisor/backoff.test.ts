import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let tmpDir: string;
const originalDataDir = process.env.BEHELD_DATA_DIR;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beheld-backoff-"));
  process.env.BEHELD_DATA_DIR = tmpDir;
  // Não pré-criamos ~/.beheld/ aqui para validar que saveBackoffState cria.
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.BEHELD_DATA_DIR;
  else process.env.BEHELD_DATA_DIR = originalDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── pruneStaleFailures (pure) ────────────────────────────────────────────────

describe("pruneStaleFailures", () => {
  test("[] → []", async () => {
    const { pruneStaleFailures } = await import("../../src/supervisor/backoff");
    expect(pruneStaleFailures([], 1000, 500)).toEqual([]);
  });

  test("remove timestamps fora da janela", async () => {
    const { pruneStaleFailures } = await import("../../src/supervisor/backoff");
    // janela = [now - window, now] = [500, 1000]; 100 fica fora.
    expect(pruneStaleFailures([100, 500, 800], 1000, 500)).toEqual([500, 800]);
  });

  test("janela larga o suficiente → mantém todos", async () => {
    const { pruneStaleFailures } = await import("../../src/supervisor/backoff");
    expect(pruneStaleFailures([100, 500, 800], 1000, 1000)).toEqual([100, 500, 800]);
  });
});

// ── shouldSuspend (pure) ─────────────────────────────────────────────────────

describe("shouldSuspend", () => {
  test("[] / threshold=3 → false", async () => {
    const { shouldSuspend } = await import("../../src/supervisor/backoff");
    expect(shouldSuspend([], 3)).toBe(false);
  });

  test("2 falhas / threshold=3 → false", async () => {
    const { shouldSuspend } = await import("../../src/supervisor/backoff");
    expect(shouldSuspend([1, 2], 3)).toBe(false);
  });

  test("3 falhas / threshold=3 → true (>= é a borda)", async () => {
    const { shouldSuspend } = await import("../../src/supervisor/backoff");
    expect(shouldSuspend([1, 2, 3], 3)).toBe(true);
  });

  test("4 falhas / threshold=3 → true", async () => {
    const { shouldSuspend } = await import("../../src/supervisor/backoff");
    expect(shouldSuspend([1, 2, 3, 4], 3)).toBe(true);
  });
});

// ── recordFailure (pure) ─────────────────────────────────────────────────────

describe("recordFailure", () => {
  test("adiciona timestamp e poda janela", async () => {
    const { recordFailure, BACKOFF_WINDOW_MS } = await import("../../src/supervisor/backoff");
    const state = {
      engine_restart_failures: [100],
      suspended_at: null,
      suspended_reason: null,
    };
    const now = 100 + BACKOFF_WINDOW_MS + 1; // 100 fica fora da janela
    const updated = recordFailure(state, now);
    expect(updated.engine_restart_failures).toEqual([now]);
  });

  test("não modifica suspended_at", async () => {
    const { recordFailure } = await import("../../src/supervisor/backoff");
    const state = {
      engine_restart_failures: [],
      suspended_at: 999,
      suspended_reason: "x",
    };
    const updated = recordFailure(state, 1000);
    expect(updated.suspended_at).toBe(999);
    expect(updated.suspended_reason).toBe("x");
  });
});

// ── clearBackoff (pure) ──────────────────────────────────────────────────────

describe("clearBackoff", () => {
  test("retorna state default zerado", async () => {
    const { clearBackoff } = await import("../../src/supervisor/backoff");
    expect(clearBackoff()).toEqual({
      engine_restart_failures: [],
      suspended_at: null,
      suspended_reason: null,
    });
  });
});

// ── isSuspended (pure) ───────────────────────────────────────────────────────

describe("isSuspended", () => {
  test("suspended_at === null → false", async () => {
    const { isSuspended } = await import("../../src/supervisor/backoff");
    expect(isSuspended({ engine_restart_failures: [], suspended_at: null, suspended_reason: null })).toBe(false);
  });

  test("suspended_at === <ts> → true", async () => {
    const { isSuspended } = await import("../../src/supervisor/backoff");
    expect(isSuspended({ engine_restart_failures: [], suspended_at: 12345, suspended_reason: "x" })).toBe(true);
  });
});

// ── loadBackoffState / saveBackoffState (persistence) ────────────────────────

describe("loadBackoffState", () => {
  test("arquivo ausente → state default", async () => {
    const { loadBackoffState } = await import("../../src/supervisor/backoff");
    expect(loadBackoffState()).toEqual({
      engine_restart_failures: [],
      suspended_at: null,
      suspended_reason: null,
    });
  });

  test("JSON corrompido → state default sem crashar", async () => {
    fs.mkdirSync(path.join(tmpDir, ".beheld"), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(tmpDir, ".beheld", "supervisor-backoff.json"), "{ not json");
    const { loadBackoffState } = await import("../../src/supervisor/backoff");
    expect(loadBackoffState()).toEqual({
      engine_restart_failures: [],
      suspended_at: null,
      suspended_reason: null,
    });
  });

  test("validação defensiva ignora campos com shape errado", async () => {
    fs.mkdirSync(path.join(tmpDir, ".beheld"), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(tmpDir, ".beheld", "supervisor-backoff.json"),
      JSON.stringify({
        engine_restart_failures: [1, "bad", 3],
        suspended_at: "not-a-number",
        suspended_reason: 999,
      }),
    );
    const { loadBackoffState } = await import("../../src/supervisor/backoff");
    const state = loadBackoffState();
    expect(state.engine_restart_failures).toEqual([1, 3]);
    expect(state.suspended_at).toBeNull();
    expect(state.suspended_reason).toBeNull();
  });
});

describe("saveBackoffState", () => {
  test("save + load = roundtrip idempotente", async () => {
    const { saveBackoffState, loadBackoffState } = await import("../../src/supervisor/backoff");
    const original = {
      engine_restart_failures: [100, 200, 300],
      suspended_at: 12345,
      suspended_reason: "teste",
    };
    saveBackoffState(original);
    expect(loadBackoffState()).toEqual(original);
  });

  test("cria ~/.beheld/ se ausente", async () => {
    const { saveBackoffState } = await import("../../src/supervisor/backoff");
    expect(fs.existsSync(path.join(tmpDir, ".beheld"))).toBe(false);
    saveBackoffState({ engine_restart_failures: [], suspended_at: null, suspended_reason: null });
    expect(fs.existsSync(path.join(tmpDir, ".beheld"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".beheld", "supervisor-backoff.json"))).toBe(true);
  });

  test("arquivo gravado com mode 0o600", async () => {
    const { saveBackoffState } = await import("../../src/supervisor/backoff");
    saveBackoffState({ engine_restart_failures: [], suspended_at: null, suspended_reason: null });
    const stat = fs.statSync(path.join(tmpDir, ".beheld", "supervisor-backoff.json"));
    // mask para os 9 bits de perm (rwxrwxrwx).
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

// ── Cenário ponta-a-ponta ────────────────────────────────────────────────────

describe("Cenário ponta-a-ponta — 3 falhas em 5 min suspendem", () => {
  test("recordFailure × 3 → shouldSuspend → save → load mantém suspended_at", async () => {
    const {
      loadBackoffState,
      saveBackoffState,
      recordFailure,
      shouldSuspend,
      isSuspended,
      BACKOFF_THRESHOLD,
    } = await import("../../src/supervisor/backoff");

    let state = loadBackoffState();
    const t0 = 1_000_000;

    // 3 falhas consecutivas dentro da janela.
    state = recordFailure(state, t0);
    expect(shouldSuspend(state.engine_restart_failures, BACKOFF_THRESHOLD)).toBe(false);
    state = recordFailure(state, t0 + 10_000);
    expect(shouldSuspend(state.engine_restart_failures, BACKOFF_THRESHOLD)).toBe(false);
    state = recordFailure(state, t0 + 20_000);
    expect(shouldSuspend(state.engine_restart_failures, BACKOFF_THRESHOLD)).toBe(true);

    // Caller dispara a transição para suspended_at.
    state.suspended_at = t0 + 20_001;
    state.suspended_reason = "teste";
    saveBackoffState(state);

    // Próximo "boot" do supervisor carrega o estado suspenso.
    const reloaded = loadBackoffState();
    expect(isSuspended(reloaded)).toBe(true);
    expect(reloaded.suspended_at).toBe(t0 + 20_001);
  });

  test("clearBackoff zera tudo (sinal do user via beheld start)", async () => {
    const { saveBackoffState, loadBackoffState, clearBackoff } = await import("../../src/supervisor/backoff");
    saveBackoffState({
      engine_restart_failures: [1, 2, 3],
      suspended_at: 100,
      suspended_reason: "x",
    });
    const cleared = clearBackoff();
    saveBackoffState(cleared);
    expect(loadBackoffState()).toEqual({
      engine_restart_failures: [],
      suspended_at: null,
      suspended_reason: null,
    });
  });

  test("2 falhas, 6 min passam, próxima falha → janela limpa, contador = 1", async () => {
    const { recordFailure, shouldSuspend, BACKOFF_WINDOW_MS, BACKOFF_THRESHOLD } = await import("../../src/supervisor/backoff");
    let state = {
      engine_restart_failures: [] as number[],
      suspended_at: null,
      suspended_reason: null,
    };
    const t0 = 1_000_000;
    state = recordFailure(state, t0);
    state = recordFailure(state, t0 + 60_000); // +1min
    expect(state.engine_restart_failures.length).toBe(2);
    // 6 min depois da última falha → ambas saem da janela.
    const later = t0 + 60_000 + BACKOFF_WINDOW_MS + 60_000;
    state = recordFailure(state, later);
    // Só a nova permanece.
    expect(state.engine_restart_failures).toEqual([later]);
    expect(shouldSuspend(state.engine_restart_failures, BACKOFF_THRESHOLD)).toBe(false);
  });
});
