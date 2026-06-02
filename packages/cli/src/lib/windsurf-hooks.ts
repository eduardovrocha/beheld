/**
 * R3.1 — Windsurf Cascade Hooks installer.
 *
 * Windsurf reads its hook configuration from `~/.codeium/windsurf/hooks.json`.
 * Each entry binds a Cascade event to a shell command that receives the
 * JSON envelope on stdin. We register one entry per documented event,
 * forwarding the body to the local mcp-server with the event name as a
 * query param so the single `/hook/windsurf/event` route can discriminate
 * all 12 events.
 *
 * Design choices:
 *
 *   1. **Idempotent**. installWindsurfHooks() reads the existing file (if
 *      any), merges the Beheld entries under a stable namespace, and
 *      writes back. Existing non-Beheld hooks are preserved verbatim.
 *
 *   2. **Backup-on-change**. Before any write, the existing hooks.json
 *      is copied to hooks.json.beheld.bak. Mirrors the Claude Code hook
 *      installer (see config/hooks.ts).
 *
 *   3. **Tight timeouts**. Each hook gets `timeout_seconds: 3` — enough
 *      for the local POST round-trip but short enough that Cascade never
 *      blocks the user when the daemon is down.
 *
 *   4. **Curl + @-**. The command pipes stdin straight into curl
 *      (`--data-binary @-`) so no temporary files touch disk and no
 *      shell-quoting bugs leak content. `--max-time 2` is a second
 *      guard rail.
 *
 *   5. **Per-event query param**. The route is
 *      `/hook/windsurf/event?event=<cascade_event_name>` — the server
 *      reads the param and dispatches inside handleWindsurfEvent.
 */
import {
  existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The 12 Cascade events Beheld registers. Mirrors WINDSURF_EVENTS in
 * mcp-server/src/hooks/windsurf.ts — kept duplicated rather than imported
 * to avoid cross-package coupling (cli must build as a standalone binary).
 */
export const WINDSURF_HOOK_EVENTS = [
  "pre_read_code",
  "post_read_code",
  "pre_write_code",
  "post_write_code",
  "pre_run_command",
  "post_run_command",
  "pre_mcp_tool_use",
  "post_mcp_tool_use",
  "pre_user_prompt",
  "post_cascade_response",
  "post_cascade_response_with_transcript",
  "post_setup_worktree",
] as const;

export type WindsurfHookEvent = typeof WINDSURF_HOOK_EVENTS[number];

interface WindsurfHookEntry {
  command: string;
  timeout_seconds: number;
  /** Namespacing marker so updates can find / replace Beheld's entries
   *  without touching the user's other hooks. */
  managed_by?: string;
}

interface WindsurfHooksFile {
  hooks?: Record<string, WindsurfHookEntry | WindsurfHookEntry[]>;
  [k: string]: unknown;
}

const MANAGED_MARKER = "beheld";

export interface WindsurfHookPaths {
  /** Absolute path of the hooks.json file (defaults to
   *  ~/.codeium/windsurf/hooks.json). */
  hooksFile: string;
  /** Backup path (defaults to <hooksFile>.beheld.bak). */
  backupFile: string;
}

export function defaultWindsurfHookPaths(): WindsurfHookPaths {
  const hooksFile = join(homedir(), ".codeium", "windsurf", "hooks.json");
  return { hooksFile, backupFile: `${hooksFile}.beheld.bak` };
}

/** Stable curl command per event. The mcp-server reads the body on stdin. */
function commandFor(event: WindsurfHookEvent, mcpUrl: string): string {
  return [
    "curl",
    "-s",
    "--max-time 2",
    "-X POST",
    "-H 'Content-Type: application/json'",
    "--data-binary @-",
    `'${mcpUrl}/hook/windsurf/event?event=${event}'`,
  ].join(" ");
}

export interface InstallResult {
  /** True when the file changed (false if Beheld entries already matched). */
  changed: boolean;
  /** True when a backup was written this run. */
  backedUp: boolean;
  /** Final entry count under `hooks` for the file we wrote. */
  totalEntries: number;
  /** Path of the file written. */
  path: string;
}

/**
 * Install (or update) Beheld's 12 hook entries inside the Windsurf
 * hooks.json file. Idempotent: re-running produces `changed: false`
 * when the entries are already current.
 *
 * `mcpUrl` defaults to the BEHELD_MCP_URL env or http://127.0.0.1:7337.
 */
export function installWindsurfHooks(
  paths: WindsurfHookPaths = defaultWindsurfHookPaths(),
  mcpUrl?: string,
): InstallResult {
  const url = mcpUrl ?? process.env.BEHELD_MCP_URL ?? "http://127.0.0.1:7337";

  // Read existing file or start from scratch.
  let file: WindsurfHooksFile = {};
  if (existsSync(paths.hooksFile)) {
    try {
      file = JSON.parse(readFileSync(paths.hooksFile, "utf-8")) as WindsurfHooksFile;
      if (typeof file !== "object" || file === null) file = {};
    } catch {
      // Corrupt JSON — back it up and start clean.
      file = {};
    }
  }

  // Build the desired Beheld entries.
  const desired: Record<string, WindsurfHookEntry> = {};
  for (const ev of WINDSURF_HOOK_EVENTS) {
    desired[ev] = {
      command: commandFor(ev, url),
      timeout_seconds: 3,
      managed_by: MANAGED_MARKER,
    };
  }

  // Preserve foreign hooks (non-Beheld entries already present).
  const merged: Record<string, WindsurfHookEntry | WindsurfHookEntry[]> = { ...(file.hooks ?? {}) };
  let dirty = false;
  for (const [ev, entry] of Object.entries(desired)) {
    const existing = merged[ev];
    if (Array.isArray(existing)) {
      // Replace any prior Beheld entries in the array; preserve foreign ones.
      const foreign = existing.filter((e) => e.managed_by !== MANAGED_MARKER);
      const next = [...foreign, entry];
      if (!entriesEqual(existing, next)) dirty = true;
      merged[ev] = next;
    } else if (existing) {
      // Single existing entry — replace only when it's already ours
      // or shape mismatches the desired Beheld entry.
      if (existing.managed_by === MANAGED_MARKER) {
        if (!entryEqual(existing, entry)) dirty = true;
        merged[ev] = entry;
      } else {
        // User's foreign single-entry — wrap into array alongside Beheld's.
        merged[ev] = [existing, entry];
        dirty = true;
      }
    } else {
      merged[ev] = entry;
      dirty = true;
    }
  }

  if (!dirty) {
    return { changed: false, backedUp: false, totalEntries: Object.keys(merged).length, path: paths.hooksFile };
  }

  // Ensure parent dir.
  const dir = dirname(paths.hooksFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });

  // Backup if the file already exists.
  let backedUp = false;
  if (existsSync(paths.hooksFile)) {
    try {
      copyFileSync(paths.hooksFile, paths.backupFile);
      backedUp = true;
    } catch { /* best-effort */ }
  }

  const out: WindsurfHooksFile = { ...file, hooks: merged };
  writeFileSync(paths.hooksFile, JSON.stringify(out, null, 2) + "\n", { mode: 0o600 });

  return { changed: true, backedUp, totalEntries: Object.keys(merged).length, path: paths.hooksFile };
}

