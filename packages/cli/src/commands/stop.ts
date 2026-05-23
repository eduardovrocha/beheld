import * as daemonManager from "../daemon-manager";
import { ok, meta, brand } from "../ui/styles";

export async function stopCommand(): Promise<void> {
  const running = await daemonManager.isRunning();
  if (!running) {
    console.log(brand("nada pra parar"));
    console.log(`  ${meta("Beheld não está em execução.")}`);
    return;
  }

  console.log(brand("encerrando o expediente"));
  process.stdout.write("  Parando Beheld…");
  await daemonManager.stop();
  process.stdout.write(`\r${ok("Beheld parado")}\n`);
}
