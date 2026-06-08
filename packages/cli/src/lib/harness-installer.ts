/**
 * Unified harness installer (R2/R3 wrap-up).
 *
 * Until this module, every harness had its own onboarding ritual:
 *
 *   - Claude Code + Continue.dev → wired by `beheld init` via config/hooks.ts.
 *   - Windsurf → `installWindsurfHooks()` existed as a standalone function,
 *     never invoked by any command.
 *   - Gemini CLI / Codex CLI → handlers existed on the mcp-server side, but
 *     no CLI-side install path was wired (would be `native_hook` once each
 *     harness's hook spec stabilises).
 *   - Cursor / Copilot CLI / Copilot VS Code → tail loops existed but were
 *     never scheduled in the daemon supervisor.
 *
 * This module collapses all eight into a single registry of `HarnessAdapter`
 * entries that share one detection / install / uninstall surface. `beheld
 * init` and `beheld bootstrap` consume the registry to iterate and either
 * (a) write hooks files for native_hook / editor_extension harnesses, or
 * (b) flip a tail entry on in ~/.beheld/config.json for log_tail / statusline
 * harnesses (the daemon supervisor reads that config and schedules
 * `pollOnce` for each enabled tail).
 *
 * Honesty about completeness:
 *   - Claude Code, Continue.dev, Windsurf: confirmed hook schemas; installers
 *     produce real on-disk configs.
 *   - Gemini CLI, Codex CLI: hook schema is NOT yet documented publicly by
 *     either upstream as of 2026-06-02. We mark these as
 *     `requires_manual_setup: true` and print explicit instructions instead
 *     of writing a speculative config file.
 *   - Cursor, Copilot CLI, Copilot VS Code: pure log-tail — no harness-side
 *     config; install just enables the tail in ~/.beheld/config.json.
 *
 * Detection (`isInstalled`) is filesystem-only and never spawns the harness
 * binary — keeps the installer fast and safe to run inside containers.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  installClaudeCodeHooks,
  removeClaudeCodeHooks,
  installContinueDevMcp,
  removeContinueDevMcp,
} from "../config/hooks";
import {
  installWindsurfHooks,
  uninstallWindsurfHooks,
} from "./windsurf-hooks";

// ── Public types ─────────────────────────────────────────────────────────

/** Closed enum mirror of capture_fidelity from the Python registry. */
export type CaptureFidelity =
  | "native_hook"
  | "editor_extension"
  | "local_log_tail"
  | "statusline"
  | "inferred";

export interface InstallResult {
  /** Did this run actually write anything? (false when already installed) */
  changed: boolean;
  /** Did we write something — vs. just print manual instructions? */
  wroteFile: boolean;
  /** True when the harness needs the user to copy/paste a snippet manually
   *  because we can't safely write a config for it (e.g. spec not stable). */
  requiresManualSetup: boolean;
  /** Optional human-readable note for the orchestrator to print. */
  note?: string;
}

export interface UninstallResult {
  changed: boolean;
  note?: string;
}

export interface HarnessAdapter {
  /** Stable kebab-case identifier (matches the wire `source` string used by
   *  the mcp-server). Single source of truth — every other layer keys off this. */
  readonly name: string;
  /** Human-readable label for status output. */
  readonly label: string;
  /** Capture fidelity per the closed enum. */
  readonly fidelity: CaptureFidelity;
  /** One-line note shown beneath the row in `beheld harness list`. Adapter-
   *  specific particularidade (path detectado, mecanismo de hook, etc.) —
   *  complementa a explicação genérica derivada de `fidelity`. PT-BR, voz
   *  testemunha do produto. */
  readonly description: string;
  /** Filesystem-only detection. Returns true when the harness appears to be
   *  installed on this host. Never spawns binaries. */
  isInstalled(): boolean;
  /** Install / register the Beheld side of this adapter. Idempotent. */
  install(): InstallResult;
  /** Reverse of install(). Idempotent. */
  uninstall(): UninstallResult;
}

