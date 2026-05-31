import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";
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
  if (existsSync(path)) copyFileSync(path, `${path}.beheld.bak`);
}

function restoreBackup(path: string): void {
  const bak = `${path}.beheld.bak`;
  if (existsSync(bak)) copyFileSync(bak, path);
}

// ── Claude Code hooks ─────────────────────────────────────────────────────────

const HOOK_MARKER = "7337/hook";
/** Marker present in the SessionStart hook so we can detect and idempotently
 *  re-install it. The string is unique to Beheld and unlikely to appear in any
 *  other hook. */
const SESSION_START_MARKER = "beheld-session-start";

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

/** Build the SessionStart hook command. It must:
 *   - Run quickly when the slash command file already exists (fast path).
 *   - Restore the file if missing — without depending on the daemon being up,
 *     so it survives a stopped daemon, a fresh boot, or a `delete` half-undone.
 *   - Never error the Claude Code session (always exit 0). */
function makeSessionStartHook(): HookMatcher {
  // sh script kept on a single line to minimise quoting issues when written
  // into JSON. `:; true` at the end guarantees a 0 exit code.
  const script =
    `# ${SESSION_START_MARKER}\n` +
    `F="$HOME/.claude/commands/beheld.md"; ` +
    `if [ ! -s "$F" ]; then ` +
    `  if command -v beheld >/dev/null 2>&1; then ` +
    `    beheld self-heal >/dev/null 2>&1 || beheld doctor >/dev/null 2>&1 || true; ` +
    `  fi; ` +
    `fi; ` +
    `exit 0`;
  return {
    matcher: "",
    hooks: [
      {
        type: "command",
        command: script,
      },
    ],
  };
}

function hasBeheldHook(matchers: unknown[]): boolean {
  return matchers.some(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      Array.isArray((m as HookMatcher).hooks) &&
      (m as HookMatcher).hooks.some(
        (h) =>
          h.command?.includes(HOOK_MARKER) ||
          h.command?.includes(SESSION_START_MARKER),
      ),
  );
}

