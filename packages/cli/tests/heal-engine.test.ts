import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let tmpDir: string;
const originalDataDir = process.env.BEHELD_DATA_DIR;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beheld-heal-"));
  process.env.BEHELD_DATA_DIR = tmpDir;
  fs.mkdirSync(path.join(tmpDir, ".beheld"), { recursive: true, mode: 0o700 });
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.BEHELD_DATA_DIR;
  else process.env.BEHELD_DATA_DIR = originalDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Helpers — engine snapshot e processing snapshot mínimos do gate.
function engineLike() {
  return {
    severity: "crit" as const,
    label: "Scoring engine (porta 7338)",
    lines: [],
    runtimePid: 70859,
    proc: { stat: "R+", cpuPct: 541.4, etime: "06-16:42:35" },
  };
}

function snapLike(cursorMtime = 1_000, newest = 1_000 + 10 * 60 * 1000) {
  return {
    cursor: { offsets: { "s.jsonl": 100 }, mtime: cursorMtime },
    sessions: [{ name: "s.jsonl", size: 500, mtime: newest }],
    profileDb: { mtime: newest } as { mtime: number } | null,
    profileDbWal: { size: 1024 } as { size: number } | null,
  };
}

// ── Happy path ───────────────────────────────────────────────────────────────

describe("selfHealEngine — happy path", () => {
  test("todas as probes ok → succeeded:true e 7 steps registrados", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    const calls: string[] = [];
    const report = await selfHealEngine(engineLike(), snapLike(), {
      captureStack: async () => { calls.push("capture"); return true; },
      killProcess: () => { calls.push("kill"); return true; },
      waitSocketRelease: async () => { calls.push("wait"); return true; },
      walCheckpoint: async () => { calls.push("wal"); return { ok: true }; },
      clearStaleEnginePid: () => { calls.push("clear"); return true; },
      restartDaemon: async () => { calls.push("restart"); return { ok: true }; },
      now: () => 12345,
    });
    expect(report.triggered).toBe(true);
    expect(report.succeeded).toBe(true);
    expect(report.steps).toHaveLength(7);
    expect(report.steps.every((s) => s.ok)).toBe(true);
    // Ordem das chamadas deve refletir a sequência da spec.
    expect(calls).toEqual(["capture", "kill", "wait", "wal", "clear", "restart"]);
  });

  test("evidence reflete os valores literais do engine/snapshot", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    const snap = snapLike(1_000, 1_000 + 7 * 60 * 1000); // 7 min lag
    const report = await selfHealEngine(engineLike(), snap, {
      captureStack: async () => true,
      killProcess: () => true,
      waitSocketRelease: async () => true,
      walCheckpoint: async () => ({ ok: true }),
      clearStaleEnginePid: () => true,
      restartDaemon: async () => ({ ok: true }),
    });
    expect(report.evidence).toEqual({
      runtimePid: 70859,
      stat: "R+",
      cpuPct: 541.4,
      etime: "06-16:42:35",
      cursorLagMs: 7 * 60 * 1000,
    });
  });
});

// ── Best-effort steps (stack, wal, clear) ────────────────────────────────────

describe("selfHealEngine — stack indisponível não bloqueia", () => {
  test("captureStack=false → succeeded:true (best-effort não conta)", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    const report = await selfHealEngine(engineLike(), snapLike(), {
      captureStack: async () => false,
      killProcess: () => true,
      waitSocketRelease: async () => true,
      walCheckpoint: async () => ({ ok: true }),
      clearStaleEnginePid: () => true,
      restartDaemon: async () => ({ ok: true }),
    });
    const stackStep = report.steps.find((s) => s.name === "capture-stack")!;
    expect(stackStep.ok).toBe(false);
    expect(stackStep.detail).toBeTruthy();
    // Best-effort: capture-stack falho NÃO derruba succeeded — os 5 passos
    // críticos (kill/wait/wal/clear/restart) todos ok mantêm o veredito final.
    expect(report.succeeded).toBe(true);
    expect(report.steps.find((s) => s.name === "kill-engine")!.ok).toBe(true);
    expect(report.steps.find((s) => s.name === "restart-daemon")!.ok).toBe(true);
  });
});

// ── Curto-circuito em kill / wait ────────────────────────────────────────────

describe("selfHealEngine — kill falha", () => {
  test("killProcess=false → 4–7 marcados como 'abortado por falha anterior'", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    let walCalled = false;
    let restartCalled = false;
    const report = await selfHealEngine(engineLike(), snapLike(), {
      captureStack: async () => true,
      killProcess: () => false,
      waitSocketRelease: async () => true,
      walCheckpoint: async () => { walCalled = true; return { ok: true }; },
      clearStaleEnginePid: () => true,
      restartDaemon: async () => { restartCalled = true; return { ok: true }; },
    });
    expect(report.succeeded).toBe(false);
    expect(walCalled).toBe(false);
    expect(restartCalled).toBe(false);
    const aborted = report.steps.filter((s) => s.detail === "abortado por falha anterior");
    expect(aborted.map((s) => s.name)).toEqual([
      "wait-socket-release",
      "wal-checkpoint",
      "clear-stale-engine-pid",
      "restart-daemon",
    ]);
  });
});