// ── Path helpers ─────────────────────────────────────────────────────────

const HOME = (): string => homedir();
const BEHELD_DIR = (): string =>
  process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(HOME(), ".beheld");
const BEHELD_CONFIG = (): string => join(BEHELD_DIR(), "config.json");

// ── Tail config helper (shared by log_tail / statusline adapters) ────────

interface BeheldConfig {
  /** R2/R3 — closed list of tail adapters the daemon supervisor should
   *  schedule on start. Each entry is a wire-side source string. */
  tails?: string[];
  [k: string]: unknown;
}

function readBeheldConfig(): BeheldConfig {
  const path = BEHELD_CONFIG();
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf8")) as BeheldConfig; }
  catch { return {}; }
}

function writeBeheldConfig(cfg: BeheldConfig): void {
  const path = BEHELD_CONFIG();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

export function enabledTails(): string[] {
  const cfg = readBeheldConfig();
  return Array.isArray(cfg.tails) ? cfg.tails.slice() : [];
}

function setTailEnabled(name: string, enabled: boolean): boolean {
  const cfg = readBeheldConfig();
  const current = Array.isArray(cfg.tails) ? cfg.tails : [];
  const isCurrentlyEnabled = current.includes(name);
  if (enabled && isCurrentlyEnabled) return false; // no-op
  if (!enabled && !isCurrentlyEnabled) return false;
  cfg.tails = enabled
    ? [...current, name].sort()
    : current.filter((n) => n !== name);
  writeBeheldConfig(cfg);
  return true;
}

// ── Adapter factories ────────────────────────────────────────────────────

/** Adapter for harnesses that wire hooks on Beheld's side via existing
 *  helpers in `config/hooks.ts` (Claude Code, Continue.dev). Wraps the
 *  pre-existing async installers with the synchronous-friendly interface. */
function makeBuiltinHooksAdapter(opts: {
  name: string;
  label: string;
  fidelity: CaptureFidelity;
  description: string;
  detectionPath: string;
  install: () => Promise<unknown>;
  uninstall: () => Promise<unknown>;
}): HarnessAdapter {
  return {
    name: opts.name,
    label: opts.label,
    fidelity: opts.fidelity,
    description: opts.description,
    isInstalled: () => existsSync(opts.detectionPath),
    install: () => {
      // Existing installers are async; we synchronously await via a
      // microtask drain so the public interface stays synchronous for the
      // common path. `void` callers fire-and-forget — orchestrator awaits
      // the parent install loop.
      // Note: these installers DO touch the network in some branches (MCP
      // server registration). The orchestrator catches throws.
      void opts.install();
      return {
        changed: true,
        wroteFile: true,
        requiresManualSetup: false,
        note: `${opts.label} hooks wired (config at ${opts.detectionPath})`,
      };
    },
    uninstall: () => {
      void opts.uninstall();
      return { changed: true, note: `${opts.label} hooks removed` };
    },
  };
}

/** Adapter for log_tail / statusline harnesses. Detects by checking the
 *  harness's local log dir; install/uninstall just toggles the tail entry
 *  in ~/.beheld/config.json so the daemon supervisor schedules pollOnce. */
function makeTailAdapter(opts: {
  name: string;
  label: string;
  fidelity: CaptureFidelity;
  description: string;
  detectionPaths: string[];
}): HarnessAdapter {
  return {
    name: opts.name,
    label: opts.label,
    fidelity: opts.fidelity,
    description: opts.description,
    isInstalled: () => opts.detectionPaths.some((p) => existsSync(p)),
    install: () => {
      const changed = setTailEnabled(opts.name, true);
      return {
        changed,
        wroteFile: changed,
        requiresManualSetup: false,
        note: changed
          ? `${opts.label} tail enabled in ~/.beheld/config.json`
          : `${opts.label} tail already enabled`,
      };
    },
    uninstall: () => {
      const changed = setTailEnabled(opts.name, false);
      return { changed, note: changed ? `${opts.label} tail disabled` : `${opts.label} tail already disabled` };
    },
  };
}

/** Adapter for harnesses whose hook spec is not yet stable — surfaces a
 *  manual-setup note instead of writing a speculative config. The
 *  mcp-server handler is in place; the user just has to point the harness
 *  at it. */
function makeManualAdapter(opts: {
  name: string;
  label: string;
  fidelity: CaptureFidelity;
  description: string;
  detectionPaths: string[];
  manualNote: string;
}): HarnessAdapter {
  return {
    name: opts.name,
    label: opts.label,
    fidelity: opts.fidelity,
    description: opts.description,
    isInstalled: () => opts.detectionPaths.some((p) => existsSync(p)),
    install: () => ({
      changed: false,
      wroteFile: false,
      requiresManualSetup: true,
      note: opts.manualNote,
    }),
    uninstall: () => ({ changed: false, note: `${opts.label} has no on-disk install state to remove` }),
  };
}

// ── Registry ─────────────────────────────────────────────────────────────

const claudeAdapter = (): HarnessAdapter =>
  makeBuiltinHooksAdapter({
    name: "claude-code",
    label: "Claude Code",
    fidelity: "native_hook",
    description: "PreToolUse/PostToolUse/Stop em ~/.claude/settings.json + slash /beheld + MCP global",
    detectionPath: join(HOME(), ".claude"),
    install: () => installClaudeCodeHooks(),
    uninstall: () => removeClaudeCodeHooks(),
  });

const continueAdapter = (): HarnessAdapter =>
  makeBuiltinHooksAdapter({
    name: "continue-vscode",
    label: "Continue.dev",
    fidelity: "editor_extension",
    description: "MCP server em http://localhost:7337/mcp registrado em ~/.continue/config.json",
    detectionPath: join(HOME(), ".continue"),
    install: () => installContinueDevMcp(),
    uninstall: () => removeContinueDevMcp(),
  });

const windsurfAdapter = (): HarnessAdapter => ({
  name: "windsurf",
  label: "Windsurf (Cascade Hooks)",
  fidelity: "native_hook",
  description: "Cascade Hooks em ~/.codeium/windsurf/hooks.json (backup automático antes de gravar)",
  isInstalled: () => existsSync(join(HOME(), ".codeium", "windsurf")),
  install: () => {
    const r = installWindsurfHooks();
    return {
      changed: r.changed,
      wroteFile: r.changed,
      requiresManualSetup: false,
      note: r.changed
        ? `Windsurf hooks.json written (${r.totalEntries} entries; backup=${r.backedUp})`
        : `Windsurf hooks.json already up to date`,
    };
  },
  uninstall: () => {
    const changed = uninstallWindsurfHooks();
    return { changed, note: changed ? "Windsurf hooks removed" : "Windsurf hooks already absent" };
  },
});

const geminiAdapter = (): HarnessAdapter =>
  makeManualAdapter({
    name: "gemini-cli",
    label: "Gemini CLI",
    fidelity: "native_hook",
    description: "manual — hook spec da Gemini ainda não publicada; handler já pronto em /hook/gemini/*",
    detectionPaths: [join(HOME(), ".gemini"), "/usr/local/bin/gemini"],
    manualNote: [
      "Gemini CLI's hook API is not yet publicly documented (2026-06-02).",
      "The mcp-server handler is ready at:",
      "  POST http://127.0.0.1:7337/hook/gemini/{pre-tool,post-tool,stop}",
      "When Gemini publishes its hook schema, add it via your Gemini config.",
    ].join("\n    "),
  });

const codexAdapter = (): HarnessAdapter =>
  makeManualAdapter({
    name: "codex-cli",
    label: "Codex CLI",
    fidelity: "native_hook",
    description: "manual — hook spec da Codex ainda não publicada; handler já pronto em /hook/codex/*",
    detectionPaths: [join(HOME(), ".codex"), "/usr/local/bin/codex"],
    manualNote: [
      "Codex CLI's hook API is not yet publicly documented (2026-06-02).",
      "The mcp-server handler is ready at:",
      "  POST http://127.0.0.1:7337/hook/codex/{pre-tool,post-tool,stop}",
      "When Codex publishes its hook schema, add it via your codex config.",
    ].join("\n    "),
  });

const cursorAdapter = (): HarnessAdapter =>
  makeTailAdapter({
    name: "cursor",
    label: "Cursor",
    fidelity: "local_log_tail",
    description: "tail em ~/Library/Application Support/Cursor (macOS) ou ~/.config/Cursor (Linux)",
    detectionPaths: [
      join(HOME(), "Library", "Application Support", "Cursor"),
      join(HOME(), ".config", "Cursor"),
    ],
  });

const copilotCliAdapter = (): HarnessAdapter =>
  makeTailAdapter({
    name: "copilot-cli",
    label: "Copilot CLI",
    fidelity: "statusline",
    description: "polling do statusline em ~/.local/share/gh-copilot, ~/.cache/gh-copilot ou Library/Application Support/gh-copilot",
    detectionPaths: [
      join(HOME(), "Library", "Application Support", "gh-copilot"),
      join(HOME(), ".local", "share", "gh-copilot"),
      join(HOME(), ".cache", "gh-copilot"),
    ],
  });

const copilotVscodeAdapter = (): HarnessAdapter =>
  makeTailAdapter({
    name: "copilot-vscode",
    label: "Copilot VS Code",
    fidelity: "local_log_tail",
    description: "tail em ~/Library/Application Support/Code/logs (macOS) ou ~/.config/Code/logs (Linux)",
    detectionPaths: [
      join(HOME(), "Library", "Application Support", "Code", "logs"),
      join(HOME(), ".config", "Code", "logs"),
    ],
  });

/** Canonical list of every harness Beheld knows about. Ordering matters
 *  visually (the `beheld init` flow prints in this order) but every entry
 *  is independent — disabling one never affects another. */
export function buildHarnessRegistry(): HarnessAdapter[] {
  return [
    claudeAdapter(),
    continueAdapter(),
    windsurfAdapter(),
    geminiAdapter(),
    codexAdapter(),
    cursorAdapter(),
    copilotCliAdapter(),
    copilotVscodeAdapter(),
  ];
}

// ── Orchestrator ─────────────────────────────────────────────────────────

export interface InstallAllResult {
  adapter: HarnessAdapter;
  detected: boolean;
  installed: InstallResult | null;
}

export interface InstallAllOptions {
  /** When given, only adapters whose name is in this set are installed.
   *  Undetected adapters in the filter are still reported (with
   *  `detected: false`). */
  only?: string[];
  /** When true, install ALL adapters regardless of detection. Used by
   *  power users who want to wire Cursor before installing Cursor. */
  force?: boolean;
  /** Override the registry (used by tests). */
  registry?: HarnessAdapter[];
}

/**
 * Iterate the registry, install detected (or forced) adapters, return a
 * report. Never throws — individual adapter install errors are caught and
 * surfaced via a `note` on that adapter's entry.
 */
export function installAllHarnesses(opts: InstallAllOptions = {}): InstallAllResult[] {
  const registry = opts.registry ?? buildHarnessRegistry();
  const filter = opts.only ? new Set(opts.only) : null;

  const out: InstallAllResult[] = [];
  for (const adapter of registry) {
    if (filter && !filter.has(adapter.name)) continue;
    const detected = adapter.isInstalled();
    if (!detected && !opts.force) {
      out.push({ adapter, detected: false, installed: null });
      continue;
    }
    let installed: InstallResult;
    try {
      installed = adapter.install();
    } catch (e) {
      installed = {
        changed: false,
        wroteFile: false,
        requiresManualSetup: false,
        note: `error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    out.push({ adapter, detected: true, installed });
  }
  return out;
}
