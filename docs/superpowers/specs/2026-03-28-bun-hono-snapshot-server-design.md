# Bun + Hono Snapshot Server Design

## Context

The current snapshot workflow is a bash script (`snapshot.sh`) that creates blockchain snapshots, compresses them, and uploads to Hetzner Object Storage via rclone. There is no HTTP API for querying available snapshots from the remote storage.

This design replaces `snapshot.sh` with a TypeScript codebase running on Bun, split into two entry points: a CLI tool for snapshot creation/upload and a Hono HTTP server for querying snapshot metadata from S3-compatible storage.

## Architecture: CLI + Server Hybrid

Two entry points sharing a common library layer.

```
src/
  cli.ts              # CLI entry point
  server.ts           # Hono server entry point
  config.ts           # Shared env-based configuration
  lib/
    chain.ts          # Chain RPC queries
    docker.ts         # Docker compose stop/start
    compress.ts       # tar + lz4 compression
    storage.ts        # S3 client abstraction
  routes/
    snapshots.ts      # Snapshot API routes
package.json
bunfig.toml
```

Both run standalone on the host (outside Docker). The blockchain node continues running in Docker via docker-compose.

## CLI (`src/cli.ts`)

Replaces `snapshot.sh`. Single command: `bun run src/cli.ts snapshot`

### Workflow

1. Query chain RPC (`http://localhost:{RPC_PORT}/status`) for block height and chain ID
2. Auto-detect wasm location (`$CHAIN_HOME/wasm` vs `$CHAIN_HOME/data/wasm`)
3. Stop the node: `docker compose down` (with optional sudo)
4. Compress chain data: `tar -cvf - data [wasm] | lz4 > {filename}` via `Bun.spawn`
5. Upload `{chain_id}_{height}.tar.lz4` to S3 bucket via `@aws-sdk/client-s3`
6. If wasm exists outside data dir, create and upload separate `{chain_id}_{height}_wasmonly.tar.lz4`
7. Restart node: `docker compose up -d --build`
8. Delete local snapshot files

### Preserved behaviors from snapshot.sh

- `ENABLE_SUDO` support for docker/tar/lz4 commands
- wasm inside/outside auto-detection
- Separate wasm-only archive when wasm is outside data dir
- wasm cache exclusion (`--exclude=wasm/wasm/cache`)
- Local file cleanup after successful upload

## Server (`src/server.ts`)

Hono HTTP server running on a configurable port (default 3000).

### Endpoints

**`GET /health`**
Returns `{ status: "ok" }`.

**`GET /snapshots`**
Lists all snapshots from the S3 bucket. Parses object keys matching `{chain_id}_{height}.tar.lz4` pattern.

Response:
```json
[
  {
    "chain_id": "lumen-1",
    "height": 1234567,
    "filename": "lumen-1_1234567.tar.lz4",
    "size": 1073741824,
    "last_modified": "2026-03-28T12:00:00Z",
    "url": "https://..."
  }
]
```

**`GET /snapshots/latest`**
Returns metadata for the snapshot with the highest block height. Same response shape as a single item from `/snapshots`.

**`GET /snapshots/:height`**
Returns metadata for the snapshot at the specified block height. 404 if not found.

All endpoints include a pre-signed S3 download URL (configurable expiry, default 1 hour).

## Storage Layer (`src/lib/storage.ts`)

Uses `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` with configurable endpoint to support any S3-compatible provider (AWS, Hetzner, MinIO).

### Configuration

```
S3_ENDPOINT       — Custom endpoint URL (omit for AWS)
S3_REGION         — Region identifier
S3_ACCESS_KEY_ID  — Access key
S3_SECRET_ACCESS_KEY — Secret key
S3_BUCKET         — Bucket name
S3_FORCE_PATH_STYLE — true for non-AWS providers
S3_PRESIGN_EXPIRY — Pre-signed URL expiry in seconds (default 3600)
```

### Methods

- `listSnapshots(prefix?)` — ListObjectsV2, parse keys to extract chain_id and height
- `uploadSnapshot(filePath, key)` — Multipart upload for large files using `@aws-sdk/lib-storage` Upload
- `getPresignedUrl(key, expiresIn?)` — Pre-signed GetObject URL
- `deleteSnapshot(key)` — DeleteObject

## Chain Module (`src/lib/chain.ts`)

Queries the local blockchain node RPC.

- `getStatus()` — Fetches `/status` from `http://localhost:{RPC_PORT}`, returns `{ blockHeight, chainId }`
- Uses `fetch()` (built into Bun)

## Docker Module (`src/lib/docker.ts`)

Manages the blockchain node lifecycle via child processes.

- `stopNode()` — Runs `[sudo] docker compose down`
- `startNode()` — Runs `[sudo] docker compose up -d --build`
- Uses `Bun.spawn` with inherited stdio for output visibility
- Respects `ENABLE_SUDO` config

## Compress Module (`src/lib/compress.ts`)

Handles snapshot compression via child processes.

- `createSnapshot({ chainHome, height, chainId, wasmLocation, outputDir })` — Runs `tar | lz4` pipeline via `Bun.spawn`
- Returns paths to created files (main snapshot + optional wasm-only snapshot)
- Respects `ENABLE_SUDO` config

## Configuration (`src/config.ts`)

All configuration via environment variables, loaded from `.env` using Bun's built-in `.env` support.

```
# Chain
RPC_PORT=26657

# Docker
ENABLE_SUDO=false

# S3 Storage
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET=euclid-snapshots
S3_FORCE_PATH_STYLE=true
S3_PRESIGN_EXPIRY=3600

# Server
PORT=3000

# Snapshots
SNAPSHOT_DIR=./snapshots
CHAIN_HOME=.config/lumen-1
```

`CHAIN_HOME` can be auto-resolved using chain ID from RPC if not set.

## Dependencies

```json
{
  "dependencies": {
    "hono": "^4",
    "@aws-sdk/client-s3": "^3",
    "@aws-sdk/s3-request-presigner": "^3",
    "@aws-sdk/lib-storage": "^3"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5"
  }
}
```

## Verification

1. **Storage layer:** Configure S3 credentials and run `bun run src/cli.ts snapshot` against a running node. Verify the snapshot appears in the S3 bucket.
2. **Server endpoints:** Start the server with `bun run src/server.ts`. Hit `/health`, `/snapshots`, `/snapshots/latest`, and `/snapshots/:height`. Verify correct metadata and working pre-signed URLs.
3. **End-to-end:** Create a snapshot via CLI, then query it via the server API. Verify the pre-signed URL downloads the correct file.
