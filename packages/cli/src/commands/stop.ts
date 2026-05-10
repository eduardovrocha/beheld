import * as daemonManager from "../daemon-manager";

const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export async function stopCommand(): Promise<void> {
  const running = await daemonManager.isRunning();
  if (!running) {
    console.log(`${DIM}DevProfile não está em execução.${RESET}`);
    return;
  }

  process.stdout.write("  Parando DevProfile…");
  await daemonManager.stop();
  process.stdout.write(`\r  ${GREEN}✓${RESET}  DevProfile parado\n`);
}
