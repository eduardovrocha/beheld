import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, openSync } from "node:fs";
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
  mkdirSync(devprofileDir(), { recursive: true });
  writeFileSync(pidFile(), JSON.stringify(pids));
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(
  check: () => Promise<unknown>,
  maxMs = 10_000,
): Promise<boolean> {
  const start = Date.now();
  let delay = 200;
  while (Date.now() - start < maxMs) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 2000);
  }
  return false;
}

export async function start(): Promise<void> {
  const engineDest = await ensureEngine();
  const log = logFile();
  mkdirSync(devprofileDir(), { recursive: true });

  const pids = readPids();

  // Start MCP server if not already running
  if (!(await mcpHealth())) {
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

  // Start engine if not already running
  if (!(await engineHealth())) {
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

  const mcpOk = await waitForHealth(mcpHealth);
  const engineOk = await waitForHealth(engineHealth);
  if (!mcpOk || !engineOk) {
    throw new Error(
      `Daemon startup timed out — MCP:${mcpOk} Engine:${engineOk}`,
    );
  }
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
  const [mcp, eng] = await Promise.all([mcpHealth(), engineHealth()]);
  return mcp?.ok === true && eng?.ok === true;
}

export async function installAutostart(): Promise<void> {
  const bin = existsSync(binaryPath())
    ? binaryPath()
    : process.execPath;
  const log = logFile();

  if (platform() === "darwin") {
    const dir = join(homedir(), "Library", "LaunchAgents");
    const plist = join(dir, "com.devprofile.daemon.plist");
    await mkdir(dir, { recursive: true });
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.devprofile.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bin}</string>
    <string>server</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>`;
    await writeFile(plist, content);
    // launchctl load is best-effort; ignore errors in non-interactive envs
    spawn("launchctl", ["load", "-w", plist], { stdio: "ignore" });
  } else if (platform() === "linux") {
    const dir = join(homedir(), ".config", "systemd", "user");
    const unit = join(dir, "devprofile.service");
    await mkdir(dir, { recursive: true });
    const content = `[Unit]
Description=DevProfile daemon
After=default.target

[Service]
ExecStart=${bin} server
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
    await writeFile(unit, content);
    spawn("systemctl", ["--user", "enable", "--now", "devprofile.service"], {
      stdio: "ignore",
    });
  }
}
