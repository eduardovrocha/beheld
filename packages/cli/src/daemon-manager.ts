import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, openSync, chmodSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { ensureEngine } from "./engine-extractor";
import { mcpHealth } from "./client/mcp-client";
import { engineHealth } from "./client/engine-client";

const devprofileDir = () =>
  process.env.DEVPROFILE_DATA_DIR
    ? join(process.env.DEVPROFILE_DATA_DIR, ".devprofile")
    : join(homedir(), ".devprofile");

const pidFile = () => join(devprofileDir(), "daemon.pid");
const logFile = () => join(devprofileDir(), "daemon.log");
const binaryPath = () => join(homedir(), ".local", "bin", "devprofile");

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
  mkdirSync(devprofileDir(), { recursive: true, mode: 0o700 });
  writeFileSync(pidFile(), JSON.stringify(pids));
}

/**
 * Ensures ~/.devprofile and its subdirectories have secure permissions (0700).
 * Corrects existing installations that may have been created with looser modes.
 * Accepts an optional baseDir for testability; defaults to the live devprofile dir.
 */
export function ensureSecurePermissions(baseDir?: string): void {
  const base = baseDir ?? devprofileDir();
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
  mkdirSync(devprofileDir(), { recursive: true, mode: 0o700 });

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

  const mcp = mcpAlreadyUp || await waitForHealthPort(7337);
  const engine = engineAlreadyUp || await waitForHealthPort(7338);

  return { mcp, engine, alreadyRunning: false };
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

// KeepAlive is false because `devprofile start` exits once both daemons are up.
// launchd must not loop-restart a one-shot command.
export function generateLaunchAgentPlist(bin: string, devDir: string): string {
  const log = join(devDir, "daemon.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.devprofile.daemon</string>
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

// Type=oneshot + RemainAfterExit because `devprofile start` exits after launching
// both daemons. Without RemainAfterExit the unit would show as inactive immediately.
export function generateSystemdService(bin: string, _devDir: string): string {
  return `[Unit]
Description=DevProfile daemons
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
    const dir = join(homedir(), "Library", "LaunchAgents");
    const plist = join(dir, "com.devprofile.daemon.plist");
    await mkdir(dir, { recursive: true });
    await writeFile(plist, generateLaunchAgentPlist(bin, devprofileDir()));
    // launchctl load is best-effort; ignore errors in non-interactive envs
    spawn("launchctl", ["load", "-w", plist], { stdio: "ignore" });
  } else if (platform() === "linux") {
    const dir = join(homedir(), ".config", "systemd", "user");
    const unit = join(dir, "devprofile.service");
    await mkdir(dir, { recursive: true });
    await writeFile(unit, generateSystemdService(bin, devprofileDir()));
    spawn("systemctl", ["--user", "enable", "--now", "devprofile.service"], {
      stdio: "ignore",
    });
  }
}
