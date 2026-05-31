import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, openSync, chmodSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { ensureEngine } from "./engine-extractor";
import { mcpHealth } from "./client/mcp-client";
import { engineHealth } from "./client/engine-client";

const beheldDir = () =>
  process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");

const pidFile = () => join(beheldDir(), "daemon.pid");
const logFile = () => join(beheldDir(), "daemon.log");
const binaryPath = () => join(homedir(), ".local", "bin", "beheld");

// Autostart identifiers — exported so other commands (e.g. doctor) can probe
// the LaunchAgent / systemd unit without duplicating the names.
export const LAUNCH_AGENT_LABEL = "com.beheld.daemon";
export const SYSTEMD_SERVICE_NAME = "beheld.service";
export const launchAgentPlistPath = (): string =>
  join(homedir(), "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
export const systemdUnitPath = (): string =>
  join(homedir(), ".config", "systemd", "user", SYSTEMD_SERVICE_NAME);

interface DaemonPids {
  mcp?: number;
  engine?: number;
}

function readPids(): DaemonPids {
  const f = pidFile();
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return {};
  }
}

function writePids(pids: DaemonPids): void {
  mkdirSync(beheldDir(), { recursive: true, mode: 0o700 });
  writeFileSync(pidFile(), JSON.stringify(pids));
}

/**
 * Ensures ~/.beheld and its subdirectories have secure permissions (0700).
 * Corrects existing installations that may have been created with looser modes.
 * Accepts an optional baseDir for testability; defaults to the live beheld dir.
 */
export function ensureSecurePermissions(baseDir?: string): void {
  const base = baseDir ?? beheldDir();
  const dirs = [base, join(base, "sessions"), join(base, "bin")];
  for (const dir of dirs) {
    if (existsSync(dir)) {
      try { chmodSync(dir, 0o700); } catch { /* ignore — no permission to chmod */ }
    }
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface StartResult {
  mcp: boolean;
  engine: boolean;
  alreadyRunning: boolean;
}

export async function isMcpRunning(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:7337/health", {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function isEngineRunning(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:7338/health", {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealthPort(
  port: number,
  timeoutMs = 10_000,
  intervalMs = 500,
): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export async function start(): Promise<StartResult> {
  const [mcpAlreadyUp, engineAlreadyUp] = await Promise.all([
    isMcpRunning(),
    isEngineRunning(),
  ]);

  if (mcpAlreadyUp && engineAlreadyUp) {
    return { mcp: true, engine: true, alreadyRunning: true };
  }

  const engineDest = await ensureEngine();
  const log = logFile();
  mkdirSync(beheldDir(), { recursive: true, mode: 0o700 });

  const pids = readPids();

  if (!mcpAlreadyUp) {
    const bin = existsSync(binaryPath()) ? binaryPath() : process.execPath;
    const args = existsSync(binaryPath())
      ? ["server"]
      : [join(import.meta.dir, "index.ts"), "server"];
    const fd = openSync(log, "a");
    const child = spawn(bin, args, {
      detached: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env },
    });
    child.unref();
    pids.mcp = child.pid ?? undefined;
  }

  if (!engineAlreadyUp) {
    const fd = openSync(log, "a");
    const child = spawn(engineDest, [], {
      detached: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env },
    });
    child.unref();
    pids.engine = child.pid ?? undefined;
  }

  writePids(pids);

  // MCP is Bun and binds in <100ms; 10s is plenty.
  // Engine is a PyInstaller bundle that extracts itself to /tmp/_MEI* on first
  // run (cold start ~12-15s on macOS). After the cache is warm, < 1s. Wait up
  // to 30s for the engine; running in parallel with MCP keeps the perceived
  // start time short on warm starts.
  const [mcp, engine] = await Promise.all([
    mcpAlreadyUp ? Promise.resolve(true) : waitForHealthPort(7337, 10_000),
    engineAlreadyUp ? Promise.resolve(true) : waitForHealthPort(7338, 30_000),
  ]);

  // Fix the PID file: PyInstaller's bootloader (the PID we got from spawn())
  // execs/forks into the real Python interpreter, which gets a different PID.
  // The bootloader exits, lsof sees the inner process. Without this update,
  // doctor will report "PID drift" forever and `restart` won't fix it.
  if (engine && !engineAlreadyUp) {
    const realEnginePid = pidListeningOn(7338);
    if (realEnginePid !== undefined && realEnginePid !== pids.engine) {
      pids.engine = realEnginePid;
      writePids(pids);
    }
  }

  return { mcp, engine, alreadyRunning: false };
}

function pidListeningOn(port: number): number | undefined {
  const res = spawnSync("lsof", ["-i", `:${port}`, "-P", "-n", "-sTCP:LISTEN", "-t"], {
    stdio: "pipe",
  });
  if (res.status !== 0) return undefined;
  const out = (res.stdout?.toString() ?? "").trim();
  if (!out) return undefined;
  const n = parseInt(out.split("\n")[0]!, 10);
  return Number.isFinite(n) ? n : undefined;
}

export async function stop(): Promise<void> {
  const pids = readPids();
  for (const pid of [pids.mcp, pids.engine]) {
    if (!pid) continue;
    try {
      process.kill(pid, "SIGTERM");
      // Wait up to 5s for graceful exit
      let waited = 0;
      while (processAlive(pid) && waited < 5000) {
        await new Promise((r) => setTimeout(r, 200));
        waited += 200;
      }
      if (processAlive(pid)) process.kill(pid, "SIGKILL");
    } catch {
      // Already gone
    }
  }
  if (existsSync(pidFile())) rmSync(pidFile());
}

export async function isRunning(): Promise<boolean> {
  const [mcp, eng] = await Promise.all([isMcpRunning(), isEngineRunning()]);
  return mcp && eng;
}

// KeepAlive is false because `beheld start` exits once both daemons are up.
// launchd must not loop-restart a one-shot command.
export function generateLaunchAgentPlist(bin: string, devDir: string): string {
  const log = join(devDir, "daemon.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bin}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${log}</string>
  <key>StandardErrorPath</key>
  <string>${log}</string>
</dict>
</plist>`;
}

// Type=oneshot + RemainAfterExit because `beheld start` exits after launching
// both daemons. Without RemainAfterExit the unit would show as inactive immediately.
export function generateSystemdService(bin: string, _devDir: string): string {
  return `[Unit]
Description=Beheld daemons
After=default.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${bin} start

[Install]
WantedBy=default.target
`;
}

export async function installAutostart(): Promise<void> {
  const bin = existsSync(binaryPath()) ? binaryPath() : process.execPath;

  if (platform() === "darwin") {
    const plist = launchAgentPlistPath();
    await mkdir(dirname(plist), { recursive: true });
    await writeFile(plist, generateLaunchAgentPlist(bin, beheldDir()));
    // launchctl load is best-effort; ignore errors in non-interactive envs
    spawn("launchctl", ["load", "-w", plist], { stdio: "ignore" });
  } else if (platform() === "linux") {
    const unit = systemdUnitPath();
    await mkdir(dirname(unit), { recursive: true });
    await writeFile(unit, generateSystemdService(bin, beheldDir()));
    spawn("systemctl", ["--user", "enable", "--now", SYSTEMD_SERVICE_NAME], {
      stdio: "ignore",
    });
  }
}
