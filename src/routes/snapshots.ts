/**
 * Snapshot API routes.
 *
 * All routes query the S3 bucket for snapshot objects scoped to the
 * chain ID configured via the CHAIN_ID environment variable. Each
 * response includes a download URL (direct public or pre-signed, depending
 * on S3_PUBLIC_BUCKET) for fetching the archive directly from S3.
 *
 * Snapshot naming convention in S3:
 *   {chain_id}/{chain_id}_{height}.tar.lz4
 *   {chain_id}/{chain_id}_{height}_wasmonly.tar.lz4
 *
 * The "latest" and "by height" endpoints filter out wasm-only snapshots
 * and only return full snapshots. The list endpoint returns everything.
 *
 * The single-snapshot endpoints additionally return `blockTime`, the chain
 * timestamp of the snapshotted block. It lives in S3 user metadata, which
 * `ListObjectsV2` does not return, so those endpoints spend one extra
 * `HeadObject` call on the matched key. The list endpoint deliberately does
 * not, since that would be one round-trip per snapshot in the bucket.
 */

import { Hono } from "hono";
import { config } from "../config.ts";
import { listSnapshots, withBlockTime } from "../lib/storage.ts";

export const snapshotsRouter = new Hono();

/** S3 key prefix scoped to this chain (e.g. "lumen-1/"). */
const prefix = `${config.chainId}/`;

/**
 * GET /snapshots
 *
 * Lists all snapshot archives for this chain, sorted by block height
 * (newest first).
 *
 * Example:
 *   GET /snapshots
 */
snapshotsRouter.get("/", async (c) => {
  const snapshots = await listSnapshots(prefix, false);
  return c.json(snapshots);
});

/**
 * GET /snapshots/latest
 *
 * Returns the single most recent full snapshot (highest block height),
 * including its `blockTime`. Wasm-only snapshots are excluded.
 *
 * Returns 404 if no snapshots exist.
 */
snapshotsRouter.get("/latest", async (c) => {
  const snapshots = await listSnapshots(prefix, true);

  // Filter out wasm-only snapshots so "latest" returns a full snapshot.
  const mainSnapshots = snapshots.filter((s) => !s.filename.includes("wasmonly"));

  // listSnapshots already sorts by height descending, so index 0 is the latest.
  const latest = mainSnapshots[0];

  if (!latest) {
    return c.json({ error: "No snapshots found" }, 404);
  }

  return c.json(await withBlockTime(`${prefix}${latest.filename}`, latest));
});

/**
 * GET /snapshots/latest/download
 *
 * Redirects (302) to the download URL of the most recent full snapshot.
 * Useful for piping directly into curl or wget:
 *
 *   curl -L -O http://localhost:3000/snapshots/latest/download
 *   wget http://localhost:3000/snapshots/latest/download
 *
 * Returns 404 if no snapshots exist.
 */
snapshotsRouter.get("/latest/download", async (c) => {
  const snapshots = await listSnapshots(prefix, true);
  const mainSnapshots = snapshots.filter((s) => !s.filename.includes("wasmonly"));

  if (mainSnapshots.length === 0) {
    return c.json({ error: "No snapshots found" }, 404);
  }

  return c.redirect(mainSnapshots[0]!.url, 302);
});

/**
 * GET /snapshots/:height
 *
 * Returns the full snapshot at the specified block height, including its
 * `blockTime`. Wasm-only snapshots are excluded.
 *
 * Returns 400 if the height parameter is not a valid number.
 * Returns 404 if no snapshot exists at the given height.
 */
snapshotsRouter.get("/:height", async (c) => {
  const height = parseInt(c.req.param("height"), 10);
  if (isNaN(height)) {
    return c.json({ error: "Invalid height" }, 400);
  }

  const snapshots = await listSnapshots(prefix, true);
  const match = snapshots.find((s) => s.height === height && !s.filename.includes("wasmonly"));

  if (!match) {
    return c.json({ error: `No snapshot found at height ${height}` }, 404);
  }

  return c.json(await withBlockTime(`${prefix}${match.filename}`, match));
});
