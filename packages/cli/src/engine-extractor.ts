import engineBinary from "../assets/devprofile-engine" with { type: "file" };
import { existsSync } from "node:fs";
import { copyFile, chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export async function ensureEngine(): Promise<string> {
  const dest = join(homedir(), ".devprofile", "bin", "engine");
  await mkdir(dirname(dest), { recursive: true });
  if (!existsSync(dest)) {
    await copyFile(engineBinary, dest);
    await chmod(dest, 0o755);
  }
  return dest;
}
