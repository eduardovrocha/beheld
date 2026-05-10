import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawnSync } from "child_process";

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB

export function getDevProfileDir(): string {
  const override = process.env.DEVPROFILE_DATA_DIR;
  return override
    ? path.join(override, ".devprofile")
    : path.join(os.homedir(), ".devprofile");
}

function getPidFile(): string {
  return path.join(getDevProfileDir(), "daemon.pid");
}

function getLogFile(): string {
  return path.join(getDevProfileDir(), "daemon.log");
}

function getBinaryPath(): string {
  return path.join(os.homedir(), ".local", "bin", "devprofile");
}

function ensureDir(): void {
  const dir = getDevProfileDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

// ─── PID management ──────────────────────────────────────────────────────────

export function writePid(pid: number): void {
  ensureDir();
  fs.writeFileSync(getPidFile(), pid.toString());
}

export function readPid(): number | null {
  const f = getPidFile();
  if (!fs.existsSync(f)) return null;
  const n = parseInt(fs.readFileSync(f, "utf8").trim(), 10);
  return isNaN(n) ? null : n;
}

export function clearPid(): void {
  const f = getPidFile();
  if (fs.existsSync(f)) fs.rmSync(f);
}

// ─── Daemon lifecycle ─────────────────────────────────────────────────────────

/**
 * Start the MCP server daemon in the background.
 * No-op if already running.
 */
export function start(): void {
  if (isRunning()) return;

  const bin = getBinaryPath();
  if (!fs.existsSync(bin)) {
    throw new Error(`DevProfile binary not found at ${bin}. Run the installer first.`);
  }

  const { spawn } = require("child_process");
  const log = getLogFile();
  ensureDir();

  const child = spawn(bin, ["server"], {
    detached: true,
    stdio: ["ignore", fs.openSync(log, "a"), fs.openSync(log, "a")],
  });
  child.unref();
}

/**
 * Stop the daemon by sending SIGTERM to the recorded PID.
 */
export function stop(): void {
  const pid = readPid();
  if (!pid) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process already gone — clean up stale PID file
  }
  clearPid();
}

/**
 * Returns true if the daemon PID exists and the process is alive.
 */
export function isRunning(): boolean {
  const pid = readPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0); // Signal 0 just checks existence
    return true;
  } catch {
    return false;
  }
}

// ─── Log rotation ─────────────────────────────────────────────────────────────

export function rotateLogs(): void {
  const logFile = getLogFile();
  if (!fs.existsSync(logFile)) return;
  if (fs.statSync(logFile).size >= MAX_LOG_SIZE) {
    fs.renameSync(logFile, `${logFile}.1`);
  }
}

// ─── Autostart ────────────────────────────────────────────────────────────────

export function setupAutostart(binaryPath?: string): { ok: boolean; method: string } {
  const bin = binaryPath ?? getBinaryPath();
  if (process.platform === "darwin") return setupLaunchAgent(bin);
  if (process.platform === "linux") return setupSystemd(bin);
  return { ok: false, method: "unsupported" };
}

export function removeAutostart(): void {
  if (process.platform === "darwin") {
    const plist = path.join(os.homedir(), "Library", "LaunchAgents", "com.devprofile.daemon.plist");
    if (fs.existsSync(plist)) fs.rmSync(plist);
  } else if (process.platform === "linux") {
    const unit = path.join(os.homedir(), ".config", "systemd", "user", "devprofile.service");
    if (fs.existsSync(unit)) fs.rmSync(unit);
  }
}

function setupLaunchAgent(binaryPath: string): { ok: boolean; method: string } {
  const dir = path.join(os.homedir(), "Library", "LaunchAgents");
  const plist = path.join(dir, "com.devprofile.daemon.plist");
  const log = getLogFile();

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.devprofile.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binaryPath}</string>
    <string>server</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>`;

  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(plist, content);
    return { ok: true, method: "launchagent" };
  } catch {
    return { ok: false, method: "launchagent" };
  }
}

function setupSystemd(binaryPath: string): { ok: boolean; method: string } {
  const dir = path.join(os.homedir(), ".config", "systemd", "user");
  const unit = path.join(dir, "devprofile.service");

  const content = `[Unit]
Description=DevProfile daemon
After=network.target

[Service]
ExecStart=${binaryPath} server
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;

  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(unit, content);
    return { ok: true, method: "systemd" };
  } catch {
    return { ok: false, method: "systemd" };
  }
}
