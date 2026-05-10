#!/usr/bin/env sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/dist"
CLI_ASSETS="${SCRIPT_DIR}/../cli/assets"

echo "Building devprofile-engine with PyInstaller..."

cd "$SCRIPT_DIR"

pyinstaller \
  --onefile \
  --name devprofile-engine \
  --distpath "$OUTPUT_DIR" \
  src/main.py

echo "Engine binary: ${OUTPUT_DIR}/devprofile-engine"

if [ -d "$CLI_ASSETS" ]; then
  cp "${OUTPUT_DIR}/devprofile-engine" "${CLI_ASSETS}/devprofile-engine"
  echo "Copied to CLI assets: ${CLI_ASSETS}/devprofile-engine"
fi
