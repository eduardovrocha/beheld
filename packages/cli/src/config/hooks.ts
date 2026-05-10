import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// ── path helpers ──────────────────────────────────────────────────────────────

export function claudeSettingsPath(base = homedir()): string {
  return join(base, ".claude", "settings.json");
}

export function continueConfigPath(base = homedir()): string {
  return join(base, ".continue", "config.json");
}

// ── shared helpers ────────────────────────────────────────────────────────────

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function backup(path: string): void {
  if (existsSync(path)) copyFileSync(path, `${path}.devprofile.bak`);
}

function restoreBackup(path: string): void {
  const bak = `${path}.devprofile.bak`;
  if (existsSync(bak)) copyFileSync(bak, path);
}

// ── Claude Code hooks ─────────────────────────────────────────────────────────

const HOOK_MARKER = "7337/hook";

interface HookEntry {
  type: string;
  command: string;
}
interface HookMatcher {
  matcher?: string;
  hooks: HookEntry[];
}

function makeHook(endpoint: string): HookMatcher {
  return {
    matcher: "",
    hooks: [
      {
        type: "command",
        command: `curl -s -X POST http://127.0.0.1:7337/hook/${endpoint} -H 'Content-Type: application/json' -d @-`,
      },
    ],
  };
}

function hasDevprofileHook(matchers: unknown[]): boolean {
  return matchers.some(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      Array.isArray((m as HookMatcher).hooks) &&
      (m as HookMatcher).hooks.some((h) => h.command?.includes(HOOK_MARKER)),
  );
}

export async function installClaudeCodeHooks(
  settingsFile = claudeSettingsPath(),
): Promise<void> {
  backup(settingsFile);
  const cfg = readJson(settingsFile);

  // Hooks
  const hooks = (cfg.hooks ?? {}) as Record<string, unknown[]>;
  const hookMap: Record<string, string> = {
    PreToolUse: "pre-tool",
    PostToolUse: "post-tool",
    Stop: "stop",
  };
  for (const [event, endpoint] of Object.entries(hookMap)) {
    const existing = (hooks[event] ?? []) as unknown[];
    if (!hasDevprofileHook(existing)) {
      hooks[event] = [...existing, makeHook(endpoint)];
    }
  }
  cfg.hooks = hooks;

  // MCP server registration for /devprofile slash command
  const mcpServers = (cfg.mcpServers ?? {}) as Record<string, unknown>;
  if (!mcpServers["devprofile"]) {
    mcpServers["devprofile"] = {
      url: "http://127.0.0.1:7337/mcp",
    };
  }
  cfg.mcpServers = mcpServers;

  writeJson(settingsFile, cfg);
}

export async function removeClaudeCodeHooks(
  settingsFile = claudeSettingsPath(),
): Promise<void> {
  if (!existsSync(settingsFile)) return;
  try {
    const cfg = readJson(settingsFile);
    const hooks = (cfg.hooks ?? {}) as Record<string, unknown[]>;
    for (const event of Object.keys(hooks)) {
      hooks[event] = hooks[event].filter(
        (m) =>
          !(
            typeof m === "object" &&
            m !== null &&
            Array.isArray((m as HookMatcher).hooks) &&
            (m as HookMatcher).hooks.some((h) =>
              h.command?.includes(HOOK_MARKER),
            )
          ),
      );
    }
    cfg.hooks = hooks;
    // Remove MCP server entry
    const mcpServers = (cfg.mcpServers ?? {}) as Record<string, unknown>;
    delete mcpServers["devprofile"];
    cfg.mcpServers = mcpServers;
    writeJson(settingsFile, cfg);
  } catch {
    restoreBackup(settingsFile);
  }
}

// ── Continue.dev MCP ──────────────────────────────────────────────────────────

interface McpServerEntry {
  name: string;
  transport?: { type: string; url: string };
  // older format
  url?: string;
}

export async function installContinueDevMcp(
  configFile = continueConfigPath(),
): Promise<void> {
  backup(configFile);
  const cfg = readJson(configFile);
  const servers = (cfg.mcpServers ?? []) as McpServerEntry[];
  if (!servers.some((s) => s.name === "devprofile")) {
    servers.push({
      name: "devprofile",
      transport: { type: "http", url: "http://127.0.0.1:7337/mcp" },
    });
  }
  cfg.mcpServers = servers;
  writeJson(configFile, cfg);
}

export async function removeContinueDevMcp(
  configFile = continueConfigPath(),
): Promise<void> {
  if (!existsSync(configFile)) return;
  try {
    const cfg = readJson(configFile);
    const servers = (cfg.mcpServers ?? []) as McpServerEntry[];
    cfg.mcpServers = servers.filter((s) => s.name !== "devprofile");
    writeJson(configFile, cfg);
  } catch {
    restoreBackup(configFile);
  }
}

// ── Claude Code slash commands ────────────────────────────────────────────────

export function claudeCommandPath(base = homedir()): string {
  return join(base, ".claude", "commands", "devprofile.md");
}

const SLASH_COMMAND_CONTENT = `Use the devprofile MCP tool with view="$ARGUMENTS" (use "summary" if no argument given) and display the result exactly as returned, without adding any commentary.
`;

export async function installClaudeSlashCommand(
  commandFile = claudeCommandPath(),
): Promise<void> {
  mkdirSync(dirname(commandFile), { recursive: true });
  if (!existsSync(commandFile)) {
    writeFileSync(commandFile, SLASH_COMMAND_CONTENT);
  }
}

export async function removeClaudeSlashCommand(
  commandFile = claudeCommandPath(),
): Promise<void> {
  if (existsSync(commandFile)) {
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(commandFile); } catch { /* ignore */ }
  }
}

// ── Combined ──────────────────────────────────────────────────────────────────

export async function removeAllHooks(
  settingsFile = claudeSettingsPath(),
  configFile = continueConfigPath(),
  commandFile = claudeCommandPath(),
): Promise<void> {
  await removeClaudeCodeHooks(settingsFile);
  await removeContinueDevMcp(configFile);
  await removeClaudeSlashCommand(commandFile);
}