export async function installClaudeCodeHooks(
  settingsFile = claudeSettingsPath(),
): Promise<void> {
  const home = homedir();
  const cwd = process.cwd();
  const protectedTargets = [
    claudeSettingsPath(home),
    claudeJsonPath(home),
    claudeCommandPath(home),
  ];
  for (const target of protectedTargets) {
    if (!target.startsWith(home)) {
      throw new Error(`Segurança: tentativa de escrita fora do home: ${target}`);
    }
    if (cwd !== home && target.startsWith(cwd + "/")) {
      throw new Error(`Segurança: tentativa de escrita dentro do projeto atual: ${target}`);
    }
  }

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
    if (!hasBeheldHook(existing)) {
      hooks[event] = [...existing, makeHook(endpoint)];
    }
  }
  // SessionStart guarantees the /beheld slash command is present at every
  // Claude Code session start — daemon-independent, so it survives stopped
  // daemons and bad shutdowns.
  const sessionStart = (hooks.SessionStart ?? []) as unknown[];
  if (!hasBeheldHook(sessionStart)) {
    hooks.SessionStart = [...sessionStart, makeSessionStartHook()];
  }
  cfg.hooks = hooks;

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
            (m as HookMatcher).hooks.some(
              (h) =>
                h.command?.includes(HOOK_MARKER) ||
                h.command?.includes(SESSION_START_MARKER),
            )
          ),
      );
    }
    cfg.hooks = hooks;
    // Also clean up legacy mcpServers entry written by older versions
    const mcpServers = (cfg.mcpServers ?? {}) as Record<string, unknown>;
    if ("beheld" in mcpServers) {
      delete mcpServers["beheld"];
      cfg.mcpServers = mcpServers;
    }
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
  if (!servers.some((s) => s.name === "beheld")) {
    servers.push({
      name: "beheld",
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
    cfg.mcpServers = servers.filter((s) => s.name !== "beheld");
    writeJson(configFile, cfg);
  } catch {
    restoreBackup(configFile);
  }
}

// ── Claude Code slash commands ────────────────────────────────────────────────

export function claudeCommandPath(base = homedir()): string {
  return join(base, ".claude", "commands", "beheld.md");
}

/** Bump whenever SLASH_COMMAND_CONTENT changes in a way that should override
 *  previously-installed copies. The installer rewrites any file whose
 *  detectable version is below this value. */
export const SLASH_COMMAND_VERSION = "7";

/**
 * Body of `~/.claude/commands/beheld.md`. Exported so tests can pin it as a
 * snapshot — any drift in this string must be matched by a bump of
 * SLASH_COMMAND_VERSION and an update of the snapshot test, otherwise CI fails.
 *
 * Key invariants the snapshot guards:
 *   - frontmatter declares the current SLASH_COMMAND_VERSION
 *   - greeting instruction with `[nome]` placeholder (Claude resolves at runtime;
 *     MCP server never resolves the user name)
 *   - five routing rules: b3 conversational mode, import-prefix, bare-import,
 *     stack-keywords (F6.12b), fallback-view. b3 must precede import to avoid
 *     ambiguity ("b3 import ..." is conversational, not an import). Stack is
 *     placed before the catch-all view so the keywords don't fall into it.
 *   - b3 mode embeds the literal response template, including the signal
 *     symbol `-(·⊙·)-`. v5 removed the markdown blockquote (>) prefix
 *     because the CLI was rendering blockquote content in italic; we want
 *     upright-only typography (per S1352 — Remove all italic styling)
 *   - stack keywords accepted: stack | linguagens | frameworks | arquitetura
 */
export const SLASH_COMMAND_CONTENT = `---
version: "${SLASH_COMMAND_VERSION}"
---
Antes de qualquer resposta, apresente-se com exatamente esta frase,
substituindo [nome] pelo nome do usuário desta sessão do Claude
(você tem acesso a essa informação no contexto da conversa):

  "Meu nome é B3H31D. Vou testemunhar a evolução do perfil de [nome]."

Em seguida, aplique as regras de roteamento abaixo com base em: $ARGUMENTS

──────────────────────────────────────────────────────────
REGRAS DE ROTEAMENTO (aplique exatamente, nesta ordem)
──────────────────────────────────────────────────────────

Regra 1 — Modo conversacional b3:
  Se "$ARGUMENTS" começar com "b3 " ou "B3 " (case-insensitive, com espaço após):
  → Extraia a pergunta após o prefixo
  → Se a pergunta exigir dados de perfil (evolução, scores, padrões, commits,
    test ratio, ecosystems): chame a tool \`beheld\` com action="view" e use
    os dados retornados para embasar a resposta
  → Se a pergunta for contextual ao código visível na conversa:
    responda diretamente sem chamar a tool
  → Formate a resposta obrigatoriamente neste template markdown:

      -(·⊙·)-

      **B3H31D** [verbo em 3ª pessoa] [observação em 2 a 4 frases]

  → Voz: terceira pessoa. O **B3H31D** em negrito É o sujeito da primeira
    frase — a primeira palavra logo após **B3H31D** é o verbo
    ("percebe", "observa", "nota", "entende", "vê"). NUNCA repita o nome
    "B3H31D" no corpo da resposta. As frases seguintes encadeiam sem
    renomear o sujeito.
  → Testemunha: relata o observado, nunca julga o dev.
  → Sem listas, sem cabeçalhos, sem blocos de código.
  → Nenhum conteúdo fora do template acima — apenas a decoração e o parágrafo.

  → EXEMPLO CORRETO (sujeito uma só vez, em negrito):

      -(·⊙·)-

      **B3H31D** percebe que o /beheld tem variações summary, scores e
      insight. Observa também o modo conversacional via "b3 <pergunta>".
      Entende que cada palavra muda o que é testemunhado.

  → EXEMPLO ERRADO (NÃO faça assim — sujeito repetido):

      **B3H31D** B3H31D percebe que... B3H31D observa... B3H31D entende...

  → TIPOGRAFIA — REGRA ABSOLUTA: ZERO ITÁLICO em qualquer parte da resposta.
    Proibições explícitas:
      - NUNCA usar asterisco simples *palavra* — isso vira itálico no render
      - NUNCA usar underscore _palavra_ — também vira itálico
      - NUNCA usar blockquote (>) — o CLI renderiza blockquote em itálico
      - NUNCA usar tags HTML <em>, <i>, ou qualquer marcação equivalente
    Permitido apenas:
      - **palavra** (asterisco DUPLO) para o nome B3H31D no template
      - texto plano, sem nenhuma ênfase tipográfica
    Se quiser destacar um termo, escreva-o entre aspas: "como assim".
    Nunca por itálico. Tipografia ereta é parte da identidade do B3H31D.

Regra 2 — Import com URL:
  Se "$ARGUMENTS" começar com "import " (com espaço, case-sensitive):
  → Extraia tudo após "import " como a URL
  → Chame a tool \`beheld\` com: action="import", url=<url extraída>
  → Retorne exatamente o que a tool retornar

Regra 3 — Import sem URL:
  Se "$ARGUMENTS" for exatamente "import" (sem nada após):
  → Chame a tool \`beheld\` com: action="import", url=""
  → Retorne exatamente o que a tool retornar

Regra 4 — Stack:
  Se "$ARGUMENTS" for exatamente "stack" OU "linguagens" OU "frameworks" OU "arquitetura":
  → Chame a tool \`beheld\` com: action="stack"
  → Retorne exatamente o que a tool retornar

Regra 5 — View (padrão):
  Em qualquer outro caso (vazio, "summary", "scores", "insights", "full", etc.):
  → Chame a tool \`beheld\` com: action="view", view="$ARGUMENTS" (default: "summary")
  → Retorne exatamente o que a tool retornar
`;

/** Legacy (v1) prompt body — the unframed single line installed before v2.
 *  Used purely to detect files we wrote so they can be upgraded in place. */
const LEGACY_V1_SIGNATURE = "Use the beheld MCP tool with view=\"$ARGUMENTS\"";

/** Pull the frontmatter version stamp from a slash-command file, if any. */
function readSlashCommandVersion(content: string): string | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) return null;
  const closing = trimmed.indexOf("\n---", 3);
  if (closing === -1) return null;
  const header = trimmed.slice(3, closing);
  const match = header.match(/^[ \t]*version:[ \t]*"?([^"\n]+)"?[ \t]*$/m);
  return match ? match[1].trim() : null;
}

