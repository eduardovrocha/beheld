import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { mcpHealth, mcpStatus } from "../client/mcp-client";
import { engineHealth } from "../client/engine-client";
import {
  LAUNCH_AGENT_LABEL,
  SYSTEMD_SERVICE_NAME,
  launchAgentPlistPath,
  systemdUnitPath,
} from "../daemon-manager";
import { selfHealEngine } from "./heal-engine";
import type { HealReport, HealStep } from "./heal-engine";
import { pidListeningOn } from "../util/ports";
export { pidListeningOn };
import { GREEN, RED, YELLOW, DIM, BOLD, RESET, brand } from "../ui/styles";

type Severity = "ok" | "warn" | "crit";

interface CheckResult {
  severity: Severity;
  label: string;
  lines: string[];
  hint?: string;
}

function beheldDir(): string {
  return process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");
}

function pidFilePath(): string {
  return join(beheldDir(), "daemon.pid");
}

function sessionsDir(): string {
  return join(beheldDir(), "sessions");
}

function engineBinaryPath(): string {
  return join(beheldDir(), "bin", "engine");
}

function readPidFile(): { mcp?: number; engine?: number } | null {
  const fp = pidFilePath();
  if (!existsSync(fp)) return null;
  try {
    return JSON.parse(readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftDate(s: string, days: number): string {
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

// ── individual checks ────────────────────────────────────────────────────────

async function checkMcp(): Promise<CheckResult> {
  const port = mcpPort();
  const health = await mcpHealth();
  if (!health?.ok) {
    return {
      severity: "crit",
      label: `MCP server (porta ${port})`,
      lines: [`${RED}✗${RESET} Não responde em /health`],
      hint: "Tentar: beheld start",
    };
  }
  const status = await mcpStatus();
  const version = (health as { version?: string }).version ?? "?";
  const pid = status?.pid;
  return {
    severity: "ok",
    label: `MCP server (porta ${port})`,
    lines: [
      `${GREEN}✓${RESET} Respondendo em /health (v${version})`,
      pid ? `${GREEN}✓${RESET} PID ${pid}` : `${DIM}PID indisponível${RESET}`,
    ],
  };
}

export interface ProcInfo {
  stat: string;
  cpuPct: number;
  etime: string;
}

// Pura: testável sem spawnar processo.
// Espera a linha "STAT %CPU ETIME" (separadores variáveis de whitespace).
function parseProcOutput(line: string): ProcInfo | undefined {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) return undefined;
  const stat = parts[0]!;
  const cpuPct = parseFloat(parts[1]!);
  const etime = parts[2]!;
  if (!Number.isFinite(cpuPct)) return undefined;
  return { stat, cpuPct, etime };
}

function inspectProcess(pid: number): ProcInfo | undefined {
  // `ps -o stat=,%cpu=,etime=` funciona em macOS e Linux; os `=` ao final
  // de cada campo suprimem o cabeçalho.
  const res = spawnSync("ps", ["-o", "stat=,%cpu=,etime=", "-p", String(pid)], {
    stdio: "pipe",
  });
  if (res.status !== 0) return undefined;
  return parseProcOutput(res.stdout?.toString() ?? "");
}

export interface EngineProbes {
  fetchEnginePid?: () => Promise<number | undefined>;
  engineHealth?: () => Promise<{ ok: boolean; version?: string } | null>;
  inspectProcess?: (pid: number) => ProcInfo | undefined;
}

export type EngineCheck = CheckResult & {
  runtimePid?: number;
  proc?: ProcInfo;
};

async function checkEngine(probes: EngineProbes = {}): Promise<EngineCheck> {
  const port = enginePort();
  const getPid = probes.fetchEnginePid ?? fetchEnginePid;
  const getHealth = probes.engineHealth ?? engineHealth;
  const inspect = probes.inspectProcess ?? inspectProcess;

  // Resolver o PID por porta SEMPRE — não só no caminho de sucesso.
  const runtimePid = await getPid();
  const health = await getHealth();
  if (!health?.ok) {
    if (runtimePid !== undefined) {
      // Porta LISTEN + /health não responde → vivo mas HTTP travado.
      const proc = inspect(runtimePid);
      const looksBusyLoop =
        proc !== undefined && proc.stat.includes("R") && proc.cpuPct > 50;
      return {
        severity: "crit",
        label: `Scoring engine (porta ${port})`,
        lines: [
          `${RED}✗${RESET} Porta ${port} LISTEN no PID ${runtimePid} mas /health não responde`,
          looksBusyLoop
            ? `${RED}✗${RESET} Provável busy-loop (STAT=${proc!.stat}, CPU=${proc!.cpuPct}%, etime=${proc!.etime})`
            : `${YELLOW}⚠${RESET} Processo vivo, HTTP travado${
                proc ? ` (STAT=${proc.stat}, CPU=${proc.cpuPct}%)` : ""
              }`,
        ],
        hint: looksBusyLoop
          ? `Correção sugerida: kill -9 ${runtimePid} && beheld start`
          : "Tentar: beheld restart",
        runtimePid,
        proc,
      };
    }
    // Sem listener: engine realmente offline.
    return {
      severity: "crit",
      label: `Scoring engine (porta ${port})`,
      lines: [`${RED}✗${RESET} Porta ${port} sem listener — engine offline`],
      hint: "Tentar: beheld start",
    };
  }
  const version = (health as { version?: string }).version ?? "?";
  return {
    severity: "ok",
    label: `Scoring engine (porta ${port})`,
    lines: [
      `${GREEN}✓${RESET} Respondendo em /health (v${version})`,
      runtimePid ? `${GREEN}✓${RESET} PID ${runtimePid}` : `${DIM}PID indisponível${RESET}`,
    ],
    runtimePid,
  };
}

function portFromUrl(url: string | undefined, fallback: number): number {
  if (!url) return fallback;
  try {
    const parsed = new URL(url);
    const n = parseInt(parsed.port, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

function mcpPort(): number {
  return portFromUrl(process.env.BEHELD_MCP_URL, 7337);
}

function enginePort(): number {
  return portFromUrl(process.env.BEHELD_ENGINE_URL, 7338);
}

// pidListeningOn agora mora em util/ports.ts (compartilhado com supervisor).
// Re-exportado abaixo para preservar contratos de teste do D0-D2.

async function fetchEnginePid(): Promise<number | undefined> {
  return pidListeningOn(enginePort());
}

function checkPidFile(runtimeEnginePid: number | undefined): CheckResult {
  const pids = readPidFile();
  if (!pids) {
    return {
      severity: "warn",
      label: "Arquivo de PID",
      lines: [`${YELLOW}⚠${RESET} ~/.beheld/daemon.pid não existe`],
      hint: "Tentar: beheld start",
    };
  }
  const lines = [`${GREEN}✓${RESET} ${pidFilePath().replace(homedir(), "~")} existe`];
  let severity: Severity = "ok";
  let hint: string | undefined;
  if (runtimeEnginePid !== undefined && pids.engine !== undefined && pids.engine !== runtimeEnginePid) {
    lines.push(
      `${YELLOW}⚠${RESET} PID registrado (${pids.engine}) difere do PID real do engine (${runtimeEnginePid})`,
    );
    severity = "warn";
    hint = "Correção sugerida: beheld restart";
  }
  return { severity, label: "Arquivo de PID", lines, hint };
}

function checkCodesignMacOS(): CheckResult | null {
  if (platform() !== "darwin") return null;
  const bin = engineBinaryPath();
  if (!existsSync(bin)) {
    return {
      severity: "warn",
      label: "Codesign (macOS)",
      lines: [`${YELLOW}⚠${RESET} Engine binary não extraído ainda em ${bin.replace(homedir(), "~")}`],
      hint: "Execute: beheld start (extrai o binário na primeira vez)",
    };
  }
  const lines: string[] = [];
  let severity: Severity = "ok";
  let hint: string | undefined;

  const codesignRes = spawnSync("codesign", ["-dv", bin], { stdio: "pipe" });
  const codesignOut = (codesignRes.stderr?.toString() ?? "") + (codesignRes.stdout?.toString() ?? "");
  if (codesignRes.status === 0) {
    const adhoc = codesignOut.includes("Signature=adhoc") || codesignOut.includes("flags=0x2");
    lines.push(
      adhoc
        ? `${GREEN}✓${RESET} Engine assinado em modo adhoc`
        : `${GREEN}✓${RESET} Engine assinado`,
    );
  } else {
    lines.push(`${YELLOW}⚠${RESET} Engine não assinado (codesign falhou)`);
    severity = "warn";
    hint = "Tentar: beheld start (re-extrai e re-assina)";
  }

  const xattrRes = spawnSync("xattr", [bin], { stdio: "pipe" });
  const xattrOut = (xattrRes.stdout?.toString() ?? "");
  if (xattrOut.includes("com.apple.quarantine")) {
    lines.push(`${YELLOW}⚠${RESET} Atributo de quarentena presente`);
    severity = "warn";
    hint = `Comando: xattr -d com.apple.quarantine ${bin.replace(homedir(), "~")}`;
  } else {
    lines.push(`${GREEN}✓${RESET} Sem atributo de quarentena`);
  }

  return { severity, label: "Codesign (macOS)", lines, hint };
}

function claudeCodeOptedIn(): boolean {
  try {
    const cfg = JSON.parse(
      readFileSync(join(beheldDir(), "config.json"), "utf8"),
    ) as { environments?: { claudeCode?: unknown } };
    return cfg.environments?.claudeCode === true;
  } catch {
    return false;
  }
}

async function checkClaudeIntegration(): Promise<CheckResult> {
  const { claudeCommandPath, claudeJsonPath, selfHealClaudeIntegration } =
    await import("../config/hooks");

  if (!claudeCodeOptedIn()) {
    return {
      severity: "ok",
      label: "Integração Claude Code (/beheld)",
      lines: [`${DIM}Claude Code não habilitado — etapa opcional${RESET}`],
    };
  }

  // Self-heal first: doctor both diagnoses AND repairs a vanished /beheld.
  let healed = { slashCommandRestored: false, mcpServerRestored: false };
  try {
    healed = await selfHealClaudeIntegration();
  } catch {
    /* fall through to report raw state */
  }

  const commandFile = claudeCommandPath();
  const hasCommand =
    existsSync(commandFile) && readFileSync(commandFile, "utf8").trim().length > 0;

  let hasMcp = false;
  try {
    const cfg = JSON.parse(readFileSync(claudeJsonPath(), "utf8")) as {
      mcpServers?: Record<string, { args?: unknown }>;
    };
    const entry = cfg.mcpServers?.["beheld"];
    hasMcp = !!entry && Array.isArray(entry.args) && entry.args.includes("--stdio");
  } catch {
    /* hasMcp stays false */
  }

  const lines = [
    hasCommand
      ? `${GREEN}✓${RESET} Slash command ${commandFile.replace(homedir(), "~")}${healed.slashCommandRestored ? " (restaurado agora)" : ""}`
      : `${RED}✗${RESET} Slash command ausente — /beheld não aparece`,
    hasMcp
      ? `${GREEN}✓${RESET} MCP server registrado em ~/.claude.json${healed.mcpServerRestored ? " (restaurado agora)" : ""}`
      : `${RED}✗${RESET} MCP server não registrado em ~/.claude.json`,
  ];

  const severity: Severity = hasCommand && hasMcp ? "ok" : "crit";
  return {
    severity,
    label: "Integração Claude Code (/beheld)",
    lines,
    hint: severity === "ok" ? undefined : "Execute: beheld init (marque Claude Code)",
  };
}

// ── processing probes (disco — independem do engine vivo) ───────────────────

interface SessionEntry {
  name: string;
  size: number;
  mtime: number;
}

export interface ProcessingSnapshot {
  cursor: { offsets: Record<string, number>; mtime: number } | null;
  sessions: SessionEntry[];
  profileDb: { mtime: number } | null;
  profileDbWal: { size: number } | null;
}

export const CURSOR_STALENESS_THRESHOLD_MS = 5 * 60 * 1000;
const DB_WRITE_STALENESS_THRESHOLD_MS = 5 * 60 * 1000;
const WAL_WARN_THRESHOLD_BYTES = 4 * 1024 * 1024;

function cursorPath(): string {
  return join(beheldDir(), ".cursor");
}

function profileDbPath(): string {
  return join(beheldDir(), "profile.db");
}

function profileDbWalPath(): string {
  return join(beheldDir(), "profile.db-wal");
}

async function takeProcessingSnapshot(): Promise<ProcessingSnapshot> {
  // Cursor — JSON com { offsets: { <session-filename>: <byte offset>, ... } }
  // (formato confirmado no engine: packages/engine/src/reader/jsonl_reader.py)
  let cursor: ProcessingSnapshot["cursor"] = null;
  const cp = cursorPath();
  if (existsSync(cp)) {
    try {
      const raw = JSON.parse(readFileSync(cp, "utf8")) as { offsets?: unknown };
      const offsets: Record<string, number> = {};
      if (raw && typeof raw === "object" && raw.offsets && typeof raw.offsets === "object") {
        for (const [k, v] of Object.entries(raw.offsets as Record<string, unknown>)) {
          if (typeof v === "number" && Number.isFinite(v)) offsets[k] = v;
        }
      }
      const mtime = statSync(cp).mtimeMs;
      cursor = { offsets, mtime };
    } catch {
      cursor = null;
    }
  }

  // Sessions — fs.stat de cada *.jsonl, ordem lexical = cronológica.
  const sessions: SessionEntry[] = [];
  const dir = sessionsDir();
  if (existsSync(dir)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      entries = [];
    }
    for (const name of entries) {
      if (!name.endsWith(".jsonl")) continue;
      try {
        const st = statSync(join(dir, name));
        sessions.push({ name, size: st.size, mtime: st.mtimeMs });
      } catch {
        /* skip unreadable */
      }
    }
    sessions.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  // profile.db + WAL
  let profileDb: ProcessingSnapshot["profileDb"] = null;
  const dbp = profileDbPath();
  if (existsSync(dbp)) {
    try {
      profileDb = { mtime: statSync(dbp).mtimeMs };
    } catch {
      profileDb = null;
    }
  }

  let profileDbWal: ProcessingSnapshot["profileDbWal"] = null;
  const walp = profileDbWalPath();
  if (existsSync(walp)) {
    try {
      profileDbWal = { size: statSync(walp).size };
    } catch {
      profileDbWal = null;
    }
  }

  return { cursor, sessions, profileDb, profileDbWal };
}

// ── pure formatters ─────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  const clamped = Math.max(0, ms);
  const s = Math.floor(clamped / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── pure evaluators ─────────────────────────────────────────────────────────

function evaluateCursorStaleness(
  snap: ProcessingSnapshot,
  _now: number,
  thresholdMs: number,
): CheckResult {
  const label = "Cursor do reader";
  if (snap.sessions.length === 0) {
    return { severity: "ok", label, lines: [`${DIM}Nada para processar ainda${RESET}`] };
  }
  if (snap.cursor === null) {
    return {
      severity: "warn",
      label,
      lines: [`${YELLOW}⚠${RESET} Sem ~/.beheld/.cursor — engine nunca processou`],
      hint: "Tentar: beheld start",
    };
  }
  const newest = Math.max(...snap.sessions.map((s) => s.mtime));
  const delta = Math.max(0, newest - snap.cursor.mtime);
  if (delta <= thresholdMs) {
    return { severity: "ok", label, lines: [`${GREEN}✓${RESET} Cursor avançou recentemente`] };
  }
  return {
    severity: "warn",
    label,
    lines: [`${YELLOW}⚠${RESET} Cursor parado há ${formatDuration(delta)} vs sessão mais nova`],
    hint: "Engine pode ter travado — checar /health",
  };
}

function evaluateDbWrite(
  snap: ProcessingSnapshot,
  _now: number,
  thresholdMs: number,
): CheckResult {
  const label = "Escrita do profile.db";
  if (snap.profileDb === null) {
    return {
      severity: "warn",
      label,
      lines: [`${YELLOW}⚠${RESET} ~/.beheld/profile.db não existe`],
      hint: "Tentar: beheld start",
    };
  }
  if (snap.sessions.length === 0) {
    return { severity: "ok", label, lines: [`${DIM}Sem sessões para processar${RESET}`] };
  }
  const newest = Math.max(...snap.sessions.map((s) => s.mtime));
  const delta = Math.max(0, newest - snap.profileDb.mtime);
  if (delta <= thresholdMs) {
    return { severity: "ok", label, lines: [`${GREEN}✓${RESET} Escrita recente em profile.db`] };
  }
  return {
    severity: "warn",
    label,
    lines: [`${YELLOW}⚠${RESET} Sem escrita há ${formatDuration(delta)} vs sessão mais nova`],
    hint: "Engine pode ter parado de persistir scores",
  };
}

function evaluateWal(snap: ProcessingSnapshot, thresholdBytes: number): CheckResult {
  const label = "WAL do SQLite";
  if (snap.profileDbWal === null || snap.profileDbWal.size === 0) {
    return { severity: "ok", label, lines: [`${DIM}WAL ausente ou vazio${RESET}`] };
  }
  const size = snap.profileDbWal.size;
  if (size <= thresholdBytes) {
    return { severity: "ok", label, lines: [`${GREEN}✓${RESET} WAL com ${formatBytes(size)}`] };
  }
  return {
    severity: "warn",
    label,
    lines: [
      `${YELLOW}⚠${RESET} WAL inchado (${formatBytes(size)}) — checkpoint não está rodando`,
    ],
    hint: 'sqlite3 ~/.beheld/profile.db "PRAGMA wal_checkpoint(TRUNCATE);"',
  };
}

function evaluateBacklog(snap: ProcessingSnapshot): CheckResult {
  const label = "Backlog de eventos";
  if (snap.sessions.length === 0) {
    return {
      severity: "ok",
      label,
      lines: [`${GREEN}✓${RESET} Nenhuma sessão registrada`],
    };
  }
  const offsets = snap.cursor?.offsets ?? {};
  let unread = 0;
  for (const s of snap.sessions) {
    const off = offsets[s.name] ?? 0;
    unread += Math.max(0, s.size - off);
  }
  if (unread === 0) {
    return {
      severity: "ok",
      label,
      lines: [`${GREEN}✓${RESET} Cursor cobriu todas as sessões`],
    };
  }
  return {
    severity: "warn",
    label,
    lines: [`${YELLOW}⚠${RESET} ${formatBytes(unread)} (${unread} bytes) pendentes no JSONL após o cursor`],
    hint: "Checar reader.cursor / db.write — engine pode ter parado de processar",
  };
}

// ── autostart probe (LaunchAgent on macOS / systemd user on Linux) ──────────

function parseLaunchctlList(stdout: string): { pid?: number } {
  // launchctl list <label> emite um plist-like:
  //   { "PID" = 12345; "LastExitStatus" = 0; ... }
  // Quando carregado sem PID → "PID" não aparece.
  const m = stdout.match(/"PID"\s*=\s*(\d+)\s*;/);
  if (!m) return {};
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) ? { pid: n } : {};
}

function evaluateSystemdState(
  isEnabledStdout: string,
  isActiveStdout: string,
): { enabled: boolean; active: boolean } {
  const e = isEnabledStdout.trim();
  const a = isActiveStdout.trim();
  // "static" = sempre disponível (não pode ser desativado) — equivale a enabled.
  const enabled = e === "enabled" || e === "static";
  const active = a === "active";
  return { enabled, active };
}

function checkAutostartMacOS(): CheckResult {
  const label = `Autostart (LaunchAgent ${LAUNCH_AGENT_LABEL})`;
  const plist = launchAgentPlistPath();
  if (!existsSync(plist)) {
    return {
      severity: "warn",
      label,
      lines: [
        `${YELLOW}⚠${RESET} LaunchAgent ${LAUNCH_AGENT_LABEL} ausente em ${plist.replace(homedir(), "~")}`,
      ],
      hint: "Execute: beheld init",
    };
  }
  const res = spawnSync("launchctl", ["list", LAUNCH_AGENT_LABEL], { stdio: "pipe" });
  if (res.status !== 0) {
    return {
      severity: "warn",
      label,
      lines: [`${YELLOW}⚠${RESET} LaunchAgent ${LAUNCH_AGENT_LABEL} instalado mas não carregado`],
      hint: `launchctl bootstrap gui/$UID ${plist.replace(homedir(), "~")}`,
    };
  }
  const parsed = parseLaunchctlList(res.stdout?.toString() ?? "");
  if (parsed.pid === undefined) {
    return {
      severity: "warn",
      label,
      lines: [`${YELLOW}⚠${RESET} LaunchAgent ${LAUNCH_AGENT_LABEL} carregado mas inativo`],
      hint: `launchctl kickstart gui/$UID/${LAUNCH_AGENT_LABEL}`,
    };
  }
  return {
    severity: "ok",
    label,
    lines: [`${GREEN}✓${RESET} LaunchAgent ${LAUNCH_AGENT_LABEL} ativo (PID ${parsed.pid})`],
  };
}

function checkAutostartLinux(): CheckResult {
  const label = `Autostart (systemd ${SYSTEMD_SERVICE_NAME})`;
  const unit = systemdUnitPath();
  if (!existsSync(unit)) {
    return {
      severity: "warn",
      label,
      lines: [`${YELLOW}⚠${RESET} Serviço ${SYSTEMD_SERVICE_NAME} não instalado`],
      hint: "Execute: beheld init",
    };
  }
  const enabledRes = spawnSync("systemctl", ["--user", "is-enabled", SYSTEMD_SERVICE_NAME], {
    stdio: "pipe",
  });
  const activeRes = spawnSync("systemctl", ["--user", "is-active", SYSTEMD_SERVICE_NAME], {
    stdio: "pipe",
  });
  const enabledOut = enabledRes.stdout?.toString() ?? "";
  const activeOut = activeRes.stdout?.toString() ?? "";
  const state = evaluateSystemdState(enabledOut, activeOut);

  if (state.enabled && state.active) {
    return {
      severity: "ok",
      label,
      lines: [`${GREEN}✓${RESET} Serviço ${SYSTEMD_SERVICE_NAME} enabled e active`],
    };
  }
  if (state.enabled && !state.active) {
    return {
      severity: "warn",
      label,
      lines: [
        `${YELLOW}⚠${RESET} Serviço ${SYSTEMD_SERVICE_NAME} enabled mas ${activeOut.trim() || "?"}`,
      ],
      hint: `systemctl --user start ${SYSTEMD_SERVICE_NAME}`,
    };
  }
  if (!state.enabled && state.active) {
    return {
      severity: "warn",
      label,
      lines: [
        `${YELLOW}⚠${RESET} Serviço ${SYSTEMD_SERVICE_NAME} ativo agora mas não reinicia após reboot`,
      ],
      hint: `systemctl --user enable ${SYSTEMD_SERVICE_NAME}`,
    };
  }
  return {
    severity: "warn",
    label,
    lines: [`${YELLOW}⚠${RESET} Serviço ${SYSTEMD_SERVICE_NAME} não habilitado`],
    hint: `systemctl --user enable --now ${SYSTEMD_SERVICE_NAME}`,
  };
}

function checkAutostart(): CheckResult | null {
  if (platform() === "darwin") return checkAutostartMacOS();
  if (platform() === "linux") return checkAutostartLinux();
  return null;
}

// ── log.signatures probe ────────────────────────────────────────────────────

interface LogSignature {
  pattern: string;
  hint: string;
}

const LOG_SIGNATURES: LogSignature[] = [
  {
    pattern: "Errno 48",
    hint: "Socket preso — provável engine zumbi; rodar doctor periodicamente",
  },
  {
    pattern: "Address already in use",
    hint: "Mesma raiz que Errno 48 (variação por libc/distro)",
  },
  {
    pattern: "engine trigger timeout",
    hint: "Engine não responde aos triggers do daemon",
  },
  {
    pattern: "Engine falhou ao iniciar",
    hint: "Auto-restart bateu na parede — checar busy-loop / PID stale",
  },
  {
    pattern: "MCP server falhou ao iniciar",
    hint: "Auto-restart do MCP bateu na parede — checar porta 7337 ocupada",
  },
  {
    pattern: "Traceback (most recent call last)",
    hint: "Exceção não tratada — checar ~/.beheld/daemon.log",
  },
];

const LOG_TAIL_BYTES = 64 * 1024;

function daemonLogPath(): string {
  return join(beheldDir(), "daemon.log");
}

function readLogTail(path: string, maxBytes: number): string | null {
  let st;
  try {
    st = statSync(path);
  } catch {
    return null;
  }
  if (st.size <= maxBytes) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  }
  // Arquivo maior que maxBytes → ler só o sufixo.
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(maxBytes);
    readSync(fd, buf, 0, maxBytes, st.size - maxBytes);
    return buf.toString("utf8");
  } catch {
    return null;
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
  }
}

function findSignaturesInLog(
  text: string,
  signatures: LogSignature[],
): Array<{ pattern: string; count: number; hint: string }> {
  const hits: Array<{ pattern: string; count: number; hint: string }> = [];
  for (const sig of signatures) {
    if (!sig.pattern) continue;
    let count = 0;
    let idx = 0;
    while (true) {
      const found = text.indexOf(sig.pattern, idx);
      if (found < 0) break;
      count++;
      idx = found + sig.pattern.length;
    }
    if (count > 0) hits.push({ pattern: sig.pattern, count, hint: sig.hint });
  }
  return hits;
}

function checkLogSignatures(): CheckResult {
  const label = "Assinaturas no daemon.log";
  const path = daemonLogPath();
  if (!existsSync(path)) {
    return {
      severity: "ok",
      label,
      lines: [`${DIM}~/.beheld/daemon.log ainda não criado${RESET}`],
    };
  }
  const tail = readLogTail(path, LOG_TAIL_BYTES);
  if (tail === null) {
    return {
      severity: "warn",
      label,
      lines: [`${YELLOW}⚠${RESET} Não foi possível ler ~/.beheld/daemon.log`],
    };
  }
  const hits = findSignaturesInLog(tail, LOG_SIGNATURES);
  if (hits.length === 0) {
    return {
      severity: "ok",
      label,
      lines: [`${GREEN}✓${RESET} Nenhuma assinatura conhecida nas últimas 64 KB do log`],
    };
  }
  const summary = hits.map((h) => `"${h.pattern}" (×${h.count})`).join(", ");
  return {
    severity: "warn",
    label,
    lines: [`${YELLOW}⚠${RESET} Assinaturas no daemon.log: ${summary}`],
    hint: hits[0]!.hint,
  };
}

function computeExitCode(all: CheckResult[]): 0 | 1 | 2 {
  if (all.some((r) => r.severity === "crit")) return 2;
  if (all.some((r) => r.severity === "warn")) return 1;
  return 0;
}

/**
 * Decisão pura: as 4 condições coincidentes do busy-loop confirmado.
 * Devolve true sse:
 *   1. há listener na porta do engine (runtimePid !== undefined);
 *   2. /health falhou (severity === "crit");
 *   3. ps confirma STAT contém R e CPU > 50%;
 *   4. cursor existe, há sessões, e o lag (newest - cursor.mtime) é
 *      ESTRITAMENTE maior que o threshold de staleness do D1.a.
 *
 * Fora disso → false. O doctor segue só apontando, sem agir.
 */
function isInequivocalBusyLoop(
  engine: EngineCheck,
  snap: ProcessingSnapshot,
  cursorStalenessThresholdMs: number,
): boolean {
  if (engine.runtimePid === undefined) return false;
  if (engine.severity !== "crit") return false;
  const proc = engine.proc;
  if (proc === undefined) return false;
  if (!proc.stat.includes("R")) return false;
  if (proc.cpuPct <= 50) return false;
  if (snap.cursor === null) return false;
  if (snap.sessions.length === 0) return false;
  const newest = Math.max(...snap.sessions.map((s) => s.mtime));
  const lagMs = newest - snap.cursor.mtime;
  return lagMs > cursorStalenessThresholdMs;
}

interface JsonlSample {
  filesScanned: number;
  events: number;
  sessions: Set<string>;
  corruptedLines: number;
}

function scanTodayJsonl(): JsonlSample | null {
  const dir = sessionsDir();
  if (!existsSync(dir)) return null;
  const today = localDateString();
  const prefixes = new Set([shiftDate(today, -1), today, shiftDate(today, +1)]);
  const sample: JsonlSample = {
    filesScanned: 0,
    events: 0,
    sessions: new Set(),
    corruptedLines: 0,
  };
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return null;
  }
  for (const f of files) {
    if (!f.endsWith(".jsonl")) continue;
    if (!prefixes.has(f.slice(0, 10))) continue;
    sample.filesScanned++;
    let content: string;
    try {
      content = readFileSync(join(dir, f), "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const e = JSON.parse(trimmed) as { timestamp?: unknown; session_id?: unknown };
        if (typeof e.timestamp !== "string" || typeof e.session_id !== "string") continue;
        const d = new Date(e.timestamp);
        const local = localDateString(d);
        if (local !== today) continue;
        sample.events++;
        sample.sessions.add(e.session_id);
      } catch {
        sample.corruptedLines++;
      }
    }
  }
  return sample;
}

async function checkJsonlToday(): Promise<CheckResult> {
  const sample = scanTodayJsonl();
  if (sample === null) {
    return {
      severity: "warn",
      label: "JSONL do dia",
      lines: [`${YELLOW}⚠${RESET} ~/.beheld/sessions/ não existe`],
      hint: "Execute: beheld init",
    };
  }
  const today = localDateString();
  const lines: string[] = [
    `${GREEN}✓${RESET} ${sample.events} eventos hoje em ${sessionsDir().replace(homedir(), "~")}/${today}_*.jsonl`,
  ];
  let severity: Severity = "ok";
  let hint: string | undefined;
  if (sample.corruptedLines > 0) {
    lines.push(`${YELLOW}⚠${RESET} ${sample.corruptedLines} linha(s) corrompida(s) ignorada(s)`);
    severity = "warn";
  }

  const status = await mcpStatus();
  if (status) {
    const mcpEvents = status.events_today ?? 0;
    if (mcpEvents === sample.events) {
      lines.push(`${GREEN}✓${RESET} Contador in-memory bate com disco (${mcpEvents})`);
    } else if (Math.abs(mcpEvents - sample.events) <= 5) {
      // Small diff acceptable: events can land between scan and /status call
      lines.push(`${GREEN}✓${RESET} Contador in-memory ≈ disco (${mcpEvents} vs ${sample.events})`);
    } else {
      lines.push(`${YELLOW}⚠${RESET} Contador in-memory (${mcpEvents}) divergente do disco (${sample.events})`);
      severity = "warn";
      hint = "Correção sugerida: beheld restart";
    }
  }

  return { severity, label: "JSONL do dia", lines, hint };
}

// ── orchestration ─────────────────────────────────────────────────────────────

function emoji(severity: Severity): string {
  if (severity === "ok") return `${GREEN}✓${RESET}`;
  if (severity === "warn") return `${YELLOW}⚠${RESET}`;
  return `${RED}✗${RESET}`;
}

function printResult(r: CheckResult): void {
  console.log(`${BOLD}🔍 Verificando ${r.label}…${RESET}`);
  for (const line of r.lines) {
    console.log(`   ${line}`);
  }
  if (r.hint) {
    console.log(`      ${DIM}${r.hint}${RESET}`);
  }
  console.log("");
}

// ── heal report rendering ────────────────────────────────────────────────────

function humanStepLabel(step: HealStep): string {
  switch (step.name) {
    case "prepare-diagnostics-dir":
      return step.ok ? "diretório de diagnóstico preparado" : `diretório de diagnóstico: ${step.detail ?? "falhou"}`;
    case "capture-stack":
      return step.ok
        ? `stack capturado em ${(step.detail ?? "").replace(homedir(), "~")}`
        : `stack não capturado (${step.detail ?? "indisponível"})`;
    case "kill-engine":
      return step.ok ? `engine matado (${step.detail ?? ""})` : `kill falhou (${step.detail ?? ""})`;
    case "wait-socket-release":
      return step.ok ? `socket :7338 ${step.detail ?? "liberado"}` : `socket :7338 ${step.detail ?? "não liberou"}`;
    case "wal-checkpoint":
      return step.ok ? "WAL checkpoint executado" : `WAL checkpoint falhou: ${step.detail ?? "?"}`;
    case "clear-stale-engine-pid":
      return step.ok ? "daemon.pid limpo (engine removido)" : "daemon.pid não pôde ser limpo";
    case "restart-daemon":
      return step.ok ? "daemon religado" : `daemon não religou: ${step.detail ?? "?"}`;
    default:
      return step.name + (step.detail ? `: ${step.detail}` : "");
  }
}

function firstFailedStepHint(report: HealReport): string {
  const failed = report.steps.find((s) => !s.ok);
  if (!failed) return "estado inconsistente — investigar ~/.beheld/daemon.log";
  switch (failed.name) {
    case "kill-engine":
      return `executar manualmente: kill -9 ${report.evidence.runtimePid}`;
    case "wait-socket-release":
      return `socket :7338 ainda preso — verificar lsof -iTCP:7338`;
    case "restart-daemon":
      return "executar manualmente: beheld start";
    default:
      return `passo ${failed.name} falhou — checar ~/.beheld/daemon.log`;
  }
}

function printHealReport(report: HealReport): void {
  console.log(`${BOLD}🔧 Auto-heal disparado: engine em busy-loop confirmado${RESET}`);
  console.log("   Evidências:");
  console.log(`     • PID ${report.evidence.runtimePid} LISTEN em :${enginePort()}`);
  console.log(`     • /health timeout`);
  console.log(
    `     • STAT=${report.evidence.stat}, CPU=${report.evidence.cpuPct}%, etime=${report.evidence.etime}`,
  );
  console.log(`     • Cursor parado há ${formatDuration(report.evidence.cursorLagMs)} vs sessão mais nova`);
  console.log("   Passos:");
  for (const step of report.steps) {
    const mark = step.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`     ${mark} ${humanStepLabel(step)}`);
  }
  if (report.succeeded) {
    console.log(`   ${DIM}Rode \`beheld doctor\` para confirmar o estado pós-heal.${RESET}`);
  } else {
    console.log(`   ${RED}Heal falhou${RESET} — escalar manualmente: ${DIM}${firstFailedStepHint(report)}${RESET}`);
  }
  console.log("");
}

export async function doctorCommand(): Promise<void> {
  console.log(brand("checando minha saúde"));
  const mcp = await checkMcp();
  printResult(mcp);

  const engine = await checkEngine();
  printResult(engine);

  const pid = checkPidFile(engine.runtimePid);
  printResult(pid);

  const codesign = checkCodesignMacOS();
  if (codesign) printResult(codesign);

  const integration = await checkClaudeIntegration();
  printResult(integration);

  // Processing probes — leem do disco, independem do engine vivo.
  const snap = await takeProcessingSnapshot();
  const now = Date.now();
  const cursor = evaluateCursorStaleness(snap, now, CURSOR_STALENESS_THRESHOLD_MS);
  printResult(cursor);
  const dbWrite = evaluateDbWrite(snap, now, DB_WRITE_STALENESS_THRESHOLD_MS);
  printResult(dbWrite);
  const dbWal = evaluateWal(snap, WAL_WARN_THRESHOLD_BYTES);
  printResult(dbWal);
  const orphans = evaluateBacklog(snap);
  printResult(orphans);

  // Infra probes — autostart (platform-specific) e assinaturas conhecidas no log.
  const autostart = checkAutostart();
  if (autostart) printResult(autostart);
  const logSigs = checkLogSignatures();
  printResult(logSigs);

  const jsonl = await checkJsonlToday();
  printResult(jsonl);

  // ── summary ────────────────────────────────────────────────────────────────
  const all: CheckResult[] = [
    mcp,
    engine,
    pid,
    ...(codesign ? [codesign] : []),
    integration,
    cursor,
    dbWrite,
    dbWal,
    orphans,
    ...(autostart ? [autostart] : []),
    logSigs,
    jsonl,
  ];
  const crits = all.filter((c) => c.severity === "crit");
  const warns = all.filter((c) => c.severity === "warn");

  if (crits.length > 0) {
    console.log(`Resultado: ${RED}✗ Produto degradado${RESET} — ${crits.length} problema(s) crítico(s), ${warns.length} aviso(s)`);
    let n = 1;
    for (const c of crits) {
      console.log("");
      console.log(`${BOLD}${n}. ${c.label}${RESET}`);
      for (const line of c.lines) console.log(`   ${line}`);
      if (c.hint) console.log(`   ${DIM}${c.hint}${RESET}`);
      n++;
    }
    console.log("");

    // D2 — auto-heal apenas quando as 4 condições do busy-loop coincidem.
    // Exit code reflete o snapshot pré-heal (computeExitCode(all)) independente
    // do sucesso do heal; usuário roda doctor novamente para verificar.
    if (isInequivocalBusyLoop(engine, snap, CURSOR_STALENESS_THRESHOLD_MS)) {
      const report = await selfHealEngine(engine, snap);
      printHealReport(report);
    }

    process.exit(computeExitCode(all));
  }

  if (warns.length > 0) {
    console.log(`Resultado: ${YELLOW}⚠${RESET} ${warns.length} problema(s) menor(es) encontrado(s)`);
    const firstHint = warns.find((w) => w.hint)?.hint;
    if (firstHint) console.log(`   ${DIM}${firstHint}${RESET}`);
    console.log("");
    process.exit(computeExitCode(all));
  }

  console.log(`Resultado: ${GREEN}✓ Tudo verde${RESET}`);
  console.log("");
}

// ── exports for testing ──────────────────────────────────────────────────────

export const _internal = {
  scanTodayJsonl,
  checkPidFile,
  checkCodesignMacOS,
  parseProcOutput,
  checkEngine,
  takeProcessingSnapshot,
  evaluateCursorStaleness,
  evaluateDbWrite,
  evaluateWal,
  evaluateBacklog,
  formatBytes,
  formatDuration,
  computeExitCode,
  parseLaunchctlList,
  evaluateSystemdState,
  checkAutostart,
  findSignaturesInLog,
  readLogTail,
  checkLogSignatures,
  LOG_SIGNATURES,
  isInequivocalBusyLoop,
  printHealReport,
  humanStepLabel,
  firstFailedStepHint,
};
