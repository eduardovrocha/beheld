import * as daemonManager from "../daemon-manager";
import { ok, fail, meta, bold, brand, GREEN, RESET } from "../ui/styles";

export async function startCommand(): Promise<void> {
  // Pre-check so we only show the "this might take a while" hint when we're
  // actually about to wait. Engine cold start (PyInstaller bundle extraction
  // on first run) is the slow path — up to ~30s on macOS.
  const [mcpUp, engineUp] = await Promise.all([
    daemonManager.isMcpRunning(),
    daemonManager.isEngineRunning(),
  ]);

  if (mcpUp && engineUp) {
    console.log(brand("já estou no ar"));
    console.log(`  ${bold("MCP server")}      ${GREEN}●${RESET}  porta 7337`);
    console.log(`  ${bold("Scoring engine")}  ${GREEN}●${RESET}  porta 7338`);
    console.log("");
    // No need to call daemonManager.start() — return early.
    return;
  }

  console.log(brand("subindo os daemons"));
  if (!engineUp) {
    console.log(`  ${meta("Engine pode levar 15-30s no primeiro start…")}`);
  }

  const result = await daemonManager.start();

  if (result.mcp && result.engine) {
    console.log(`\n${ok(`MCP server iniciado    ${meta("porta 7337")}`)}`);
    console.log(`${ok(`Engine iniciado        ${meta("porta 7338")}`)}\n`);
  } else {
    if (!result.mcp)    console.log(fail("MCP server falhou ao iniciar"));
    if (!result.engine) console.log(fail("Engine falhou ao iniciar"));
    process.exit(1);
  }
}