/**
 * Reverse of installWindsurfHooks: removes the Beheld entries from the
 * file, preserves foreign hooks, deletes the file when empty. Returns
 * true if anything changed.
 */
export function uninstallWindsurfHooks(
  paths: WindsurfHookPaths = defaultWindsurfHookPaths(),
): boolean {
  if (!existsSync(paths.hooksFile)) return false;
  let file: WindsurfHooksFile;
  try {
    file = JSON.parse(readFileSync(paths.hooksFile, "utf-8")) as WindsurfHooksFile;
  } catch {
    return false;
  }
  const merged = { ...(file.hooks ?? {}) };
  let dirty = false;
  for (const [ev, entry] of Object.entries(merged)) {
    if (Array.isArray(entry)) {
      const foreign = entry.filter((e) => e.managed_by !== MANAGED_MARKER);
      if (foreign.length !== entry.length) dirty = true;
      if (foreign.length === 0) delete merged[ev];
      else if (foreign.length === 1) merged[ev] = foreign[0];
      else merged[ev] = foreign;
    } else if (entry && (entry as WindsurfHookEntry).managed_by === MANAGED_MARKER) {
      delete merged[ev];
      dirty = true;
    }
  }
  if (!dirty) return false;
  const out: WindsurfHooksFile = { ...file, hooks: merged };
  writeFileSync(paths.hooksFile, JSON.stringify(out, null, 2) + "\n", { mode: 0o600 });
  return true;
}

function entryEqual(a: WindsurfHookEntry, b: WindsurfHookEntry): boolean {
  return a.command === b.command
    && a.timeout_seconds === b.timeout_seconds
    && a.managed_by === b.managed_by;
}

function entriesEqual(
  a: WindsurfHookEntry | WindsurfHookEntry[],
  b: WindsurfHookEntry | WindsurfHookEntry[],
): boolean {
  const arrA = Array.isArray(a) ? a : [a];
  const arrB = Array.isArray(b) ? b : [b];
  if (arrA.length !== arrB.length) return false;
  for (let i = 0; i < arrA.length; i++) if (!entryEqual(arrA[i], arrB[i])) return false;
  return true;
}
