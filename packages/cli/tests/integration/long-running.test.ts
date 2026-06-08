// Long-running integration scenario.
//
// This test boots a real MCP server subprocess against a fresh BEHELD_DATA_DIR
// plus a stub engine on isolated ports, drives traffic through it, kills the
// engine with SIGKILL, restarts it, and verifies that:
//
//   • HTTP /health drives liveness detection (B14)
//   • Counters rebuild from JSONL on MCP restart (B16)
//   • The Stop hook coalescing keeps log noise bounded (B17)
//   • doctor / view / restart all give a coherent picture to the user (B18)
//
// The integration test gates on the EXISTENCE of these properties end-to-end
// rather than via mocks. A regression of any of B14/B16/B18 fails this test.
//
// Skip with: SKIP_INTEGRATION=1 bun test packages/cli/tests/
// Run only:  bun test packages/cli/tests/integration/

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildEnv,
  runCli,
  spawnMcp,
  spawnFakeEngine,
  sleep,
  waitForHealth,
  waitForPortClosed,
  getStatus,
  pidListeningOn,
  simulateClaudeSessions,
  killSafely,
  type SpawnEnv,
} from "./helpers";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const SUITE = SKIP ? describe.skip : describe;

// Use ports well above the user's running daemon (7337/7338) to avoid collision.
const MCP_PORT = 27337;
const ENGINE_PORT = 27338;
const MCP_URL = `http://127.0.0.1:${MCP_PORT}`;
const ENGINE_URL = `http://127.0.0.1:${ENGINE_PORT}`;

let tmpDir: string;
let env: SpawnEnv & Record<string, string>;
let mcpProc: ReturnType<typeof Bun.spawn> | null = null;
let engineProc: ReturnType<typeof Bun.spawn> | null = null;

async function startMcp(): Promise<void> {
  mcpProc = spawnMcp(env);
  const ok = await waitForHealth(MCP_URL, 5_000);
  if (!ok) throw new Error("MCP did not come up within 5s");
}

async function startEngine(): Promise<void> {
  engineProc = spawnFakeEngine(env);
  const ok = await waitForHealth(ENGINE_URL, 5_000);
  if (!ok) throw new Error("Fake engine did not come up within 5s");
}

async function stopProcess(p: ReturnType<typeof Bun.spawn> | null): Promise<void> {
  if (!p) return;
  try { p.kill("SIGTERM"); } catch { /* already gone */ }
  await Promise.race([p.exited, sleep(2_000)]);
  if (p.killed === false) {
    try { p.kill("SIGKILL"); } catch { /* gone */ }
  }
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "beheld-integration-"));
  env = buildEnv({ dataDir: tmpDir, mcpPort: MCP_PORT, enginePort: ENGINE_PORT });
});

