/**
 * R1.4 — legacy bridge: move ~/.devprofile/ → ~/.beheld/ for upgrading users.
 *
 * The pre-R1 product shipped under the `devprofile` name. Some early adopters
 * still carry a `~/.devprofile/` directory with their attestation, profile.db,
 * and imported L1 repo history. R1.4 unifies the data root under `~/.beheld/`
 * so the new `beheld bootstrap` command (and every subsequent subcommand) sees
 * a single canonical location.
 *
 * Migration rules (all checked in order — first violation aborts the run):
 *   1. If the legacy dir doesn't exist, return `{ migrated: false, reason }`
 *      (idempotent — calling on a clean machine is a no-op).
 *   2. If the target `~/.beheld/` already exists AND is non-empty, refuse to
 *      overwrite (caller MUST opt in to merge or rename).
 *   3. Otherwise, mkdir the target with mode 0700 and move every immediate
 *      child of the legacy dir into the target via `rename`. Falls back to a
 *      recursive copy + unlink chain on EXDEV (cross-filesystem) — Bun's fs
 *      surfaces this as an error string we match.
 *   4. After all children moved, remove the (now empty) legacy dir. If any
 *      child copy failed, the legacy dir is left intact so the user can
 *      retry without data loss.
 *
 * Returns a structured report so the orchestrator (bootstrap command) can
 * print a single line summarizing what happened — never throws.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  chmodSync,
  cpSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface BridgePaths {
  /** Legacy directory (defaults to `~/.devprofile`). */
  legacy: string;
  /** Canonical target (defaults to `~/.beheld`). */
  target: string;
}

export interface BridgeResult {
  /** True only if at least one child was moved (or copied). */
  migrated: boolean;
  /** Short, lowercase tag for the outcome — stable, suitable for tests. */
  reason:
    | "no_legacy_dir"
    | "target_non_empty"
    | "empty_legacy"
    | "moved"
    | "copied_cross_fs"
    | "partial_failure";
  /** Names of children moved (file or directory). Empty when nothing moved. */
  moved: string[];
  /** Names of children that failed to move (e.g. permission denied). */
  failed: string[];
}

const DEFAULT_LEGACY = join(homedir(), ".devprofile");
const DEFAULT_TARGET = join(homedir(), ".beheld");

export function defaultBridgePaths(): BridgePaths {
  return { legacy: DEFAULT_LEGACY, target: DEFAULT_TARGET };
}

/**
 * Idempotent — safe to call on every `beheld bootstrap` invocation.
 *
 * Visible-to-the-user contract:
 *   - `reason: "no_legacy_dir"` — nothing to do.
 *   - `reason: "target_non_empty"` — bail; user already has a populated
 *     `~/.beheld/`. Caller decides whether to surface a warning.
 *   - `reason: "empty_legacy"` — legacy dir exists but is empty; we remove
 *     it so the next `bootstrap` run is a clean no-op.
 *   - `reason: "moved"` — at least one child moved via `rename` (same FS).
 *   - `reason: "copied_cross_fs"` — at least one child needed a copy + unlink
 *     because legacy and target are on different filesystems.
 *   - `reason: "partial_failure"` — at least one child failed; legacy dir is
 *     preserved so the user can retry.
 */
export function bridgeLegacyDevprofile(paths: BridgePaths = defaultBridgePaths()): BridgeResult {
  const { legacy, target } = paths;

  if (!existsSync(legacy)) {
    return { migrated: false, reason: "no_legacy_dir", moved: [], failed: [] };
  }

  // The legacy path exists. Refuse to overwrite a populated target.
  if (existsSync(target) && readdirSync(target).length > 0) {
    return { migrated: false, reason: "target_non_empty", moved: [], failed: [] };
  }

  const children = readdirSync(legacy);
  if (children.length === 0) {
    // Empty shell — clean it up so future runs are no-ops.
    try { rmSync(legacy, { recursive: true, force: true }); } catch { /* ignore */ }
    return { migrated: false, reason: "empty_legacy", moved: [], failed: [] };
  }

  // Ensure target exists with the canonical 0700 mode. mkdirSync({recursive:true})
  // is a no-op if it already exists, so the empty-target branch above stays safe.
  mkdirSync(target, { recursive: true, mode: 0o700 });
  try { chmodSync(target, 0o700); } catch { /* ignore — best-effort */ }

  const moved: string[] = [];
  const failed: string[] = [];
  let usedCopyFallback = false;

  for (const name of children) {
    const src = join(legacy, name);
    const dest = join(target, name);
    try {
      renameSync(src, dest);
      moved.push(name);
    } catch (e) {
      // Cross-filesystem moves fail with EXDEV on POSIX. Fall back to
      // recursive copy + unlink so the migration still completes.
      const msg = e instanceof Error ? e.message : String(e);
      if (/EXDEV|cross-device|EPERM|EACCES/i.test(msg)) {
        try {
          cpSync(src, dest, { recursive: true, errorOnExist: true, force: false });
          rmSync(src, { recursive: true, force: true });
          moved.push(name);
          usedCopyFallback = true;
        } catch {
          failed.push(name);
        }
      } else {
        failed.push(name);
      }
    }
  }

  if (failed.length > 0) {
    // Don't remove the legacy dir — the user still has data there.
    return { migrated: moved.length > 0, reason: "partial_failure", moved, failed };
  }

  // All children moved successfully. Drop the empty shell.
  try { rmSync(legacy, { recursive: true, force: true }); } catch { /* ignore */ }

  return {
    migrated: true,
    reason: usedCopyFallback ? "copied_cross_fs" : "moved",
    moved,
    failed,
  };
}

/**
 * Internal helper exposed for tests — returns true when `dir` exists and is
 * a directory. Hidden from the public API surface intentionally.
 */
export function _isDirectory(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try { return statSync(dir).isDirectory(); } catch { return false; }
}
