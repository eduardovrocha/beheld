#!/usr/bin/env sh
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="${REPO_ROOT}/dist"

mkdir -p "$DIST_DIR"
mkdir -p "${REPO_ROOT}/packages/cli/assets"

echo "==> Building devprofile-engine (Python/PyInstaller)..."
cd "${REPO_ROOT}/packages/engine"

if ! command -v pyinstaller > /dev/null 2>&1; then
  echo "    pyinstaller not found — skipping engine build."
  echo "    Install with: pip install pyinstaller"
  echo "    Engine binary required for full build."
else
  pyinstaller \
    --onefile \
    --name devprofile-engine \
    --distpath dist \
    src/main.py

  cp dist/devprofile-engine "${REPO_ROOT}/packages/cli/assets/devprofile-engine"
  echo "    Engine → packages/cli/assets/devprofile-engine"
fi

echo ""
echo "==> Building devprofile CLI (TypeScript/Bun)..."
cd "$REPO_ROOT"

bun build packages/cli/src/index.ts \
  --compile \
  --outfile dist/devprofile

echo "    CLI    → dist/devprofile"
echo ""
echo "==> Smoke test..."
dist/devprofile --version
echo ""
echo "Build complete."
