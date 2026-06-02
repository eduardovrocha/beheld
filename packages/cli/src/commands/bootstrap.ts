/**
 * R1.4 — `beheld bootstrap`: the L1-first onboarding entry point.
 *
 * Spec §R1.4 (docs/beheld-estado-atual.md row R1.4):
 *   "`npx beheld` L1-first onboarding + extensão de `packages/cli` com
 *    subcomando `bootstrap`."
 *
 * The historical onboarding (`beheld init`) focused on harness wiring —
 * Claude Code hooks + Continue.dev MCP. That made L2 (session telemetry)
 * the de-facto spine: until the user actually used a coached harness, the
 * profile was empty. R1 flipped the design: L1 (git history) is the
 * backbone, harnesses are additive enrichment.
 *
 * `bootstrap` is the canonical sequence for new and upgrading users:
 *
 *   1. Legacy bridge — best-effort migrate `~/.devprofile/` → `~/.beheld/`.
 *      Idempotent: a clean machine is a no-op. Mode 0700 enforced.
 *
 *   2. Ensure `~/.beheld/` exists with the canonical 0700 permission. The
 *      daemon-manager helper handles existing-but-loose installations.
 *
 *   3. Surface the L1 import invitation. By default we print the next-step
 *      pointer; with `--import` we delegate straight into `runImport({})`
 *      so the user can pick up where the wizard would have led.
 *
 *   4. Pointer to `beheld init` for harness wiring (optional, by design —
 *      a dev who never uses a coached harness still gets L1 scores).
 *
 * Privacy invariant carried in: no prompt content, no commit messages, no
 * branch names — bootstrap only touches paths and process state.
 *
 * Distribution invariant: bootstrap must run on the standalone binary with
 * zero Node.js / Python on the host. Everything below uses only built-in
 * fs / os / path APIs and delegates to existing in-binary commands.
 */
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { bridgeLegacyDevprofile, defaultBridgePaths, type BridgeResult } from "../lib/legacy-bridge";
import { ensureSecurePermissions } from "../daemon-manager";
import { ok, warn, arrow, meta, bold, brand, DIM, RESET } from "../ui/styles";

export interface BootstrapOptions {
  /** When true, immediately enter the L1 import wizard after the bridge. */
  import?: boolean;
  /** Internal: override the legacy / target paths (used by tests). */
  paths?: { legacy: string; target: string };
  /** Internal: capture log output instead of stdout (used by tests). */
  logger?: (line: string) => void;
}

/**
 * Public summary of a bootstrap run — surfaced to tests so callers can
 * assert on the outcome without parsing the printed lines. The command
 * itself does NOT return this from the binary entry (it prints + exits).
 */
export interface BootstrapResult {
  bridge: BridgeResult;
  beheldDir: string;
  importInvited: boolean;
}

const HOME_BEHELD = join(homedir(), ".beheld");

export async function bootstrapCommand(opts: BootstrapOptions = {}): Promise<BootstrapResult> {
  const log = opts.logger ?? ((line: string) => console.log(line));
  const paths = opts.paths ?? defaultBridgePaths();
  const target = paths.target;

  // Header — keep it short and lowercase to match the rest of the CLI tone.
  log(`${brand("beheld")} ${DIM}bootstrap${RESET}`);
  log("");

  // ── 1. Legacy bridge ────────────────────────────────────────────────────
  // D-01 fix — bridge now COPIES, never moves; ~/.devprofile is preserved
  // and a MIGRATED_TO_BEHELD.md marker is dropped inside the legacy dir.
  const bridge = bridgeLegacyDevprofile(paths);
  switch (bridge.reason) {
    case "no_legacy_dir":
      // No-op — print only in verbose contexts. Keep silent to avoid noise
      // for the 99% of users who never had ~/.devprofile.
      break;
    case "empty_legacy":
      log(meta("  → ~/.devprofile is empty (preserved; marker file written)"));
      break;
    case "copied":
      log(ok(`  ✓ copied ${bridge.moved.length} item(s) from ~/.devprofile → ~/.beheld`));
      log(meta("    Original ~/.devprofile preserved + MIGRATED_TO_BEHELD.md marker written."));
      break;
    case "already_migrated":
      log(meta("  → ~/.devprofile already migrated (marker present); skipping copy"));
      break;
    case "target_non_empty":
      log(warn("  ! ~/.devprofile detected but ~/.beheld already populated"));
      log(meta("    Skipping migration — inspect both directories before deciding."));
      break;
    case "partial_failure":
      log(warn(`  ! partial copy: ${bridge.moved.length} copied, ${bridge.failed.length} failed`));
      log(meta(`    Failed: ${bridge.failed.join(", ")}`));
      log(meta("    ~/.devprofile preserved — rerun bootstrap after fixing permissions."));
      break;
  }

  // ── 2. Ensure ~/.beheld/ + 0700 perms ───────────────────────────────────
  // mkdirSync is a no-op if the bridge already created it (moved branch),
  // and the canonical setup-from-scratch path otherwise.
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true, mode: 0o700 });
  }
  ensureSecurePermissions(target);
  log(ok(`  ✓ ~/.beheld ready (mode 0700)`));
  log("");

  // ── 3. L1-first invitation ──────────────────────────────────────────────
  let importInvited = false;
  if (opts.import) {
    importInvited = true;
    log(arrow("running L1 import wizard..."));
    log("");
    // Lazy-load the import command so the bootstrap binary footprint stays
    // tight when --import isn't passed.
    const { runImport } = await import("./import");
    await runImport({ url: undefined });
  } else {
    log(bold("Next steps"));
    log(`  ${arrow("beheld import")}        ${DIM}— import git history (L1)${RESET}`);
    log(`  ${arrow("beheld init")}          ${DIM}— wire Claude Code + Continue.dev hooks${RESET}`);
    log(`  ${arrow("beheld view")}          ${DIM}— see your profile${RESET}`);
    log("");
    log(meta("Tip: rerun with --import to enter the L1 wizard now."));
  }

  return { bridge, beheldDir: target, importInvited };
}
