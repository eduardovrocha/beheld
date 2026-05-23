#!/usr/bin/env sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/dist"
CLI_ASSETS="${SCRIPT_DIR}/../cli/assets"

echo "Building beheld-engine with PyInstaller..."

cd "$SCRIPT_DIR"

pyinstaller \
  --onefile \
  --name beheld-engine \
  --distpath "$OUTPUT_DIR" \
  src/main.py

echo "Engine binary: ${OUTPUT_DIR}/beheld-engine"

if [ -d "$CLI_ASSETS" ]; then
  cp "${OUTPUT_DIR}/beheld-engine" "${CLI_ASSETS}/beheld-engine"
  echo "Copied to CLI assets: ${CLI_ASSETS}/beheld-engine"
fi