describe("selfHealEngine — socket não libera", () => {
  test("waitSocketRelease=false → 5–7 abortados", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    let walCalled = false;
    const report = await selfHealEngine(engineLike(), snapLike(), {
      captureStack: async () => true,
      killProcess: () => true,
      waitSocketRelease: async () => false,
      walCheckpoint: async () => { walCalled = true; return { ok: true }; },
      clearStaleEnginePid: () => true,
      restartDaemon: async () => ({ ok: true }),
    });
    expect(report.succeeded).toBe(false);
    expect(walCalled).toBe(false);
    const aborted = report.steps.filter((s) => s.detail === "abortado por falha anterior");
    expect(aborted.map((s) => s.name)).toEqual([
      "wal-checkpoint",
      "clear-stale-engine-pid",
      "restart-daemon",
    ]);
  });
});

// ── WAL falha não bloqueia 6 e 7 ─────────────────────────────────────────────

describe("selfHealEngine — WAL checkpoint falha", () => {
  test("walCheckpoint={ok:false} → clear e restart continuam", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    let clearCalled = false;
    let restartCalled = false;
    const report = await selfHealEngine(engineLike(), snapLike(), {
      captureStack: async () => true,
      killProcess: () => true,
      waitSocketRelease: async () => true,
      walCheckpoint: async () => ({ ok: false, detail: "SQLITE_BUSY" }),
      clearStaleEnginePid: () => { clearCalled = true; return true; },
      restartDaemon: async () => { restartCalled = true; return { ok: true }; },
    });
    expect(clearCalled).toBe(true);
    expect(restartCalled).toBe(true);
    expect(report.steps.find((s) => s.name === "wal-checkpoint")!.ok).toBe(false);
    expect(report.steps.find((s) => s.name === "clear-stale-engine-pid")!.ok).toBe(true);
    expect(report.steps.find((s) => s.name === "restart-daemon")!.ok).toBe(true);
    expect(report.succeeded).toBe(false); // succeeded = todos ok
  });
});

// ── Restart falha ────────────────────────────────────────────────────────────

describe("selfHealEngine — restart falha", () => {
  test("restartDaemon={ok:false} → passos anteriores ok, succeeded:false", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    const report = await selfHealEngine(engineLike(), snapLike(), {
      captureStack: async () => true,
      killProcess: () => true,
      waitSocketRelease: async () => true,
      walCheckpoint: async () => ({ ok: true }),
      clearStaleEnginePid: () => true,
      restartDaemon: async () => ({ ok: false, detail: "engine não respondeu" }),
    });
    expect(report.succeeded).toBe(false);
    expect(report.steps.find((s) => s.name === "restart-daemon")!.ok).toBe(false);
    // Tudo antes do restart ficou ok.
    const before = report.steps.filter((s) => s.name !== "restart-daemon");
    expect(before.every((s) => s.ok)).toBe(true);
  });
});

// ── clearStaleEnginePid (default) ────────────────────────────────────────────

describe("clearStaleEnginePid (default)", () => {
  test("preserva campo mcp ao remover engine", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".beheld", "daemon.pid"),
      JSON.stringify({ mcp: 100, engine: 18518 }),
    );
    const { clearStaleEnginePid } = await import("../src/commands/heal-engine");
    expect(clearStaleEnginePid()).toBe(true);
    const after = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".beheld", "daemon.pid"), "utf8"),
    );
    expect(after).toEqual({ mcp: 100 });
  });

  test("ausência do arquivo retorna true (nada a limpar)", async () => {
    const { clearStaleEnginePid } = await import("../src/commands/heal-engine");
    expect(clearStaleEnginePid()).toBe(true);
  });
});

// ── walCheckpoint (default) ──────────────────────────────────────────────────

describe("walCheckpoint (default)", () => {
  test("executa em DB válido e retorna ok:true", async () => {
    const { Database } = await import("bun:sqlite");
    const dbPath = path.join(tmpDir, ".beheld", "profile.db");
    const setup = new Database(dbPath);
    setup.exec("PRAGMA journal_mode=WAL; CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1);");
    setup.close();

    const { walCheckpoint } = await import("../src/commands/heal-engine");
    const r = await walCheckpoint(dbPath);
    expect(r.ok).toBe(true);
  });

  test("DB inexistente cria arquivo vazio e retorna ok:true (bun:sqlite cria)", async () => {
    // O bun:sqlite cria o arquivo se não existir; o checkpoint num WAL vazio é no-op
    // e retorna ok. Esta é a degradação aceitável definida no design.
    const { walCheckpoint } = await import("../src/commands/heal-engine");
    const r = await walCheckpoint(path.join(tmpDir, ".beheld", "ghost.db"));
    expect(r.ok).toBe(true);
  });
});

// ── Pré-condições do gate (defensive) ────────────────────────────────────────

describe("selfHealEngine — invariantes", () => {
  test("sem runtimePid → throw", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    const e = engineLike() as { runtimePid?: number };
    delete e.runtimePid;
    await expect(selfHealEngine(e as never, snapLike())).rejects.toThrow();
  });

  test("sem proc → throw", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    const e = engineLike() as { proc?: unknown };
    delete e.proc;
    await expect(selfHealEngine(e as never, snapLike())).rejects.toThrow();
  });

  test("snap.cursor null → throw", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    const snap = snapLike();
    snap.cursor = null as never;
    await expect(selfHealEngine(engineLike(), snap)).rejects.toThrow();
  });
});
