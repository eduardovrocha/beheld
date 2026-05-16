import * as daemonManager from "../daemon-manager";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

export async function startCommand(): Promise<void> {
  // Pre-check so we only show the "this might take a while" hint when we're
  // actually about to wait. Engine cold start (PyInstaller bundle extraction
  // on first run) is the slow path — up to ~30s on macOS.
  const [mcpUp, engineUp] = await Promise.all([
    daemonManager.isMcpRunning(),
    daemonManager.isEngineRunning(),
  ]);

  if (!engineUp) {
    console.log(`\n  ${DIM}Iniciando daemons (engine pode levar 15-30s no primeiro start)…${RESET}`);
  }

  const result = await daemonManager.start();

  if (result.alreadyRunning) {
    console.log(`\n  ${GREEN}●${RESET}  DevProfile já está rodando.\n`);
    console.log(`  ${BOLD}MCP server${RESET}      ${GREEN}●${RESET}  porta 7337`);
    console.log(`  ${BOLD}Scoring engine${RESET}  ${GREEN}●${RESET}  porta 7338`);
    console.log("");
    return;
  }

  if (result.mcp && result.engine) {
    console.log(`\n  ${GREEN}✓${RESET}  MCP server iniciado    ${DIM}porta 7337${RESET}`);
    console.log(`  ${GREEN}✓${RESET}  Engine iniciado        ${DIM}porta 7338${RESET}\n`);
  } else {
    if (!result.mcp)    console.log(`  ${RED}✗${RESET}  MCP server falhou ao iniciar`);
    if (!result.engine) console.log(`  ${RED}✗${RESET}  Engine falhou ao iniciar`);
    process.exit(1);
  }
}
