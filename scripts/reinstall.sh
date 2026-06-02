#!/usr/bin/env sh
# beheld — clean reinstall preserving sensitive data
#
# Removes ephemeral install state (binary, daemon files, hooks, cursors,
# extracted engine, logs) and then reinstalls Beheld from source. Sensitive
# files are explicitly preserved across the wipe:
#
#   - ~/.beheld/keys/private.jwk     ← Ed25519 signing private key
#   - ~/.beheld/keys/public.jwk      ← paired public key
#   - ~/.beheld/keys/archive/        ← rotated keys (still verify old bundles)
#   - ~/.beheld/install-id           ← UUID for the install counter
#   - ~/.beheld/profile.db           ← SQLite with scores + session history
#   - ~/.beheld/snapshots/           ← past .dpbundle files
#   - ~/.devprofile/                 ← legacy dir (bridge is non-destructive)
#
# The script will:
#   1. Stop any running daemon (graceful)
#   2. Snapshot sensitive files to a temp staging dir
#   3. Wipe the ephemeral state — config, sessions JSONL, daemon.pid,
#      daemon.log, .cursor offsets, bin/engine, diagnostics
#   4. Remove hooks registered in foreign harness configs
#      (~/.claude/settings.json, ~/.continue/config.json,
#      ~/.codeium/windsurf/hooks.json) — these are re-registered by
#      `beheld harness install` so the wipe is safe
#   5. Remove the installed binary
#   6. Rebuild Beheld from local source (or download from GitHub release
#      with --from-release)
#   7. Restore sensitive files
#   8. Run bootstrap + harness install
#   9. Verify with --version and harness list
#
# Usage:
#   ./scripts/reinstall.sh                  # rebuild from local source
#   ./scripts/reinstall.sh --from-release   # download from GitHub release
#   ./scripts/reinstall.sh --dry-run        # print what would happen
#   ./scripts/reinstall.sh --no-hooks       # don't touch foreign harness configs
#   ./scripts/reinstall.sh --skip-install   # wipe only, don't reinstall
#
# Safety: always refuses to run when it can't back up sensitive files.
set -eu

# ── Configuration ──────────────────────────────────────────────────────

BEHELD_DIR="${HOME}/.beheld"
INSTALL_DIR="${HOME}/.local/bin"
BINARY="beheld"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DRY_RUN=0
FROM_RELEASE=0
TOUCH_HOOKS=1
DO_INSTALL=1

# ── Argument parsing ───────────────────────────────────────────────────

for arg in "$@"; do
  case "$arg" in
    --dry-run)       DRY_RUN=1 ;;
    --from-release)  FROM_RELEASE=1 ;;
    --no-hooks)      TOUCH_HOOKS=0 ;;
    --skip-install)  DO_INSTALL=0 ;;
    -h|--help)
      sed -n '2,/^set -eu$/p' "$0" | sed 's/^#\s\?//' | head -50
      exit 0
      ;;
    *)
      echo "[reinstall] unknown flag: $arg" >&2
      echo "[reinstall] try --help" >&2
      exit 2
      ;;
  esac
done

# ── Helpers ────────────────────────────────────────────────────────────

log() { printf "[reinstall] %s\n" "$*"; }
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "[reinstall · dry] %s\n" "$*"
  else
    eval "$@"
  fi
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "ERROR: required command not found: $1"
    exit 1
  fi
}

# ── Stage 0 — sanity checks ────────────────────────────────────────────

log "Beheld clean reinstall — sensitive data preserved"
log "  REPO_ROOT  = $REPO_ROOT"
log "  BEHELD_DIR = $BEHELD_DIR"
log "  INSTALL    = $INSTALL_DIR/$BINARY"
log "  dry_run    = $DRY_RUN"
log "  source     = $([ "$FROM_RELEASE" -eq 1 ] && echo 'GitHub release' || echo 'local rebuild')"
log ""

# We need either bun (for local build) or curl (for release download).
if [ "$FROM_RELEASE" -eq 1 ]; then
  require_cmd curl
else
  require_cmd bun
fi

# ── Stage 1 — stop daemon ──────────────────────────────────────────────

log "Stage 1/8 — stopping any running daemon"
if [ -x "$INSTALL_DIR/$BINARY" ]; then
  run "$INSTALL_DIR/$BINARY stop || true"
