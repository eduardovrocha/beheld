import * as daemonManager from "../daemon-manager";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

export async function startCommand(): Promise<void> {
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
