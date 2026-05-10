#!/usr/bin/env sh
set -e

INSTALL_DIR="${HOME}/.local/bin"
BINARY="devprofile"
REPO="devprofile/devprofile"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64)        ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

case "$OS" in
  linux|darwin) ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

BINARY_NAME="${BINARY}-${OS}-${ARCH}"

echo "Fetching latest release..."
VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep '"tag_name"' \
  | head -1 \
  | cut -d'"' -f4)"

if [ -z "$VERSION" ]; then
  echo "Failed to fetch latest version. Check your internet connection."
  exit 1
fi

BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"
DOWNLOAD_URL="${BASE_URL}/${BINARY_NAME}"
CHECKSUM_URL="${BASE_URL}/${BINARY_NAME}.sha256"

TMP_BIN="$(mktemp)"
TMP_SUM="$(mktemp)"

cleanup() {
  rm -f "$TMP_BIN" "$TMP_SUM"
}
trap cleanup EXIT

echo "Downloading DevProfile ${VERSION} for ${OS}-${ARCH}..."
curl -fsSL "$DOWNLOAD_URL" -o "$TMP_BIN"
curl -fsSL "$CHECKSUM_URL" -o "$TMP_SUM"

echo "Verifying checksum..."
EXPECTED="$(cat "$TMP_SUM" | awk '{print $1}')"
if command -v sha256sum > /dev/null 2>&1; then
  ACTUAL="$(sha256sum "$TMP_BIN" | awk '{print $1}')"
elif command -v shasum > /dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "$TMP_BIN" | awk '{print $1}')"
else
  echo "sha256sum or shasum not found — cannot verify checksum."
  exit 1
fi

if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Checksum mismatch! Download may be corrupted."
  echo "Expected: $EXPECTED"
  echo "Got:      $ACTUAL"
  exit 1
fi

echo "Checksum verified."

mkdir -p "$INSTALL_DIR"
mv "$TMP_BIN" "${INSTALL_DIR}/${BINARY}"
chmod +x "${INSTALL_DIR}/${BINARY}"

if ! echo ":${PATH}:" | grep -q ":${INSTALL_DIR}:"; then
  echo ""
  echo "NOTE: Add ${INSTALL_DIR} to your PATH:"
  echo "  export PATH=\"\${HOME}/.local/bin:\${PATH}\""
fi

echo ""
echo "DevProfile ${VERSION} installed to ${INSTALL_DIR}/${BINARY}"
echo "Running setup wizard..."
echo ""

"${INSTALL_DIR}/${BINARY}" init