/** True when the file looks like one Beheld previously wrote and is outdated. */
function isBeheldManagedAndOutdated(content: string): boolean {
  const version = readSlashCommandVersion(content);
  if (version !== null) return version !== SLASH_COMMAND_VERSION;
  return content.includes(LEGACY_V1_SIGNATURE);
}

export async function installClaudeSlashCommand(
  commandFile = claudeCommandPath(),
): Promise<void> {
  mkdirSync(dirname(commandFile), { recursive: true });
  const exists = existsSync(commandFile);
  if (!exists) {
    writeFileSync(commandFile, SLASH_COMMAND_CONTENT, "utf-8");
    return;
  }
  const current = readFileSync(commandFile, "utf-8");
  if (current.trim().length === 0 || isBeheldManagedAndOutdated(current)) {
    writeFileSync(commandFile, SLASH_COMMAND_CONTENT, "utf-8");
  }
  // Otherwise the file is either current (v2) or user-customized — leave it.
}

export async function removeClaudeSlashCommand(
  commandFile = claudeCommandPath(),
): Promise<void> {
  if (existsSync(commandFile)) {
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(commandFile); } catch { /* ignore */ }
  }
}

// ── Claude Code global MCP registry (~/.claude.json) ─────────────────────────

export function claudeJsonPath(base = homedir()): string {
  return join(base, ".claude.json");
}

export async function installClaudeMcpServer(
  claudeJson = claudeJsonPath(),
  base = homedir(),
): Promise<void> {
  const cfg = readJson(claudeJson);
  const mcpServers = (cfg.mcpServers ?? {}) as Record<string, unknown>;
  const existing = mcpServers["beheld"] as { args?: string[] } | undefined;
  const needsUpdate =
    !existing ||
    !Array.isArray(existing.args) ||
    !existing.args.includes("--stdio");

  if (needsUpdate) {
    mcpServers["beheld"] = {
      type: "stdio",
      command: join(base, ".local", "bin", "beheld"),
      args: ["server", "--stdio"],
    };
    cfg.mcpServers = mcpServers;
    writeJson(claudeJson, cfg);
  }
}