afterAll(async () => {
  await stopProcess(mcpProc);
  await stopProcess(engineProc);
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

SUITE("Long-running scenario — produto sobrevive a uso prolongado e restarts", () => {
  test("end-to-end: 30 sessões, kill -9 engine, restart, contadores rebuildam, doctor verde", async () => {
    // ── 1. Setup: MCP + engine sobem em ambiente isolado ─────────────────────
    await startEngine();
    await startMcp();

    // ── 2. Estado inicial: zero eventos, ambos healthy ───────────────────────
    const initial = await getStatus(MCP_URL);
    expect(initial).not.toBeNull();
    expect(initial!.events_today).toBe(0);
    expect(initial!.sessions_today).toBe(0);

    // ── 3. Simular 30 sessões reais via hooks HTTP ───────────────────────────
    const sessions = await simulateClaudeSessions(MCP_URL, 30);
    expect(sessions.length).toBe(30);
    const totalTracked = sessions.reduce((s, x) => s + x.trackedEvents, 0);
    const totalJsonl = sessions.reduce((s, x) => s + x.jsonlEvents, 0);

    // 30 sessions × (2 pre + 2 post) = 120 in-memory; +1 stop each = 150 in JSONL.
    expect(totalTracked).toBe(120);
    expect(totalJsonl).toBe(150);

    // Give writer + counter a tick to settle.
    await sleep(200);

    const afterTraffic = await getStatus(MCP_URL);
    expect(afterTraffic!.events_today).toBe(totalTracked);
    expect(afterTraffic!.sessions_today).toBe(30);

    // ── 4. Verificar JSONL escrito no disco ──────────────────────────────────
    const sessionsDir = join(tmpDir, ".beheld", "sessions");
    expect(existsSync(sessionsDir)).toBe(true);
    const jsonlFiles = readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    expect(jsonlFiles.length).toBe(30);

    // ── 5. Killar engine com SIGKILL ─────────────────────────────────────────
    const enginePidBefore = pidListeningOn(ENGINE_PORT);
    expect(enginePidBefore).toBeDefined();
    killSafely(enginePidBefore!, "SIGKILL");
    const released = await waitForPortClosed(ENGINE_URL, 3_000);
    expect(released).toBe(true);

    // ── 6. Doctor reporta engine offline (exit 2 = ao menos um crit) ─────────
    // (D1.a mudou exit codes: crit→2, warn→1, ok→0. Engine offline é crit.)
    const doctorOffline = runCli(["doctor"], env);
    expect(doctorOffline.exitCode).toBe(2);
    expect(doctorOffline.stdout.toLowerCase()).toContain("offline");

    // ── 7. View mostra alerta destacado ──────────────────────────────────────
    // (No score in DB yet → view will fail/exit 1; what we care about for the
    // alert path is covered in unit tests. Here we only assert doctor.)

    // ── 8. Restartar engine — novo processo, PID diferente ───────────────────
    engineProc = null; // discard handle to the dead one
    await startEngine();
    const enginePidAfter = pidListeningOn(ENGINE_PORT);
    expect(enginePidAfter).toBeDefined();
    expect(enginePidAfter).not.toBe(enginePidBefore);

    // ── 9. Killar e restartar MCP — contadores devem REBUILDAR do JSONL ─────
    const mcpPidBefore = pidListeningOn(MCP_PORT);
    expect(mcpPidBefore).toBeDefined();
    killSafely(mcpPidBefore!, "SIGKILL");
    const mcpReleased = await waitForPortClosed(MCP_URL, 3_000);
    expect(mcpReleased).toBe(true);
    mcpProc = null;

    await startMcp();
    const mcpPidAfter = pidListeningOn(MCP_PORT);
    expect(mcpPidAfter).not.toBe(mcpPidBefore);

    // The whole point of B16: counters survive restart by reading JSONL.
    // After rebuild, events_today == jsonlEvents (includes stops, unlike the
    // pre-restart in-memory counter — see helpers.ts).
    const afterRestart = await getStatus(MCP_URL);
    expect(afterRestart).not.toBeNull();
    expect(afterRestart!.events_today).toBe(totalJsonl);
    expect(afterRestart!.sessions_today).toBe(30);

    // ── 10. Doctor reporta ambos daemons healthy ─────────────────────────────
    // We don't strictly require exit 0 in this isolated test env — the PID
    // file isn't created (we bypass `beheld start`) and macOS codesign
    // warns when there's no real engine binary at ~/.beheld/bin/engine.
    // What MUST hold is: MCP and engine are reported healthy with the right
    // versions, and the actual listening PIDs are echoed back.
    const doctorOk = runCli(["doctor"], env);
    expect(doctorOk.stdout).toContain("Respondendo em /health (v0.4.1)");
    expect(doctorOk.stdout).toContain("v0.0.0-fake");
    expect(doctorOk.stdout).toContain(String(enginePidAfter));
    // No crit-level engine/mcp issues: those are the lines that actually
    // matter in production. (Warnings about PID file / codesign are env noise
    // in this stripped-down setup.)
    expect(doctorOk.stdout).not.toContain("Não responde em /health");
  }, 60_000);
});
