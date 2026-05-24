/**
 * `beheld self-heal` — silent, idempotent re-installer of the two artifacts
 * that make `/beheld` reachable in Claude Code:
 *
 *   1. ~/.claude/commands/beheld.md   (slash command prompt)
 *   2. ~/.claude.json                 (global MCP server registration)
 *
 * Designed to be invoked from a SessionStart hook so the slash command
 * survives anything that wipes the file mid-session: an overzealous cleanup,
 * a half-finished `delete`, a binary upgrade, or Claude Code's own
 * housekeeping.
 *
 * Contract:
 *   - Always exits with code 0 — a heal failure must never break the session.
 *   - Prints nothing on stdout by default (designed for redirect to /dev/null).
 *   - Pass `--verbose` for a single-line summary of what was restored.
 *   - No-op when the user did not opt into Claude Code during `beheld init`.
 */

import { selfHealClaudeIntegration } from "../config/hooks";

export interface SelfHealOptions {
  verbose?: boolean;
  /** Override the home directory — tests use this to point at a temp tree. */
  base?: string;
}

export async function selfHealCommand(opts: SelfHealOptions = {}): Promise<void> {
  try {
    const healed = opts.base
      ? await selfHealClaudeIntegration(opts.base)
      : await selfHealClaudeIntegration();
    if (opts.verbose) {
      const parts: string[] = [];
      if (healed.slashCommandRestored) parts.push("slash command restaurado");
      if (healed.mcpServerRestored) parts.push("MCP server restaurado");
      // eslint-disable-next-line no-console
      console.log(parts.length === 0 ? "OK (nada a restaurar)" : parts.join(" + "));
    }
  } catch {
    // A heal failure is silent on purpose — never block the session.
  }
}
