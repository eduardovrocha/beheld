import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB

export function getDevProfileDir(): string {
  const override = process.env.DEVPROFILE_DATA_DIR;
  return override
    ? path.join(override, ".devprofile")
    : path.join(os.homedir(), ".devprofile");
}

export function getPidFile(): string {
  return path.join(getDevProfileDir(), "daemon.pid");
}

export function getLogFile(): string {
  return path.join(getDevProfileDir(), "daemon.log");
}

export function writePid(pid: number): void {
  ensureDir();
  fs.writeFileSync(getPidFile(), pid.toString());
}

export function readPid(): number | null {
  const f = getPidFile();
  if (!fs.existsSync(f)) return null;
  const raw = fs.readFileSync(f, "utf8").trim();
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

export function clearPid(): void {
  const f = getPidFile();
  if (fs.existsSync(f)) fs.rmSync(f);
}

export function rotateLogs(): void {
  const logFile = getLogFile();
  if (!fs.existsSync(logFile)) return;
  const { size } = fs.statSync(logFile);
  if (size >= MAX_LOG_SIZE) {
    fs.renameSync(logFile, `${logFile}.1`);
  }
}

export function setupAutostart(binaryPath: string): { ok: boolean; method: string } {
  if (process.platform === "darwin") return setupLaunchAgent(binaryPath);
  if (process.platform === "linux") return setupSystemd(binaryPath);
  return { ok: false, method: "unsupported" };
}

export function removeAutostart(): void {
  if (process.platform === "darwin") {
    const plist = path.join(
      os.homedir(),
      "Library",
      "LaunchAgents",
      "com.devprofile.daemon.plist",
    );
    if (fs.existsSync(plist)) fs.rmSync(plist);
  } else if (process.platform === "linux") {
    const unit = path.join(
      os.homedir(),
      ".config",
      "systemd",
      "user",
      "devprofile.service",
    );
    if (fs.existsSync(unit)) fs.rmSync(unit);
  }
}

function setupLaunchAgent(binaryPath: string): { ok: boolean; method: string } {
  const dir = path.join(os.homedir(), "Library", "LaunchAgents");
  const plist = path.join(dir, "com.devprofile.daemon.plist");
  const logFile = getLogFile();

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key>
  <string>com.devprofile.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binaryPath}</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logFile}</string>
  <key>StandardErrorPath</key>
  <string>${logFile}</string>
</dict>
</plist>`;

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
ExecStart=${binaryPath} start --foreground
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

function ensureDir(): void {
  const dir = getDevProfileDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}
