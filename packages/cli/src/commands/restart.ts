import * as daemonManager from "../daemon-manager";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

export async function restartCommand(): Promise<void> {
  const wasRunning = await daemonManager.isRunning();

  if (wasRunning) {
    process.stdout.write("  Parando DevProfile…");
    // daemonManager.stop() already SIGTERM with 5s wait, then SIGKILL fallback
    await daemonManager.stop();
    process.stdout.write(`\r  ${GREEN}✓${RESET}  DevProfile parado     ${DIM}(graceful, fallback kill -9 se necessário)${RESET}\n`);
  } else {
    console.log(`  ${DIM}DevProfile não estava rodando — pulando stop.${RESET}`);
  }

  const result = await daemonManager.start();

  if (!result.mcp || !result.engine) {
    if (!result.mcp)    console.log(`  ${RED}✗${RESET}  MCP server falhou ao iniciar`);
    if (!result.engine) console.log(`  ${RED}✗${RESET}  Engine falhou ao iniciar`);
    console.log("");
    console.log(`  Diagnóstico: ${BOLD}devprofile doctor${RESET}`);
    process.exit(1);
  }

  // Final health check: start() already polls /health via waitForHealthPort,
  // but a final explicit verification keeps the contract loud.
  const [mcpOk, engineOk] = await Promise.all([
    daemonManager.isMcpRunning(),
    daemonManager.isEngineRunning(),
  ]);

  if (mcpOk && engineOk) {
    console.log(`  ${GREEN}✓${RESET}  MCP server respondendo em /health     ${DIM}porta 7337${RESET}`);
    console.log(`  ${GREEN}✓${RESET}  Engine respondendo em /health         ${DIM}porta 7338${RESET}`);
    console.log("");
    console.log(`  ${GREEN}DevProfile reiniciado com sucesso.${RESET}`);
    console.log("");
    return;
  }

  if (!mcpOk)    console.log(`  ${RED}✗${RESET}  MCP /health não responde após restart`);
  if (!engineOk) console.log(`  ${RED}✗${RESET}  Engine /health não responde após restart`);
  console.log("");
  console.log(`  Diagnóstico: ${BOLD}devprofile doctor${RESET}`);
  process.exit(1);
}
