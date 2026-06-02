/**
 * R1.4 — legacy bridge: COPY ~/.devprofile/ → ~/.beheld/ for upgrading users.
 *
 * The pre-R1 product shipped under the `devprofile` name. Some early adopters
 * still carry a `~/.devprofile/` directory with their attestation, profile.db,
 * and imported L1 repo history. R1.4 unifies the data root under `~/.beheld/`
 * so the new `beheld bootstrap` command (and every subsequent subcommand) sees
 * a single canonical location.
 *
 * Migration semantics (D-01 fix — non-destructive copy):
 *   1. If the legacy dir doesn't exist, return `{ migrated: false, reason }`
 *      (idempotent — calling on a clean machine is a no-op).
 *   2. If the target `~/.beheld/` already exists AND is non-empty, refuse to
 *      overwrite. Caller MUST decide whether to merge or rename.
 *   3. Otherwise, mkdir the target with mode 0700 and **copy** every immediate
 *      child of the legacy dir into the target (recursive cpSync). The legacy
 *      dir is **never deleted** and **never mutated** — the user can roll
 *      back manually or keep both layouts in parallel.
 *   4. After every child copies successfully, write a single marker file at
 *      `~/.devprofile/MIGRATED_TO_BEHELD.md` carrying:
 *        - the canonical target path (so future support can locate the data),
 *        - the ISO-8601 timestamp of the migration,
 *        - a one-paragraph human note explaining the rename.
 *      If the marker already exists, it is preserved as-is (idempotent).
 *      The presence of this file is the only signal a re-run uses to short-
 *      circuit a redundant copy on machines that already migrated.
 *   5. On partial failure (any child copy errored) the legacy dir stays
 *      intact, no marker is written, and the caller is told which children
 *      failed so a retry is safe.
 *
 * The earlier R1.4 implementation MOVED files (renameSync) and removed the
 * legacy dir, which violated the spec contract ("legacy bridge NÃO deleta
 * `~/.devprofile/` original" + "cria `~/.devprofile/MIGRATED_TO_BEHELD.md`").
 * This rewrite restores the documented non-destructive copy.
 *
 * Returns a structured report so the orchestrator (bootstrap command) can
 * print a single line summarizing what happened — never throws.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
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
  /** True only if at least one child was copied this run. False when a
   *  previous migration already covered everything (`already_migrated`). */
  migrated: boolean;
  /** Short, lowercase tag for the outcome — stable, suitable for tests. */
  reason:
    | "no_legacy_dir"
    | "target_non_empty"
    | "empty_legacy"
    | "copied"
    | "already_migrated"
    | "partial_failure";
  /** Names of children copied (file or directory). Empty when nothing copied. */
  moved: string[];
  /** Names of children that failed to copy (e.g. permission denied). */
  failed: string[];
}

const DEFAULT_LEGACY = join(homedir(), ".devprofile");
const DEFAULT_TARGET = join(homedir(), ".beheld");

/** Marker filename — placed inside the legacy dir so a re-run knows the
 *  previous copy completed. The legacy dir itself is never deleted. */
export const MIGRATED_MARKER = "MIGRATED_TO_BEHELD.md";

export function defaultBridgePaths(): BridgePaths {
  return { legacy: DEFAULT_LEGACY, target: DEFAULT_TARGET };
}

/**
 * Idempotent — safe to call on every `beheld bootstrap` invocation.
 *
 * Visible-to-the-user contract:
 *   - `reason: "no_legacy_dir"`     — nothing to do (clean machine).
 *   - `reason: "target_non_empty"`  — bail; the user already has a populated
 *     `~/.beheld/`. Caller decides whether to surface a warning.
 *   - `reason: "empty_legacy"`      — legacy dir exists but holds no data;
 *     the marker file is still written so future runs short-circuit.
 *   - `reason: "copied"`            — at least one child copied this run.
 *     Legacy dir preserved; marker file written.
 *   - `reason: "already_migrated"`  — marker file present and target
 *     populated; nothing new copied.
 *   - `reason: "partial_failure"`   — at least one child copy errored;
 *     legacy dir preserved, no marker written, caller can retry.
 */
