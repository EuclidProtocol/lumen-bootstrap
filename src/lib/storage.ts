/**
 * S3-compatible object storage client.
 *
 * Provides methods for listing, uploading, downloading (via pre-signed URLs),
 * and deleting snapshot archives from any S3-compatible storage provider.
 *
 * The client is configured via environment variables (see `config.ts`).
 * To use with different providers:
 *
 *   - **AWS S3**: Leave S3_ENDPOINT unset, set S3_REGION to your region.
 *   - **Hetzner Object Storage**: Set S3_ENDPOINT to the Hetzner endpoint
 *     (e.g. `https://fsn1.your-objectstorage.com`), S3_FORCE_PATH_STYLE=true.
 *   - **MinIO**: Set S3_ENDPOINT to the MinIO URL, S3_FORCE_PATH_STYLE=true.
 *
 * Snapshot files follow the naming convention:
 *   `{chain_id}/{chain_id}_{height}.tar.lz4`         (full snapshot)
 *   `{chain_id}/{chain_id}_{height}_wasmonly.tar.lz4` (wasm only)
 */

import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream } from "fs";
import { config } from "../config.ts";

/**
 * Shared S3 client instance. Configured once at module load from env vars.
 * The `endpoint` field is only set for non-AWS providers; when undefined,
 * the SDK defaults to the standard AWS S3 endpoint for the given region.
 */
const client = new S3Client({
  endpoint: config.s3.endpoint || undefined,
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
  forcePathStyle: config.s3.forcePathStyle,
});

/**
 * S3 user-metadata key holding the chain time of the snapshotted block.
 *
 * On the wire this is the header `x-amz-meta-block-time`. The AWS SDK strips
 * the `x-amz-meta-` prefix and lowercases the remainder, so the same constant
 * is used both when writing (`Upload` params `Metadata`) and when reading
 * (`HeadObject` response `Metadata`).
 */
export const BLOCK_TIME_METADATA_KEY = "block-time";

/** Metadata for a single snapshot as returned by the list endpoint. */
export interface SnapshotMeta {
  chainId: string;
  height: number;
  filename: string;
  /** File size in bytes. */
  size: number;
  /** Human-readable file size (e.g. "1.2 GB", "256 MB"). */
  sizeFormatted: string;
  /** ISO 8601 timestamp of last modification in S3. */
  lastModified: string;
  /** Human-readable relative time (e.g. "3 hours ago", "2 days ago"). */
  lastModifiedRelative: string;
  /** Download URL. Either a direct public URL or a time-limited pre-signed URL. */
  url: string;
}

/**
 * A snapshot plus its chain block time, as returned by the single-snapshot
 * endpoints (`/snapshots/latest`, `/snapshots/:height`).
 *
 * Block time is stored as S3 user metadata at upload time. `ListObjectsV2`
 * does not return user metadata, so reading it back costs one `HeadObject`
 * call per key. That is affordable for a single object but not for a whole
 * listing, which is why the list endpoint returns `SnapshotMeta` instead.
 */
export interface SnapshotDetail extends SnapshotMeta {
  /**
   * ISO 8601 chain timestamp of the block the snapshot was taken at, or
   * `null` for snapshots uploaded before this metadata was recorded.
   *
   * Distinct from `lastModified`, which is when the archive landed in S3.
   * There is no way to recover the block time of a legacy snapshot from the
   * object itself, so it is reported as `null` rather than guessed at.
   */
  blockTime: string | null;
}

/**
 * Formats a byte count into a human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

/**
 * Converts a date to a human-readable relative time string.
 */
function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;

  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/**
 * Regex to parse snapshot object keys.
 *
 * Matches keys like:
 *   `lumen-1/lumen-1_1234567.tar.lz4`
 *   `lumen-1/lumen-1_1234567_wasmonly.tar.lz4`
 *
 * Capture groups:
 *   1: chain ID (e.g. "lumen-1")
 *   2: block height (e.g. "1234567")
 *   3: suffix (e.g. ".tar.lz4" or "_wasmonly.tar.lz4")
 */
const SNAPSHOT_PATTERN = /^(?:.*\/)?(.+?)_(\d+)((?:_wasmonly)?\.tar\.lz4)$/;

/**
 * Extracts chain ID, height, and filename from an S3 object key.
 * Returns null if the key doesn't match the expected snapshot naming pattern.
 */
function parseSnapshotKey(key: string): { chainId: string; height: number; filename: string } | null {
  const match = key.match(SNAPSHOT_PATTERN);
  if (!match) return null;
  return {
    chainId: match[1]!,
    height: parseInt(match[2]!, 10),
    filename: key.split("/").pop()!,
  };
}

/**
 * Lists all snapshots in the S3 bucket, optionally filtered by a key prefix.
 *
 * Each snapshot includes a freshly generated pre-signed download URL.
 * Results are sorted by block height in descending order (newest first).
 *
 * @param prefix - Optional S3 key prefix to filter by (e.g. "lumen-1/" for a specific chain)
 */
