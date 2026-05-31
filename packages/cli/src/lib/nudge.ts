/**
 * Bundle-age nudge (P22 — incentivo de atualização).
 *
 * Spec section 8 — at any `beheld` command:
 *   - If the latest local snapshot is ≥ 5 days old, print a soft reminder
 *     telling the dev to regenerate the profile. Never blocks the command.
 *   - "Shown once per terminal session" — we approximate this by recording
 *     the parent shell PID + a 1-hour TTL into ~/.beheld/.nudge_session,
 *     so consecutive commands in the same shell stay quiet.
 *
 * Distinguished from the 30-day "perfil desatualizado" badge (public,
 * visible to recruiters): this nudge is internal and never surfaces beyond
 * the dev's own terminal.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME           = process.env.BEHELD_HOME ?? path.join(os.homedir(), ".beheld");
const SNAPSHOTS_DIR  = path.join(HOME, "snapshots");
const SESSION_MARKER = path.join(HOME, ".nudge_session");

const STALE_AFTER_DAYS = 5;
const SUPPRESS_TTL_MS  = 60 * 60 * 1000;   // 1h between repeats across shells

export function maybeShowBundleNudge(): void {
  // Don't spam non-interactive pipelines / hook runs / CI.
  if (!process.stdout.isTTY && !process.env.BEHELD_FORCE_NUDGE) return;
  if (alreadyShownThisSession()) return;

  const age = latestBundleAgeDays();
  if (age == null || age < STALE_AFTER_DAYS) return;

  const days = Math.floor(age);
  // stderr so we don't pollute scripts that pipe stdout (e.g. `beheld view --json | jq …`).
  process.stderr.write(
    `\n→ Seu bundle tem ${days} dia${days === 1 ? "" : "s"}.\n` +
    `  Atualize para enriquecer sua curva de evolução: beheld snapshot\n\n`,
  );

  markShown();
}

// ── helpers ─────────────────────────────────────────────────────────────────

function alreadyShownThisSession(): boolean {
  try {
    if (!existsSync(SESSION_MARKER)) return false;
    const [ppid, tsRaw] = readFileSync(SESSION_MARKER, "utf-8").trim().split(":");
    const ts = Number(tsRaw);
    if (!Number.isFinite(ts)) return false;
    // Same parent shell → already nudged this session.
    if (ppid === String(process.ppid)) return true;
    // Different shell but recent → still suppress (tmux/iTerm panes).
    if (Date.now() - ts < SUPPRESS_TTL_MS) return true;
  } catch {
    // Corrupt marker or permission issue — treat as "not shown" and rewrite.
  }
  return false;
}

function markShown(): void {
  try {
    if (!existsSync(HOME)) mkdirSync(HOME, { recursive: true, mode: 0o700 });
    writeFileSync(SESSION_MARKER, `${process.ppid}:${Date.now()}`);
  } catch {
    // Failing to write the marker just means we'll re-prompt next time —
    // not worth surfacing as a user-facing error.
  }
}

function latestBundleAgeDays(): number | null {
  try {
    if (!existsSync(SNAPSHOTS_DIR)) return null;
    const entries = readdirSync(SNAPSHOTS_DIR)
      .filter((f) => /\.(beheld|dpbundle)$/.test(f))
      .map((f) => {
        try { return { file: f, mtime: statSync(path.join(SNAPSHOTS_DIR, f)).mtimeMs }; }
        catch { return null; }
      })
      .filter((x): x is { file: string; mtime: number } => x !== null)
      .sort((a, b) => b.mtime - a.mtime);

    if (entries.length === 0) return null;
    return (Date.now() - entries[0].mtime) / (1000 * 60 * 60 * 24);
  } catch {
    return null;
  }
}
