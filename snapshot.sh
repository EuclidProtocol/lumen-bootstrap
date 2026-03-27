#!/bin/bash
set -eo pipefail

# Run from the repo root (same directory as Makefile / docker-compose.yml).

ENABLE_SUDO=${ENABLE_SUDO:-false}

if [[ "$ENABLE_SUDO" == "true" ]]; then
    SUDO="sudo"
else
    SUDO=""
fi

REPO_ROOT="$(pwd)"
SNAPSHOT_DIR="$REPO_ROOT/snapshots"
RPC_PORT="${RPC_PORT:-26657}"

# Set these to enable upload after snapshot creation.
# RCLONE_REMOTE: rclone remote name as configured in ~/.config/rclone/rclone.conf
# RCLONE_BUCKET: bucket name, e.g. euclid-snapshots
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
RCLONE_BUCKET="${RCLONE_BUCKET:-euclid-snapshots}"

echo "==> Checking required binaries..."
MISSING=()
for bin in curl jq tar lz4 make docker; do
    command -v "$bin" &>/dev/null || MISSING+=("$bin")
done
if [[ -n "$RCLONE_REMOTE" ]]; then
    command -v rclone &>/dev/null || MISSING+=("rclone")
fi
if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo "ERROR: missing required binaries: ${MISSING[*]}"
    exit 1
fi
echo "    All binaries present."

mkdir -p "$SNAPSHOT_DIR"

echo "==> Fetching chain info..."
STATUS=$(curl -s "http://localhost:${RPC_PORT}/status")
BLOCK_HEIGHT=$(echo "$STATUS" | jq -r '.result.sync_info.latest_block_height')
CHAIN_ID=$(echo "$STATUS" | jq -r '.result.node_info.network')
echo "    Chain ID:     $CHAIN_ID"
echo "    Block height: $BLOCK_HEIGHT"

CHAIN_HOME="$REPO_ROOT/.config/$CHAIN_ID"
FILENAME="${CHAIN_ID}_${BLOCK_HEIGHT}.tar.lz4"

# Auto-detect wasm location
if [[ -d "$CHAIN_HOME/wasm" ]]; then
    WASM="outside"
elif [[ -d "$CHAIN_HOME/data/wasm" ]]; then
    WASM="inside"
else
    WASM=""
fi
echo "    Wasm:         ${WASM:-none}"

echo "==> Stopping service..."
$SUDO make -C "$REPO_ROOT" stop

echo "==> Compressing snapshot -> $SNAPSHOT_DIR/$FILENAME"
cd "$CHAIN_HOME"


if [[ "$WASM" == "outside" ]]; then
    WASM_FILENAME="${FILENAME}_wasmonly.tar.lz4"
    $SUDO tar --exclude=wasm/wasm/cache -cvf - data wasm | $SUDO lz4 > "$SNAPSHOT_DIR/$FILENAME"
    $SUDO tar --exclude=wasm/wasm/cache -cvf - wasm                              | $SUDO lz4 > "$SNAPSHOT_DIR/$WASM_FILENAME"
    echo "    Wasm-only snapshot -> $SNAPSHOT_DIR/$WASM_FILENAME"
elif [[ "$WASM" == "inside" ]]; then
    WASM_FILENAME="${FILENAME}_wasmonly.tar.lz4"
    $SUDO tar --exclude=data/wasm/cache -cvf - data | $SUDO lz4 > "$SNAPSHOT_DIR/$FILENAME"
    cd data
    $SUDO tar --exclude=wasm/cache -cvf - wasm                              | $SUDO lz4 > "$SNAPSHOT_DIR/$WASM_FILENAME"
    echo "    Wasm-only snapshot -> $SNAPSHOT_DIR/$WASM_FILENAME"
else
    $SUDO tar "${COMMON_EXCLUDES[@]}" -cvf - data | $SUDO lz4 > "$SNAPSHOT_DIR/$FILENAME"
fi

echo "==> Starting service..."
$SUDO make -C "$REPO_ROOT" startd

echo "==> Done. Snapshot saved to $SNAPSHOT_DIR/$FILENAME"

if [[ -n "$RCLONE_REMOTE" ]]; then
    echo "==> Uploading snapshot to $RCLONE_REMOTE:$RCLONE_BUCKET/$CHAIN_ID/..."
    $SUDO rclone copy "$SNAPSHOT_DIR/$FILENAME" "$RCLONE_REMOTE:$RCLONE_BUCKET/$CHAIN_ID/" --progress --disable-http2
    echo "    Uploaded $FILENAME"

    if [[ -n "$WASM_FILENAME" ]]; then
        $SUDO rclone copy "$SNAPSHOT_DIR/$WASM_FILENAME" "$RCLONE_REMOTE:$RCLONE_BUCKET/$CHAIN_ID/" --progress --disable-http2
        echo "    Uploaded $WASM_FILENAME"
    fi
fi