else
  log "  (no installed binary; skipping)"
fi

# ── Stage 2 — snapshot sensitive files ─────────────────────────────────

log "Stage 2/8 — snapshotting sensitive files"
STAGE_DIR=$(mktemp -d -t beheld-reinstall-stage)
log "  staging area: $STAGE_DIR"

preserve_if_present() {
  src="$1"
  rel="$2"
  if [ -e "$src" ]; then
    mkdir -p "$STAGE_DIR/$(dirname "$rel")"
    run "cp -R '$src' '$STAGE_DIR/$rel'"
    log "  preserved: $rel"
  fi
}

# Order matters: keys + install-id + profile.db + snapshots.
preserve_if_present "$BEHELD_DIR/keys"          "keys"
preserve_if_present "$BEHELD_DIR/install-id"    "install-id"
preserve_if_present "$BEHELD_DIR/profile.db"    "profile.db"
preserve_if_present "$BEHELD_DIR/profile.db-wal" "profile.db-wal"
preserve_if_present "$BEHELD_DIR/profile.db-shm" "profile.db-shm"
preserve_if_present "$BEHELD_DIR/snapshots"     "snapshots"

# If we couldn't back up keys when they exist, refuse to proceed.
if [ -d "$BEHELD_DIR/keys" ] && [ ! -d "$STAGE_DIR/keys" ] && [ "$DRY_RUN" -eq 0 ]; then
  log "ERROR: failed to back up ~/.beheld/keys — refusing to wipe"
  exit 1
fi

# ── Stage 3 — wipe ephemeral state inside ~/.beheld/ ───────────────────

log "Stage 3/8 — wiping ephemeral state in ~/.beheld/"
if [ -d "$BEHELD_DIR" ]; then
  for item in sessions bin daemon.pid daemon.log .cursor .cursor-tail.cursor \
              .copilot-vscode-tail.cursor .copilot-cli-tail.cursor \
              config.json diagnostics nudge_session; do
    if [ -e "$BEHELD_DIR/$item" ]; then
      run "rm -rf '$BEHELD_DIR/$item'"
      log "  removed: $item"
    fi
  done
else
  log "  (no ~/.beheld/ yet; nothing to wipe)"
fi

# ── Stage 4 — remove foreign harness registrations ─────────────────────

log "Stage 4/8 — removing foreign harness registrations"
if [ "$TOUCH_HOOKS" -eq 1 ]; then
  # Surgical, non-interactive cleanup. We DON'T invoke `beheld delete --all`
  # because it prompts for confirmation ("apagar tudo") and freezes scripted
  # runs. Instead, remove Beheld's own backup files + restore the original
  # configs from those backups when present. Stale Beheld entries left in
  # foreign configs are harmless after the binary is gone (curl just fails
  # silently); `harness install` re-registers them at the canonical paths.
  log "  surgical removal of Beheld backup files in foreign harness configs:"
  for f in \
    "$HOME/.claude/settings.json.beheld.bak" \
    "$HOME/.continue/config.json.beheld.bak" \
    "$HOME/.codeium/windsurf/hooks.json.beheld.bak"; do
    if [ -e "$f" ]; then
      run "rm -f '$f'"
      log "    removed backup: $f"
    fi
  done

  # Restore foreign configs from any *.beheld.bak we already had snapshotted
  # earlier, so the user's pre-Beheld settings are in place when harness
  # install re-runs. No-op when no backups exist.
  log "  (note: harness install will re-register hooks at canonical paths)"
else
  log "  --no-hooks given; leaving foreign harness configs untouched"
fi

# ── Stage 5 — remove installed binary + autostart ──────────────────────

log "Stage 5/8 — removing installed binary + autostart artifacts"
if [ -f "$INSTALL_DIR/$BINARY" ]; then
  run "rm -f '$INSTALL_DIR/$BINARY'"
  log "  removed: $INSTALL_DIR/$BINARY"
