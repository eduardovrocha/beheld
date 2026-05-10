import engineBinary from "../assets/devprofile-engine" with { type: "file" };
import { existsSync, writeFileSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export async function ensureEngine(): Promise<string> {
  const dest = join(homedir(), ".devprofile", "bin", "engine");
  await mkdir(dirname(dest), { recursive: true });
  if (!existsSync(dest)) {
    // Bun bundles assets at a virtual /$bunfs/ path — must read via Bun.file()
    const content = await Bun.file(engineBinary).arrayBuffer();
    writeFileSync(dest, Buffer.from(content));
    await chmod(dest, 0o755);
  }
  return dest;
}