export async function listSnapshots(prefix?: string, generateUrl?: boolean): Promise<SnapshotMeta[]> {
  const result = await client.send(
    new ListObjectsV2Command({
      Bucket: config.s3.bucket,
      Prefix: prefix,
    }),
  );

  const snapshots: SnapshotMeta[] = [];

  for (const obj of result.Contents ?? []) {
    if (!obj.Key) continue;
    const parsed = parseSnapshotKey(obj.Key);
    if (!parsed) continue;


    const lastModified = obj.LastModified ?? new Date(0);

    snapshots.push({
      chainId: parsed.chainId,
      height: parsed.height,
      filename: parsed.filename,
      size: obj.Size ?? 0,
      sizeFormatted: formatBytes(obj.Size ?? 0),
      lastModified: lastModified.toISOString(),
      lastModifiedRelative: timeAgo(lastModified),
      url: generateUrl ? await getDownloadUrl(obj.Key) : "",
    });
  }

  return snapshots.sort((a, b) => b.height - a.height);
}

/**
 * Reads the snapshot's block time out of a raw S3 user-metadata map.
 *
 * Kept as a pure function (rather than inlined into `getSnapshotBlockTime`)
 * so the mapping from S3 metadata to API field can be tested without a bucket.
 *
 * Returns `null` when the key is absent (snapshots uploaded before block time
 * was recorded) or when the stored value is empty. Never substitutes another
 * timestamp in its place.
 */
export function blockTimeFromMetadata(metadata: Record<string, string> | undefined): string | null {
  const value = metadata?.[BLOCK_TIME_METADATA_KEY];
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
}

/**
 * Fetches the block time recorded on a snapshot object via `HeadObject`.
 *
 * `HeadObject` transfers headers only, not the (multi-gigabyte) body, so this
 * is cheap. It is nonetheless one request per key, hence single-object use only.
 *
 * @param key - S3 object key
 */
export async function getSnapshotBlockTime(key: string): Promise<string | null> {
  const head = await client.send(
    new HeadObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
    }),
  );
  return blockTimeFromMetadata(head.Metadata);
}

/**
 * Enriches a listed snapshot with the block time stored on its S3 object.
 *
 * @param key - S3 object key of the snapshot (the listing already matched it)
 * @param snapshot - Snapshot metadata derived from the listing
 */
export async function withBlockTime(key: string, snapshot: SnapshotMeta): Promise<SnapshotDetail> {
  return {
    ...snapshot,
    blockTime: await getSnapshotBlockTime(key),
  };
}

/**
 * Uploads a local file to S3 using multipart upload.
 *
 * Uses the AWS SDK's managed Upload class which automatically splits
 * large files into 64 MB parts and uploads up to 4 parts concurrently.
 * Progress is printed to stdout as a percentage.
 *
 * The block time is written as S3 user metadata (`x-amz-meta-block-time`).
 * It is a required argument, not an option with a fallback: the caller has
 * just read it from the chain RPC alongside the height the key is named
 * after, and no other source for it exists once the archive is in the bucket.
 *
 * @param filePath - Absolute path to the local file
 * @param key - S3 object key (e.g. "lumen-1/lumen-1_1234567.tar.lz4")
 * @param blockTime - ISO 8601 chain timestamp of the snapshotted block
 */
export async function uploadSnapshot(filePath: string, key: string, blockTime: string): Promise<void> {
  const stream = createReadStream(filePath);

  const upload = new Upload({
    client,
    params: {
      Bucket: config.s3.bucket,
      Key: key,
      Body: stream,
      Metadata: {
        [BLOCK_TIME_METADATA_KEY]: blockTime,
      },
    },
    queueSize: 4,           // Upload 4 parts concurrently
    partSize: 1024 * 1024 * 64, // 64 MB per part
  });

  upload.on("httpUploadProgress", (progress) => {
    if (progress.loaded && progress.total) {
      const pct = ((progress.loaded / progress.total) * 100).toFixed(1);
      process.stdout.write(`\r    Upload progress: ${pct}%`);
    }
  });

  await upload.done();
  console.log(); // Newline after progress output
}

/**
 * Returns a download URL for a snapshot.
 *
 * When S3_PUBLIC_BUCKET is true, returns a direct public URL constructed
 * from the endpoint and bucket name. Otherwise, generates a time-limited
 * pre-signed URL via the AWS SDK.
 *
 * @param key - S3 object key
 */
export async function getDownloadUrl(key: string): Promise<string> {
  if (config.s3.publicBucket) {
    return getPublicUrl(key);
  }
  return getPresignedUrl(key);
}

/**
 * Builds a direct public URL for an S3 object.
 *
 * URL format depends on the provider:
 *   - Path style (Hetzner, MinIO): `{endpoint}/{bucket}/{key}`
 *   - Virtual-hosted (AWS): `https://{bucket}.s3.{region}.amazonaws.com/{key}`
 */
function getPublicUrl(key: string): string {
  if (config.s3.forcePathStyle && config.s3.endpoint) {
    const base = config.s3.endpoint.replace(/\/$/, "");
    return `${base}/${config.s3.bucket}/${key}`;
  }
  return `https://${config.s3.bucket}.s3.${config.s3.region}.amazonaws.com/${key}`;
}

/**
 * Generates a pre-signed URL for downloading a snapshot directly from S3.
 *
 * The URL is time-limited and does not require the caller to have S3 credentials.
 *
 * @param key - S3 object key
 * @param expiresIn - URL validity in seconds (defaults to S3_PRESIGN_EXPIRY config)
 */
export async function getPresignedUrl(key: string, expiresIn?: number): Promise<string> {
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
    }),
    { expiresIn: expiresIn ?? config.s3.presignExpiry },
  );
}

/**
 * Deletes a snapshot object from S3.
 *
 * @param key - S3 object key to delete
 */
export async function deleteSnapshot(key: string): Promise<void> {
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
    }),
  );
}
