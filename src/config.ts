/**
 * Centralized configuration for both the CLI and HTTP server.
 *
 * All values are sourced from environment variables. Bun automatically loads
 * the `.env` file in the project root, so no dotenv package is needed.
 *
 * See `.env.example` for a full list of supported variables with descriptions.
 */

const env = process.env;

export const config = {
  // Chain identifier (e.g. "lumen-1"). Used by the server to scope
  // snapshot queries to this chain's S3 prefix. Required for the server;
  // the CLI resolves it from the RPC endpoint if not set.
  chainId: env.CHAIN_ID ?? "",

  // Port the blockchain node exposes its Tendermint RPC on.
  // Used by the CLI to query block height and chain ID before creating a snapshot.
  rpcPort: env.RPC_PORT ?? "26657",

  // Absolute or relative path to the chain's data directory
  // (e.g. `.config/lumen-1`). When omitted, the CLI resolves it
  // automatically from the chain ID returned by the RPC endpoint.
  chainHome: env.CHAIN_HOME,

  // When true, all shell commands (make, tar, lz4) are prefixed with `sudo`.
  // Needed on hosts where the current user lacks direct Docker/filesystem access.
  enableSudo: env.ENABLE_SUDO === "true",

  // S3-compatible object storage settings.
  // Works with AWS S3, Hetzner Object Storage, MinIO, and any provider
  // that implements the S3 API.
  s3: {
    // Custom endpoint URL for non-AWS providers (e.g. Hetzner, MinIO).
    // Leave unset to use the default AWS endpoint.
    endpoint: env.S3_ENDPOINT,

    // Region identifier. For Hetzner this is the datacenter code (e.g. "fsn1").
    region: env.S3_REGION ?? "us-east-1",

    // IAM or provider credentials for authenticating with the S3 API.
    accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",

    // Bucket where snapshots are stored. Objects are keyed as
    // `{chain_id}/{chain_id}_{height}.tar.lz4`.
    bucket: env.S3_BUCKET ?? "euclid-snapshots",

    // Must be true for providers that use path-style URLs
    // (e.g. `endpoint/bucket/key` instead of `bucket.endpoint/key`).
    // AWS uses virtual-hosted style by default; Hetzner and MinIO need path style.
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",

    // When true, the bucket has public read access and direct URLs are
    // returned instead of pre-signed URLs. Avoids unnecessary signing overhead.
    publicBucket: env.S3_PUBLIC_BUCKET === "true",

    // How long (in seconds) pre-signed download URLs remain valid.
    // Ignored when S3_PUBLIC_BUCKET is true.
    presignExpiry: parseInt(env.S3_PRESIGN_EXPIRY ?? "3600", 10),
  },

  // HTTP server settings (only used by src/server.ts).
  server: {
    port: parseInt(env.PORT ?? "3000", 10),
  },

  // Local directory where snapshot archives are written temporarily
  // before being uploaded to S3. Cleaned up after successful upload.
  snapshotDir: env.SNAPSHOT_DIR ?? "./snapshots",
} as const;
