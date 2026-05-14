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

# Engine endpoint smoke — only when the engine binary was actually built.
# Verifies the coach feature (workflow_metrics + /coach payload) is reachable
# end-to-end on a fresh install before shipping a release.
if [ -f "${REPO_ROOT}/packages/cli/assets/devprofile-engine" ]; then
  echo ""
  echo "==> Engine smoke (coach + workflow_metrics)..."
  SMOKE_HOME="$(mktemp -d)"
  SMOKE_PORT=17499
  trap 'rm -rf "${SMOKE_HOME}"; [ -n "${ENGINE_PID:-}" ] && kill "${ENGINE_PID}" 2>/dev/null || true' EXIT

  DEVPROFILE_DATA_DIR="${SMOKE_HOME}" \
    "${REPO_ROOT}/packages/cli/assets/devprofile-engine" \
    --port "${SMOKE_PORT}" \
    > "${SMOKE_HOME}/engine.log" 2>&1 &
  ENGINE_PID=$!

  # Wait for engine to come up (max ~5s)
  ATTEMPTS=0
  until curl -sf "http://127.0.0.1:${SMOKE_PORT}/health" > /dev/null 2>&1; do
    ATTEMPTS=$((ATTEMPTS + 1))
    if [ "$ATTEMPTS" -ge 25 ]; then
      echo "    ✗ engine did not respond on /health after 5s"
      cat "${SMOKE_HOME}/engine.log" || true
      exit 1
    fi
    sleep 0.2
  done

  for endpoint in /health /coach /metrics/workflow; do
    if curl -sf "http://127.0.0.1:${SMOKE_PORT}${endpoint}" > /dev/null; then
      echo "    ✓ ${endpoint}"
    else
      echo "    ✗ ${endpoint} returned non-2xx"
      cat "${SMOKE_HOME}/engine.log" || true
      exit 1
    fi
  done

  kill "${ENGINE_PID}" 2>/dev/null || true
  wait "${ENGINE_PID}" 2>/dev/null || true
  unset ENGINE_PID
fi

echo ""
echo "Build complete."
