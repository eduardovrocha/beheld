import * as daemonManager from "../daemon-manager";
import { ok, fail, meta, bold, brand, GREEN, RESET } from "../ui/styles";

export async function restartCommand(): Promise<void> {
  const wasRunning = await daemonManager.isRunning();

  console.log(brand("começando do zero"));

  if (wasRunning) {
    process.stdout.write("  Parando Beheld…");
    // daemonManager.stop() already SIGTERM with 5s wait, then SIGKILL fallback
    await daemonManager.stop();
    process.stdout.write(`\r${ok(`Beheld parado     ${meta("(graceful, fallback kill -9 se necessário)")}`)}\n`);
  } else {
    console.log(`  ${meta("Beheld não estava rodando — pulando stop.")}`);
  }

  const result = await daemonManager.start();

  if (!result.mcp || !result.engine) {
    if (!result.mcp)    console.log(fail("MCP server falhou ao iniciar"));
    if (!result.engine) console.log(fail("Engine falhou ao iniciar"));
    console.log("");
    console.log(`  Diagnóstico: ${bold("beheld doctor")}`);
    process.exit(1);
  }

  // Final health check: start() already polls /health via waitForHealthPort,
  // but a final explicit verification keeps the contract loud.
  const [mcpOk, engineOk] = await Promise.all([
    daemonManager.isMcpRunning(),
    daemonManager.isEngineRunning(),
  ]);

  if (mcpOk && engineOk) {
    console.log(ok(`MCP server respondendo em /health     ${meta("porta 7337")}`));
    console.log(ok(`Engine respondendo em /health         ${meta("porta 7338")}`));
    console.log("");
    console.log(`  ${GREEN}Beheld reiniciado com sucesso.${RESET}`);
    console.log("");
    return;
  }

  if (!mcpOk)    console.log(fail("MCP /health não responde após restart"));
  if (!engineOk) console.log(fail("Engine /health não responde após restart"));
  console.log("");
  console.log(`  Diagnóstico: ${bold("beheld doctor")}`);
  process.exit(1);
}
