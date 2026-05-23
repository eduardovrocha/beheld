import engineBinary from "../assets/beheld-engine" with { type: "file" };
import { existsSync, writeFileSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { homedir, platform as osPlatform } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync as nodeSpawnSync } from "node:child_process";

type SpawnFn = (cmd: string, args: string[], opts: object) => { status: number | null; stderr?: Buffer };

export function isCommandAvailable(cmd: string, spawnFn: SpawnFn = nodeSpawnSync): boolean {
  const result = spawnFn("which", [cmd], { stdio: "pipe" });
  return result.status === 0;
}

export function codesignEngine(binaryPath: string, spawnFn: SpawnFn = nodeSpawnSync): void {
  if (isCommandAvailable("xattr", spawnFn)) {
    spawnFn("xattr", ["-d", "com.apple.quarantine", binaryPath], { stdio: "ignore" });
  }

  if (!isCommandAvailable("codesign", spawnFn)) {
    console.debug("[engine-extractor] codesign not available — skipping");
    return;
  }

  const result = spawnFn(
    "codesign",
    ["--sign", "-", "--force", "--preserve-metadata=entitlements", binaryPath],
    { stdio: "pipe" },
  );

  if (result.status !== 0) {
    console.debug(
      "[engine-extractor] codesign failed:",
      result.stderr?.toString().trim(),
    );
  }
}

export async function ensureEngine(
  _platform = osPlatform(),
): Promise<string> {
  const dest = join(homedir(), ".beheld", "bin", "engine");
  await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
  if (!existsSync(dest)) {
    // Bun bundles assets at a virtual /$bunfs/ path — must read via Bun.file()
    const content = await Bun.file(engineBinary).arrayBuffer();
    writeFileSync(dest, Buffer.from(content));
    await chmod(dest, 0o755);
  }
  if (_platform === "darwin") {
    codesignEngine(dest);
  }
  return dest;
}