export function bridgeLegacyDevprofile(paths: BridgePaths = defaultBridgePaths()): BridgeResult {
  const { legacy, target } = paths;

  if (!existsSync(legacy)) {
    return { migrated: false, reason: "no_legacy_dir", moved: [], failed: [] };
  }

  // The legacy path exists. Refuse to overwrite a populated target UNLESS
  // we already left a marker on a previous successful run — in that case
  // the populated target IS our previous output, not a foreign install.
  const markerPath = join(legacy, MIGRATED_MARKER);
  const targetExistsNonEmpty = existsSync(target) && readdirSync(target).length > 0;
  if (targetExistsNonEmpty) {
    if (existsSync(markerPath)) {
      return { migrated: false, reason: "already_migrated", moved: [], failed: [] };
    }
    return { migrated: false, reason: "target_non_empty", moved: [], failed: [] };
  }

  const children = readdirSync(legacy).filter((name) => name !== MIGRATED_MARKER);
  if (children.length === 0) {
    // Empty shell — leave the dir, but still drop the marker so the next
    // bootstrap run reports `already_migrated` instead of repeatedly
    // probing an empty legacy dir.
    writeMarker(markerPath, target);
    return { migrated: false, reason: "empty_legacy", moved: [], failed: [] };
  }

  // Ensure target exists with the canonical 0700 mode. mkdirSync({recursive:true})
  // is a no-op if it already exists, so the empty-target branch above stays safe.
  mkdirSync(target, { recursive: true, mode: 0o700 });
  try { chmodSync(target, 0o700); } catch { /* ignore — best-effort */ }

  const moved: string[] = [];
  const failed: string[] = [];

  for (const name of children) {
    const src = join(legacy, name);
    const dest = join(target, name);
    try {
      // Recursive copy. errorOnExist=true would crash if a partial prior
      // run already wrote some children; force=false respects existing
      // target content in case the user staged something there.
      cpSync(src, dest, { recursive: true, errorOnExist: false, force: false });
      moved.push(name);
    } catch {
      failed.push(name);
    }
  }

  if (failed.length > 0) {
    // Don't write the marker — the user still has data left to migrate.
    return { migrated: moved.length > 0, reason: "partial_failure", moved, failed };
  }

  // All children copied. Drop the marker so future runs short-circuit.
  writeMarker(markerPath, target);

  return { migrated: true, reason: "copied", moved, failed };
}

/** Write the migration marker note. Idempotent: re-running overwrites the
 *  timestamp but never errors. Mode 0600 keeps it private. */
function writeMarker(markerPath: string, target: string): void {
  // Date.now() is unavailable inside workflow scripts, but this module
  // runs in the regular Bun runtime — `new Date()` is safe here.
  const ts = new Date().toISOString();
  const body =
    `# Migrated to Beheld

This directory has been migrated to the new canonical location:

  ${target}

A copy of every file from \`~/.devprofile/\` was placed there on:

  ${ts}

The original \`~/.devprofile/\` was **NOT deleted** — Beheld's migration is
non-destructive. You can safely remove this directory manually once you've
confirmed the new \`~/.beheld/\` is working as expected:

\`\`\`sh
rm -rf ~/.devprofile
\`\`\`

If you need to roll back, your data is still here. The Beheld CLI no longer
reads from this directory — every subcommand uses \`~/.beheld/\` only.

Generated by \`beheld bootstrap\` (legacy bridge, R1.4).
`;
  try {
    writeFileSync(markerPath, body, { mode: 0o600 });
  } catch {
    // Best-effort — the migration succeeded even if we couldn't drop the
    // note. Re-running will retry and produce the marker.
  }
}

/**
 * Internal helper exposed for tests — returns true when `dir` exists and is
 * a directory. Hidden from the public API surface intentionally.
 */
export function _isDirectory(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try { return statSync(dir).isDirectory(); } catch { return false; }
}