export async function removeClaudeMcpServer(
  claudeJson = claudeJsonPath(),
): Promise<void> {
  if (!existsSync(claudeJson)) return;
  try {
    const cfg = readJson(claudeJson);
    const mcpServers = (cfg.mcpServers ?? {}) as Record<string, unknown>;
    if ("beheld" in mcpServers) {
      delete mcpServers["beheld"];
      cfg.mcpServers = mcpServers;
      writeJson(claudeJson, cfg);
    }
  } catch { /* ignore */ }
}

// ── Self-heal Claude Code integration ─────────────────────────────────────────

function beheldConfigPath(base = homedir()): string {
  return join(base, ".beheld", "config.json");
}

/** True when the user opted into Claude Code during `beheld init`. */
function claudeCodeOptedIn(base = homedir()): boolean {
  const cfg = readJson(beheldConfigPath(base));
  const envs = cfg.environments as { claudeCode?: unknown } | undefined;
  return envs?.claudeCode === true;
}

export interface IntegrationHeal {
  slashCommandRestored: boolean;
  mcpServerRestored: boolean;
}

/**
 * Idempotently restore the two artifacts that make `/beheld` appear in Claude Code:
 *   1. the user-global slash command  ~/.claude/commands/beheld.md
 *   2. the global MCP server entry     ~/.claude.json → mcpServers.beheld
 *
 * Either can be silently wiped (e.g. by `beheld delete`), leaving `/beheld` gone
 * for good in every new session. Calling this on each daemon start makes the
 * command self-healing. It only acts when the user opted into Claude Code, and
 * never throws — a heal failure must never block the daemon.
 */
export async function selfHealClaudeIntegration(
  base = homedir(),
): Promise<IntegrationHeal> {
  const healed: IntegrationHeal = {
    slashCommandRestored: false,
    mcpServerRestored: false,
  };
  if (!claudeCodeOptedIn(base)) return healed;

  const commandFile = claudeCommandPath(base);
  try {
    let needsWrite = !existsSync(commandFile);
    if (!needsWrite) {
      const current = readFileSync(commandFile, "utf-8");
      needsWrite =
        current.trim().length === 0 || isBeheldManagedAndOutdated(current);
    }
    if (needsWrite) {
      await installClaudeSlashCommand(commandFile);
      healed.slashCommandRestored = true;
    }
  } catch {
    /* non-fatal */
  }

  const claudeJson = claudeJsonPath(base);
  try {
    const cfg = readJson(claudeJson);
    const servers = (cfg.mcpServers ?? {}) as Record<string, { args?: unknown }>;
    const entry = servers["beheld"];
    const present =
      !!entry && Array.isArray(entry.args) && entry.args.includes("--stdio");
    if (!present) {
      await installClaudeMcpServer(claudeJson, base);
      healed.mcpServerRestored = true;
    }
  } catch {
    /* non-fatal */
  }

  return healed;
}

// ── Project-scoped registration migration ────────────────────────────────────

export async function migrateProjectScopedRegistrations(
  projectsDir = join(homedir(), ".claude", "projects"),
): Promise<number> {
  if (!existsSync(projectsDir)) return 0;

  let migrated = 0;
  const entries = readdirSync(projectsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const settingsPath = join(projectsDir, entry.name, "settings.json");
    if (!existsSync(settingsPath)) continue;

    let config: Record<string, unknown>;
    try {
      config = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      continue;
    }

    const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
    if (!("beheld" in servers)) continue;

    copyFileSync(settingsPath, `${settingsPath}.bak`);
    delete servers["beheld"];

    if (Object.keys(servers).length === 0) {
      delete config.mcpServers;
    } else {
      config.mcpServers = servers;
    }

    writeFileSync(settingsPath, JSON.stringify(config, null, 2), "utf-8");
    migrated++;
  }

  return migrated;
}

// ── Combined ──────────────────────────────────────────────────────────────────

export async function removeAllHooks(
  settingsFile = claudeSettingsPath(),
  configFile = continueConfigPath(),
  commandFile = claudeCommandPath(),
  claudeJson = claudeJsonPath(),
): Promise<void> {
  await removeClaudeCodeHooks(settingsFile);
  await removeContinueDevMcp(configFile);
  await removeClaudeSlashCommand(commandFile);
  await removeClaudeMcpServer(claudeJson);
}
