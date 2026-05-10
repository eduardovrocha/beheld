import { createWriteStream, existsSync } from "node:fs";
import { chmod, rename, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import * as daemonManager from "../daemon-manager";

const VERSION = "0.1.0";
const API_BASE = "https://devprofile.app/api";
const RELEASES_BASE = "https://github.com/ioit-solutions/devprofile/releases/download";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function platform(): string {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  }
  return "linux-x64";
}

async function askConfirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase() === "s");
    });
  });
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/version`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const body = res.body;
  if (!body) throw new Error("Empty response body");

  const tmp = `${dest}.tmp`;
  const ws = createWriteStream(tmp);
  const reader = body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await new Promise<void>((resolve, reject) => {
        ws.write(value, (err) => (err ? reject(err) : resolve()));
      });
    }
  } finally {
    ws.end();
    await new Promise<void>((resolve) => ws.on("finish", resolve));
  }

  await rename(tmp, dest);
}

async function verifySha256(file: string, expected: string): Promise<boolean> {
  const proc = Bun.spawn(["shasum", "-a", "256", file], { stdout: "pipe" });
  const output = await new Response(proc.stdout).text();
  const actual = output.split(" ")[0];
  return actual === expected;
}

export async function updateCommand(): Promise<void> {
  process.stdout.write("  Verificando versão disponível…");
  const latest = await fetchLatestVersion();
  process.stdout.write("\r                                    \r");

  if (!latest) {
    console.log(`${DIM}Não foi possível verificar a versão disponível.${RESET}`);
    return;
  }

  if (latest === VERSION) {
    console.log(`${GREEN}✓${RESET}  DevProfile ${BOLD}${VERSION}${RESET} já é a versão mais recente.`);
    return;
  }

  console.log(`  DevProfile ${BOLD}${latest}${RESET} disponível  ${DIM}(atual: ${VERSION})${RESET}`);
  const confirmed = await askConfirm("  Atualizar agora? [S/n] ");
  if (!confirmed) {
    console.log("Abortado.");
    return;
  }

  const plat = platform();
  const binaryName = `devprofile-${plat}`;
  const binaryUrl = `${RELEASES_BASE}/v${latest}/${binaryName}`;
  const checksumUrl = `${RELEASES_BASE}/v${latest}/${binaryName}.sha256`;
  const currentBinary = process.execPath;
  const tmpDest = `${currentBinary}.new`;

  process.stdout.write(`  Baixando ${binaryName}…`);
  try {
    await downloadFile(binaryUrl, tmpDest);
    process.stdout.write(`\r  ${GREEN}✓${RESET}  Baixando ${binaryName}\n`);
  } catch (err) {
    process.stdout.write(`\r  ${RED}✗${RESET}  Erro ao baixar: ${err instanceof Error ? err.message : String(err)}\n`);
    if (existsSync(tmpDest)) await unlink(tmpDest).catch(() => {});
    process.exit(1);
  }

  process.stdout.write("  Verificando checksum…");
  try {
    const checksumRes = await fetch(checksumUrl, { signal: AbortSignal.timeout(5000) });
    if (checksumRes.ok) {
      const expected = (await checksumRes.text()).trim().split(/\s+/)[0];
      const ok = await verifySha256(tmpDest, expected);
      if (!ok) {
        process.stdout.write(`\r  ${RED}✗${RESET}  Checksum inválido — abortando\n`);
        await unlink(tmpDest).catch(() => {});
        process.exit(1);
      }
    }
    process.stdout.write(`\r  ${GREEN}✓${RESET}  Verificando checksum\n`);
  } catch {
    process.stdout.write(`\r  ${DIM}~${RESET}  Checksum pulado\n`);
  }

  process.stdout.write("  Substituindo binário…");
  try {
    await chmod(tmpDest, 0o755);
    await rename(tmpDest, currentBinary);
    process.stdout.write(`\r  ${GREEN}✓${RESET}  Substituindo binário\n`);
  } catch (err) {
    process.stdout.write(`\r  ${RED}✗${RESET}  Erro: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  process.stdout.write("  Reiniciando daemon…");
  try {
    const running = await daemonManager.isRunning();
    if (running) {
      await daemonManager.stop();
      await daemonManager.start();
    }
    process.stdout.write(`\r  ${GREEN}✓${RESET}  Reiniciando daemon\n`);
  } catch {
    process.stdout.write(`\r  ${DIM}~${RESET}  Daemon não estava em execução\n`);
  }

  console.log(`\n  ${GREEN}Atualizado para ${latest}${RESET}`);
}
