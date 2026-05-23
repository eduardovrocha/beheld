import { spawnSync } from "node:child_process";
import { join } from "node:path";

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SpawnEnv {
  BEHELD_DATA_DIR: string;
  BEHELD_PORT: string;
  BEHELD_MCP_URL: string;
  BEHELD_ENGINE_URL: string;
  FAKE_ENGINE_PORT: string;
}

export const repoRoot = (() => {
  // helpers.ts lives at packages/cli/tests/integration/, repo root is 4 up
  return join(import.meta.dir, "..", "..", "..", "..");
})();

const cliEntry = () => join(repoRoot, "packages/cli/src/index.ts");
const mcpEntry = () => join(repoRoot, "packages/mcp-server/src/server.ts");
const fakeEngine = () => join(import.meta.dir, "fake-engine.ts");

export function buildEnv(opts: {
  dataDir: string;
  mcpPort: number;
  enginePort: number;
}): SpawnEnv & Record<string, string> {
  const env = {
    ...(process.env as Record<string, string>),
    BEHELD_DATA_DIR: opts.dataDir,
    BEHELD_PORT: String(opts.mcpPort),
    BEHELD_MCP_URL: `http://127.0.0.1:${opts.mcpPort}`,
    BEHELD_ENGINE_URL: `http://127.0.0.1:${opts.enginePort}`,
    FAKE_ENGINE_PORT: String(opts.enginePort),
  };
  return env;
}

/** Spawn the CLI as a child process and wait for it to exit. */
export function runCli(args: string[], env: Record<string, string>): RunResult {
  const result = spawnSync("bun", ["run", cliEntry(), ...args], {
    env,
    stdio: "pipe",
    timeout: 30_000,
  });
  return {
    exitCode: result.status ?? -1,
    stdout: (result.stdout ?? Buffer.from("")).toString(),
    stderr: (result.stderr ?? Buffer.from("")).toString(),
  };
}

/** Spawn the MCP server as a long-lived subprocess. */
export function spawnMcp(env: Record<string, string>): ReturnType<typeof Bun.spawn> {
  return Bun.spawn(["bun", "run", mcpEntry()], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

/** Spawn the fake engine as a long-lived subprocess. */
export function spawnFakeEngine(env: Record<string, string>): ReturnType<typeof Bun.spawn> {
  return Bun.spawn(["bun", "run", fakeEngine()], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Poll http://host:port/health until it responds 200 or timeout. */
export async function waitForHealth(url: string, timeoutMs = 5_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(150);
  }
  return false;
}

/** Poll for a closed port — used to wait for a SIGKILL'd process to release it. */
export async function waitForPortClosed(url: string, timeoutMs = 3_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(300) });
      if (!res.ok) return true;
    } catch {
      return true;
    }
    await sleep(100);
  }
  return false;
}

export interface MaybeStatus {
  running: boolean;
  events_today: number;
  sessions_today: number;
  pid?: number;
}

export async function getStatus(mcpUrl: string): Promise<MaybeStatus | null> {
  try {
    const res = await fetch(`${mcpUrl}/status`, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return null;
    return (await res.json()) as MaybeStatus;
  } catch {
    return null;
  }
}

export function pidListeningOn(port: number): number | undefined {
  const res = spawnSync("lsof", ["-i", `:${port}`, "-P", "-n", "-sTCP:LISTEN", "-t"], {
    stdio: "pipe",
  });
  if (res.status !== 0) return undefined;
  const out = (res.stdout?.toString() ?? "").trim();
  if (!out) return undefined;
  const n = parseInt(out.split("\n")[0]!, 10);
  return Number.isFinite(n) ? n : undefined;
}

export interface SimulatedSessionResult {
  sessionId: string;
  /** Events tracked in MCP's in-memory counter (pre-tool + post-tool only). */
  trackedEvents: number;
  /** Events written to JSONL on disk (pre-tool + post-tool + stop). */
  jsonlEvents: number;
}

/**
 * Drives N independent Claude Code sessions through the MCP HTTP hooks the
 * same way the real Claude Code daemon does: pre_tool_use → post_tool_use →
 * stop. Each call writes real events to JSONL via the MCP's writer, exercising
 * the same code path production uses.
 */
export async function simulateClaudeSessions(
  mcpUrl: string,
  sessionCount: number,
): Promise<SimulatedSessionResult[]> {
  const results: SimulatedSessionResult[] = [];
  for (let i = 0; i < sessionCount; i++) {
    const sessionId = `integration-sess-${i}-${Date.now()}`;
    let trackedEvents = 0;
    let jsonlEvents = 0;

    // Two pre/post pairs per session = 4 events tracked + 1 stop = 5 in JSONL
    for (const tool of ["Bash", "Read"]) {
      const pre = await fetch(`${mcpUrl}/hook/pre-tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          tool_name: tool,
          tool_input: tool === "Bash" ? { command: "ls" } : { file_path: "/tmp/x" },
        }),
      });
      if (pre.ok) { trackedEvents++; jsonlEvents++; }

      const post = await fetch(`${mcpUrl}/hook/post-tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          tool_name: tool,
          tool_input: tool === "Bash" ? { command: "ls" } : { file_path: "/tmp/x" },
          tool_response: { ok: true },
          duration_ms: 5,
        }),
      });
      if (post.ok) { trackedEvents++; jsonlEvents++; }
    }

    // Stop is written to JSONL but NOT tracked by the in-memory counter — see
    // server.ts /hook/stop. After an MCP restart the rebuild from JSONL DOES
    // count it, so events_today legitimately bumps from trackedEvents to
    // jsonlEvents on first restart.
    const stop = await fetch(`${mcpUrl}/hook/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, total_turns: 2 }),
    });
    if (stop.ok) jsonlEvents++;

    results.push({ sessionId, trackedEvents, jsonlEvents });
  }
  return results;
}

/** Best-effort kill — silently ignores ESRCH (process already gone). */
export function killSafely(pid: number, signal: NodeJS.Signals = "SIGTERM"): void {
  try {
    process.kill(pid, signal);
  } catch {
    // already gone
  }
}
