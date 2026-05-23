import { mcpHealth, mcpStatus, mcpSessionCurrent } from "../client/mcp-client";
import { engineHealth } from "../client/engine-client";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GREEN, RED, DIM, BOLD, RESET, brand } from "../ui/styles";

interface DaemonPids {
  mcp?: number;
  engine?: number;
}

function readPids(): DaemonPids {
  const f = join(
    process.env.BEHELD_DATA_DIR
      ? join(process.env.BEHELD_DATA_DIR, ".beheld")
      : join(homedir(), ".beheld"),
    "daemon.pid",
  );
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return {};
  }
}

function dot(ok: boolean): string {
  return ok ? `${GREEN}●${RESET}` : `${RED}○${RESET}`;
}

export async function statusCommand(): Promise<void> {
  const [mcpOk, engineOk, status, session] = await Promise.all([
    mcpHealth().then((r) => r?.ok === true),
    engineHealth().then((r) => r?.ok === true),
    mcpStatus(),
    mcpSessionCurrent(),
  ]);

  const pids = readPids();

  console.log(brand("observando seu dia"));
  const mcpPid = pids.mcp ? `  ${DIM}pid ${pids.mcp}, port 7337${RESET}` : `  ${DIM}port 7337${RESET}`;
  const enginePid = pids.engine
    ? `  ${DIM}pid ${pids.engine}, port 7338${RESET}`
    : `  ${DIM}port 7338${RESET}`;

  console.log(
    `  ${BOLD}MCP server${RESET}      ${dot(mcpOk)} ${mcpOk ? `${GREEN}running${RESET}` : `${RED}stopped${RESET}`}${mcpPid}`,
  );
  console.log(
    `  ${BOLD}Scoring engine${RESET}  ${dot(engineOk)} ${engineOk ? `${GREEN}running${RESET}` : `${RED}stopped${RESET}`}${enginePid}`,
  );
  console.log("");

  if (session?.active) {
    const dur = session.duration_minutes ?? 0;
    const evts = session.event_count ?? 0;
    const tools = session.tools_used?.join(", ") ?? "";
    console.log(`  ${BOLD}Sessão atual${RESET}    ${dur} min · ${evts} eventos${tools ? ` · ${tools}` : ""}`);
  } else {
    console.log(`  ${BOLD}Sessão atual${RESET}    ${DIM}nenhuma sessão ativa${RESET}`);
  }

  if (status) {
    const eventsToday = status.events_today ?? 0;
    const sessionsToday = status.sessions_today ?? 0;
    console.log(
      `  ${BOLD}Coleta hoje${RESET}     ${sessionsToday} sessões · ${eventsToday} eventos`,
    );
  }

  console.log("");
}
