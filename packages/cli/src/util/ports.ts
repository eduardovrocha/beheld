import { spawnSync } from "node:child_process";

/**
 * Resolve o PID que está em LISTEN numa porta TCP via lsof.
 *
 * Por que esta função é a fonte de verdade do supervisor:
 * o PID file (~/.beheld/daemon.pid) pode estar stale (processo morreu
 * sozinho, PyInstaller bifurcou, etc.). O kernel sabe exatamente quem
 * segura o socket — perguntamos ele.
 *
 * Retorna undefined se ninguém escuta a porta, lsof indisponível, ou
 * o output não casar com um inteiro válido.
 */
export function pidListeningOn(port: number): number | undefined {
  const res = spawnSync("lsof", ["-i", `:${port}`, "-P", "-n", "-sTCP:LISTEN", "-t"], {
    stdio: "pipe",
  });
  if (res.status !== 0) return undefined;
  const out = (res.stdout?.toString() ?? "").trim();
  if (!out) return undefined;
  const n = parseInt(out.split("\n")[0]!, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Verifica se o engine responde /health rapidamente.
 *
 * Usado no pre-bind cleanup do supervisor: precisamos decidir em <2s se
 * o listener atual é saudável (idempotência: não respawnar o que funciona)
 * ou zumbi (kill + religar). O `engineHealth` de engine-client.ts tem
 * timeout de 3s — ok para o doctor, longo demais aqui.
 */
export async function engineHealthy(port: number, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Espera até que `pidListeningOn(port)` volte undefined, com poll de 100ms.
 * Retorna true se o socket foi liberado dentro do timeout, false caso contrário.
 */
export async function waitSocketRelease(port: number, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pidListeningOn(port) === undefined) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return pidListeningOn(port) === undefined;
}
