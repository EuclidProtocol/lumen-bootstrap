# Lumen Bootstrap

Blockchain node bootstrapping and snapshot management for the Lumen network. Includes a Dockerized chain node, a snapshot CLI for creating and uploading compressed chain backups, and an HTTP API for querying snapshot metadata.

## Overview

The project has three main components:

1. **Chain Node** (Docker): Runs the `lumend` blockchain binary in a container via docker-compose. Handles peer discovery, state sync, and validator operations.

2. **Snapshot CLI** (`src/cli.ts`): Creates lz4-compressed archives of chain data and uploads them to S3-compatible storage. Replaces the legacy `snapshot.sh` script.

3. **Snapshot API** (`src/server.ts`): A lightweight HTTP server that lists available snapshots from S3 and returns metadata with pre-signed download URLs. Scoped to a single chain via the `CHAIN_ID` environment variable.

## Prerequisites

- [Bun](https://bun.sh) (v1.0+)
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- `tar` and `lz4` (for snapshot compression)
- Access to an S3-compatible storage provider (AWS S3, Hetzner Object Storage, MinIO)

## Setup

```bash
# Install dependencies
bun install

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your chain configuration and S3 credentials
```

See `.env.example` for a full list of configuration options with descriptions.

## Running the Chain Node

```bash
# Start the node in the background
make startd

# View logs
make logs

# Stop the node
make stop
```

The node exposes:

| Port  | Service                          |
|-------|----------------------------------|
| 26656 | P2P (peer networking)            |
| 26657 | Tendermint RPC                   |
| 1317  | REST API (Light Client Daemon)   |
| 9090  | gRPC                             |

## Snapshot CLI

Creates a compressed backup of the chain's data directory and uploads it to S3. The node is stopped during compression to ensure data consistency, then automatically restarted.

```bash
bun run snapshot
```

This performs the following steps:

1. Queries the local node RPC for the current block height and chain ID
2. Stops the chain node (`make stop`)
3. Compresses the data directory with `tar | lz4`
4. Restarts the chain node (`make startd`)
5. Uploads the archive to S3 under `{chain_id}/{chain_id}_{height}.tar.lz4`
6. Removes the local archive file

If the chain uses CosmWasm, a separate wasm-only archive is also created and uploaded (`{chain_id}_{height}_wasmonly.tar.lz4`).

## Snapshot API Server

Serves snapshot metadata from S3 over HTTP, scoped to the chain configured via `CHAIN_ID`. Does not stream file data; each response includes a pre-signed URL for direct S3 download.

### Running with Docker (recommended)

The snapshot API runs as a separate Docker service using the `snapshot` compose profile. It does not start with the regular `make startd` command.

```bash
# Start the snapshot API
make snapshot-api

# View logs
make snapshot-api-logs

# Stop the snapshot API
make snapshot-api-stop
```

### Running locally (development)

```bash
# Start the server
bun run start

# Start with auto-reload
bun run dev
```

### Endpoints

All snapshot endpoints are scoped to the `CHAIN_ID` set in your `.env` file.

#### `GET /health`

Health check.

```json
{ "status": "ok" }
```

#### `GET /snapshots`

Lists all snapshots for this chain, sorted by block height (newest first).

```bash
curl http://localhost:3000/snapshots
```

```json
[
  {
    "chainId": "lumen-1",
    "height": 1234567,
    "filename": "lumen-1_1234567.tar.lz4",
    "size": 1073741824,
    "sizeFormatted": "1.00 GB",
    "lastModified": "2026-03-28T12:00:00.000Z",
    "lastModifiedRelative": "3 hours ago",
    "url": "https://..."
  }
]
```

#### `GET /snapshots/latest`

Returns the most recent full snapshot (highest block height). Wasm-only snapshots are excluded.

```bash
curl http://localhost:3000/snapshots/latest
```

#### `GET /snapshots/latest/download`

Redirects (302) to the download URL of the most recent full snapshot. Designed for direct use with `curl` or `wget` to download the snapshot file in one command.

```bash
# Download the latest snapshot
curl -L -O http://localhost:3000/snapshots/latest/download

# Or with wget
wget http://localhost:3000/snapshots/latest/download
```

#### `GET /snapshots/:height`

Returns the full snapshot at a specific block height. Returns 404 if no snapshot exists at that height.

```bash
curl http://localhost:3000/snapshots/1234567
```

## Makefile Targets

| Target              | Description                                    |
|---------------------|------------------------------------------------|
| `make build`        | Build Docker images                            |
| `make start`        | Start chain node in foreground                 |
| `make startd`       | Start chain node in background (detached)      |
| `make stop`         | Stop chain node                                |
| `make logs`         | Tail chain node logs                           |
| `make snapshot-api` | Start snapshot API server (detached)           |
| `make snapshot-api-stop`  | Stop snapshot API server                 |
| `make snapshot-api-logs`  | Tail snapshot API logs                   |
| `make clean`        | Remove chain data (`.config/`)                 |
| `make chown`        | Fix `.config/` ownership (ubuntu user)         |

## Project Structure

```
src/
  cli.ts                 # Snapshot CLI entry point
  server.ts              # Hono HTTP server entry point
  config.ts              # Shared configuration (env vars)
  lib/
    chain.ts             # Chain RPC queries (block height, chain ID)
    docker.ts            # Node lifecycle via Makefile targets
    compress.ts          # tar + lz4 compression with wasm detection
    storage.ts           # S3 client (list, upload, presign, delete)
  routes/
    snapshots.ts         # Snapshot API route handlers
scripts/
  setup_chain.sh         # Chain node initialization (used by Docker)
  setup_fresh.sh         # Fresh chain initialization (testnet)
Dockerfile               # Chain node container image
Dockerfile.api           # Snapshot API container image
docker-compose.yml       # Chain node + snapshot API service definitions
Makefile                 # Convenience targets for all services
snapshot.sh              # Legacy bash script (replaced by src/cli.ts)
```

## S3 Storage Configuration

The project uses `@aws-sdk/client-s3` with a configurable endpoint, making it compatible with any S3-compatible provider.

### Public vs private buckets

By default, the API generates time-limited pre-signed URLs for snapshot downloads. If your bucket allows public read access, set `S3_PUBLIC_BUCKET=true` to return direct URLs instead. This avoids the signing overhead and produces stable, cacheable URLs.

### AWS S3

```env
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=your-key
S3_SECRET_ACCESS_KEY=your-secret
S3_BUCKET=euclid-snapshots
```

### Hetzner Object Storage

```env
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=your-key
S3_SECRET_ACCESS_KEY=your-secret
S3_BUCKET=euclid-snapshots
S3_FORCE_PATH_STYLE=true
```

### MinIO (local development)

```env
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=euclid-snapshots
S3_FORCE_PATH_STYLE=true
```

## Network Configuration

For mainnet and testnet configuration details, see:

- `mainnet.md` for mainnet environment variables
- `testnet.md` for testnet environment variables
