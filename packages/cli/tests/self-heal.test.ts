import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { selfHealCommand } from "../src/commands/self-heal";

// `selfHealCommand` exercises `selfHealClaudeIntegration(base = homedir())`.
// We point it at a temp HOME via env var so we don't touch the real machine.

describe("selfHealCommand", () => {
  let base: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    base = join(tmpdir(), `beheld-selfheal-${randomUUID()}`);
    mkdirSync(base, { recursive: true });
    savedHome = process.env.HOME;
    process.env.HOME = base;
  });

  afterEach(() => {
    process.env.HOME = savedHome ?? "";
    rmSync(base, { recursive: true, force: true });
  });

  function writeOptInConfig(): void {
    mkdirSync(join(base, ".beheld"), { recursive: true });
    writeFileSync(
      join(base, ".beheld", "config.json"),
      JSON.stringify({ environments: { claudeCode: true, continueDev: false } }),
    );
  }

  test("no-op (silent, exit 0) when user did not opt into Claude Code", async () => {
    await expect(selfHealCommand()).resolves.toBeUndefined();
    expect(existsSync(join(base, ".claude", "commands", "beheld.md"))).toBe(false);
  });

  test("restores slash command file when opted in and missing", async () => {
    writeOptInConfig();
    await selfHealCommand({ base });
    const file = join(base, ".claude", "commands", "beheld.md");
    expect(existsSync(file)).toBe(true);
    // Pin dinâmico: usa SLASH_COMMAND_VERSION em vez de literal, evita
    // ter que atualizar este teste a cada bump da versão do slash command.
    const { SLASH_COMMAND_VERSION } = await import("../src/config/hooks");
    expect(readFileSync(file, "utf8")).toContain(`version: "${SLASH_COMMAND_VERSION}"`);
  });

  test("restores ~/.claude.json MCP entry when opted in and missing", async () => {
    writeOptInConfig();
    await selfHealCommand({ base });
    const cfg = JSON.parse(readFileSync(join(base, ".claude.json"), "utf8"));
    expect(cfg.mcpServers?.beheld?.args).toEqual(["server", "--stdio"]);
  });

  test("is idempotent — second call does nothing observable", async () => {
    writeOptInConfig();
    await selfHealCommand({ base });
    const firstMtime = readFileSync(
      join(base, ".claude", "commands", "beheld.md"),
      "utf8",
    );
    await selfHealCommand({ base });
    const secondMtime = readFileSync(
      join(base, ".claude", "commands", "beheld.md"),
      "utf8",
    );
    expect(secondMtime).toBe(firstMtime);
  });

  test("never throws — heal failures must stay silent", async () => {
    // Point base at a file (not a directory) so any internal write throws.
    const sentinelFile = join(tmpdir(), `beheld-cantheal-${randomUUID()}.txt`);
    writeFileSync(sentinelFile, "not a dir");
    await expect(selfHealCommand({ base: sentinelFile })).resolves.toBeUndefined();
    rmSync(sentinelFile, { force: true });
  });
});
