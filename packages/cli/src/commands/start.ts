import * as daemonManager from "../daemon-manager";
import { selfHealClaudeIntegration } from "../config/hooks";
import { ok, fail, meta, bold, brand, GREEN, RESET } from "../ui/styles";

// Recreate the `/beheld` slash command and MCP registration if they went
// missing (e.g. wiped by `beheld delete`). Runs on every start — including
// autostart at login — so the command can never silently stay gone.
async function healIntegration(): Promise<void> {
  try {
    const healed = await selfHealClaudeIntegration();
    if (healed.slashCommandRestored || healed.mcpServerRestored) {
      const what = [
        healed.slashCommandRestored ? "comando /beheld" : null,
        healed.mcpServerRestored ? "registro MCP" : null,
      ].filter(Boolean).join(" + ");
      console.log(`  ${meta(`Restaurado: ${what} (reinicie o Claude Code para usar)`)}`);
    }
  } catch {
    /* self-heal is best-effort; never block start */
  }
}

export async function startCommand(): Promise<void> {
  // Sinal explícito do usuário "quero retomar". Se o supervisor estava
  // suspenso por backoff (Camada 2), limpa o flag e loga "auto-restart
  // retomado" — antes de qualquer outra coisa.
  daemonManager.clearBackoffStateOnUserStart();

  await healIntegration();

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