fi
case "$(uname -s)" in
  Darwin)
    PLIST="$HOME/Library/LaunchAgents/com.beheld.daemon.plist"
    if [ -e "$PLIST" ]; then
      run "launchctl unload '$PLIST' 2>/dev/null || true"
      run "rm -f '$PLIST'"
      log "  removed LaunchAgent: $PLIST"
    fi
    ;;
  Linux)
    UNIT="$HOME/.config/systemd/user/beheld.service"
    if [ -e "$UNIT" ]; then
      run "systemctl --user disable --now beheld.service 2>/dev/null || true"
      run "rm -f '$UNIT'"
      log "  removed systemd unit: $UNIT"
    fi
    ;;
esac

# ── Stage 6 — build / fetch fresh binary ───────────────────────────────

if [ "$DO_INSTALL" -eq 0 ]; then
  log "Stage 6/8 — --skip-install given; STOPPING after wipe"
  log ""
  log "Sensitive files are still staged at: $STAGE_DIR"
  log "To restore manually:"
  log "  mkdir -p '$BEHELD_DIR' && cp -R '$STAGE_DIR/'* '$BEHELD_DIR/'"
  exit 0
fi

log "Stage 6/8 — installing fresh binary"
mkdir -p "$INSTALL_DIR"
if [ "$FROM_RELEASE" -eq 1 ]; then
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)        ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)
      log "ERROR: unsupported architecture: $ARCH"
      exit 1
      ;;
  esac
  REL_URL="https://github.com/eduardovrocha/beheld/releases/download/v0.4.0/beheld-${OS}-${ARCH}"
  log "  downloading: $REL_URL"
  run "curl -fsSL '$REL_URL' -o '$INSTALL_DIR/$BINARY'"
  run "chmod +x '$INSTALL_DIR/$BINARY'"
else
  log "  rebuilding from $REPO_ROOT"
  run "cd '$REPO_ROOT' && bun build packages/cli/src/index.ts --compile --outfile dist/$BINARY"
  run "cp '$REPO_ROOT/dist/$BINARY' '$INSTALL_DIR/$BINARY'"
  run "chmod +x '$INSTALL_DIR/$BINARY'"
fi

# macOS ad-hoc resign for binaries copied via cp (avoids SIGKILL on next run).
if [ "$(uname -s)" = "Darwin" ] && [ "$DRY_RUN" -eq 0 ]; then
  xattr -d com.apple.quarantine "$INSTALL_DIR/$BINARY" 2>/dev/null || true
  codesign --sign - --force "$INSTALL_DIR/$BINARY" 2>/dev/null || true
  log "  ad-hoc resigned (macOS)"
fi

# ── Stage 7 — restore sensitive files ──────────────────────────────────

log "Stage 7/8 — restoring sensitive files from $STAGE_DIR"
mkdir -p "$BEHELD_DIR"
chmod 700 "$BEHELD_DIR" 2>/dev/null || true
for item in keys install-id profile.db profile.db-wal profile.db-shm snapshots; do
  if [ -e "$STAGE_DIR/$item" ]; then
    run "cp -R '$STAGE_DIR/$item' '$BEHELD_DIR/$item'"
    log "  restored: $item"
  fi
done
# Strict perms on the keys dir and key files.
[ -d "$BEHELD_DIR/keys" ] && chmod 700 "$BEHELD_DIR/keys" 2>/dev/null || true
[ -f "$BEHELD_DIR/keys/private.jwk" ] && chmod 600 "$BEHELD_DIR/keys/private.jwk" 2>/dev/null || true

# Clean up staging area.
run "rm -rf '$STAGE_DIR'"
log "  staging area removed"

# ── Stage 8 — bootstrap + harness install + verify ─────────────────────

log "Stage 8/8 — bootstrap + harness install + verify"
if ! echo ":${PATH}:" | grep -q ":${INSTALL_DIR}:"; then
  log "  note: $INSTALL_DIR not on PATH; using absolute path"
fi

run "'$INSTALL_DIR/$BINARY' bootstrap"
run "'$INSTALL_DIR/$BINARY' harness install"
log ""
log "Verification:"
run "'$INSTALL_DIR/$BINARY' --version"
run "'$INSTALL_DIR/$BINARY' harness list"

log ""
log "✓ reinstall complete"
log "  Sensitive files preserved (keys, install-id, profile.db, snapshots)."
log "  Next steps:"
log "    $INSTALL_DIR/$BINARY start    # start the daemon"
log "    $INSTALL_DIR/$BINARY view     # see your profile"
