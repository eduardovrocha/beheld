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

function getPidFile(): string {
  return path.join(getDevProfileDir(), "daemon.pid");
}

function getLogFile(): string {
  return path.join(getDevProfileDir(), "daemon.log");
}

function ensureDir(): void {
  const dir = getDevProfileDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

// ─── PID metadata (informational only — liveness comes from HTTP /health) ─────

export function writePid(pid: number): void {
  ensureDir();
  fs.writeFileSync(getPidFile(), pid.toString());
}

export function clearPid(): void {
  const f = getPidFile();
  if (fs.existsSync(f)) fs.rmSync(f);
}

// ─── Log rotation ─────────────────────────────────────────────────────────────

export function rotateLogs(): void {
  const logFile = getLogFile();
  if (!fs.existsSync(logFile)) return;
  if (fs.statSync(logFile).size >= MAX_LOG_SIZE) {
    fs.renameSync(logFile, `${logFile}.1`);
  }
}
