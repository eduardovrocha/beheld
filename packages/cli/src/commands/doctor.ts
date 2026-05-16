import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { mcpHealth, mcpStatus } from "../client/mcp-client";
import { engineHealth, engineStatus } from "../client/engine-client";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

type Severity = "ok" | "warn" | "crit";

interface CheckResult {
  severity: Severity;
  label: string;
  lines: string[];
  hint?: string;
}

function devprofileDir(): string {
  return process.env.DEVPROFILE_DATA_DIR
    ? join(process.env.DEVPROFILE_DATA_DIR, ".devprofile")
    : join(homedir(), ".devprofile");
}

function pidFilePath(): string {
  return join(devprofileDir(), "daemon.pid");
}

function sessionsDir(): string {
  return join(devprofileDir(), "sessions");
}

function engineBinaryPath(): string {
  return join(devprofileDir(), "bin", "engine");
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
      hint: "Tentar: devprofile start",
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

async function checkEngine(): Promise<CheckResult & { runtimePid?: number }> {
  const port = enginePort();
  const health = await engineHealth();
  if (!health?.ok) {
    return {
      severity: "crit",
      label: `Scoring engine (porta ${port})`,
      lines: [`${RED}✗${RESET} Não responde em /health — está offline`],
      hint: "Tentar: devprofile start",
    };
  }
  const version = (health as { version?: string }).version ?? "?";
  const runtimePid = await fetchEnginePid();
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
  return portFromUrl(process.env.DEVPROFILE_MCP_URL, 7337);
}

function enginePort(): number {
  return portFromUrl(process.env.DEVPROFILE_ENGINE_URL, 7338);
}

function pidListeningOn(port: number): number | undefined {
  // lsof is available on macOS and most Linux distros
  const res = spawnSync("lsof", ["-i", `:${port}`, "-P", "-n", "-sTCP:LISTEN", "-t"], {
    stdio: "pipe",
  });
  if (res.status !== 0) return undefined;
  const out = (res.stdout?.toString() ?? "").trim();
  if (!out) return undefined;
  const n = parseInt(out.split("\n")[0]!, 10);
  return Number.isFinite(n) ? n : undefined;
}

async function fetchEnginePid(): Promise<number | undefined> {
  return pidListeningOn(enginePort());
}

function checkPidFile(runtimeEnginePid: number | undefined): CheckResult {
  const pids = readPidFile();
  if (!pids) {
    return {
      severity: "warn",
      label: "Arquivo de PID",
      lines: [`${YELLOW}⚠${RESET} ~/.devprofile/daemon.pid não existe`],
      hint: "Tentar: devprofile start",
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
    hint = "Correção sugerida: devprofile restart";
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
      hint: "Execute: devprofile start (extrai o binário na primeira vez)",
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
    hint = "Tentar: devprofile start (re-extrai e re-assina)";
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

async function checkOrphans(): Promise<CheckResult> {
  const status = await engineStatus();
  if (!status) {
    return {
      severity: "warn",
      label: "Eventos órfãos",
      lines: [`${YELLOW}⚠${RESET} Engine offline — não foi possível verificar`],
    };
  }
  const unprocessed = status.unprocessed_events;
  if (unprocessed === 0) {
    return {
      severity: "ok",
      label: "Eventos órfãos",
      lines: [`${GREEN}✓${RESET} Nenhum evento pendente de processamento`],
    };
  }
  return {
    severity: "warn",
    label: "Eventos órfãos",
    lines: [`${YELLOW}⚠${RESET} ${unprocessed} bytes de eventos pendentes no JSONL`],
    hint: "Execute: devprofile view --refresh",
  };
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
      lines: [`${YELLOW}⚠${RESET} ~/.devprofile/sessions/ não existe`],
      hint: "Execute: devprofile init",
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
      hint = "Correção sugerida: devprofile restart";
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

export async function doctorCommand(): Promise<void> {
  console.log("");
  const mcp = await checkMcp();
  printResult(mcp);

  const engine = await checkEngine();
  printResult(engine);

  const pid = checkPidFile(engine.runtimePid);
  printResult(pid);

  const codesign = checkCodesignMacOS();
  if (codesign) printResult(codesign);

  const orphans = await checkOrphans();
  printResult(orphans);

  const jsonl = await checkJsonlToday();
  printResult(jsonl);

  // ── summary ────────────────────────────────────────────────────────────────
  const all: CheckResult[] = [mcp, engine, pid, ...(codesign ? [codesign] : []), orphans, jsonl];
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
    process.exit(1);
  }

  if (warns.length > 0) {
    console.log(`Resultado: ${YELLOW}⚠${RESET} ${warns.length} problema(s) menor(es) encontrado(s)`);
    const firstHint = warns.find((w) => w.hint)?.hint;
    if (firstHint) console.log(`   ${DIM}${firstHint}${RESET}`);
    console.log("");
    process.exit(1);
  }

  console.log(`Resultado: ${GREEN}✓ Tudo verde${RESET}`);
  console.log("");
}

// ── exports for testing ──────────────────────────────────────────────────────

export const _internal = {
  scanTodayJsonl,
  checkPidFile,
  checkCodesignMacOS,
};
