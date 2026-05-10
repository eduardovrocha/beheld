import * as daemonManager from "../daemon-manager";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

export async function startCommand(): Promise<void> {
  const already = await daemonManager.isRunning();
  if (already) {
    console.log(`${GREEN}●${RESET}  DevProfile já está em execução.`);
    return;
  }

  process.stdout.write("  Iniciando DevProfile…");
  try {
    await daemonManager.start();
    process.stdout.write(`\r  ${GREEN}✓${RESET}  DevProfile iniciado\n`);
    console.log(`\n  ${BOLD}MCP server${RESET}      ${GREEN}running${RESET}  ${DIM}localhost:7337${RESET}`);
    console.log(`  ${BOLD}Scoring engine${RESET}  ${GREEN}running${RESET}  ${DIM}localhost:7338${RESET}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`\r  ${RED}✗${RESET}  Falha ao iniciar: ${msg}\n`);
    process.exit(1);
  }
}
