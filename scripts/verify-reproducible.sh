#!/usr/bin/env bash
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE_DIST="${REPO_ROOT}/packages/engine/dist"

echo "==> Reproducible build verification (2 sequential builds)"

bash "${REPO_ROOT}/scripts/build.sh"
HASH1="$(cat "${ENGINE_DIST}/beheld-engine.sha256")"
cp "${ENGINE_DIST}/beheld-engine" "${ENGINE_DIST}/beheld-engine.build1"

bash "${REPO_ROOT}/scripts/build.sh"
HASH2="$(cat "${ENGINE_DIST}/beheld-engine.sha256")"

if [ "${HASH1}" = "${HASH2}" ]; then
  echo ""
  echo "✓ Reproducible: ${HASH1}"
  rm -f "${ENGINE_DIST}/beheld-engine.build1"
  exit 0
fi

echo ""
echo "✗ Não-determinístico"
echo "  Build 1: ${HASH1}"
echo "  Build 2: ${HASH2}"

if command -v pyinstxtractor > /dev/null 2>&1; then
  echo ""
  echo "==> Inspecting differences via pyinstxtractor..."
  pyinstxtractor "${ENGINE_DIST}/beheld-engine.build1" || true
  pyinstxtractor "${ENGINE_DIST}/beheld-engine" || true
fi

exit 1
