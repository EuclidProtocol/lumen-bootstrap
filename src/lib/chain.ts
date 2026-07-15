/**
 * Chain RPC client.
 *
 * Queries the Tendermint RPC endpoint exposed by the local blockchain node
 * (default port 26657). The `/status` endpoint returns the node's current
 * sync state, including the latest committed block height, that block's
 * header timestamp, and the network (chain) identifier.
 *
 * These values are used by the CLI to name snapshot archives, organize them
 * in S3 by chain ID, and record the chain time the snapshot was taken at.
 */

import { config } from "../config.ts";

export interface ChainStatus {
  /** Latest committed block height as a string (preserves the RPC format). */
  blockHeight: string;
  /** Network identifier, e.g. "lumen-1" or "lumen-test-1". */
  chainId: string;
  /**
   * Header timestamp of the block at `blockHeight`, normalized to ISO 8601
   * with millisecond precision (e.g. "2026-03-28T12:00:00.000Z").
   *
   * This is chain time, i.e. when the block was committed by the network.
   * It is unrelated to when the resulting archive is uploaded to S3.
   */
  blockTime: string;
}

/**
 * Normalizes a Tendermint block header timestamp into ISO 8601.
 *
 * Tendermint reports header times with nanosecond precision
 * (e.g. "2026-03-28T12:00:00.123456789Z"), which is valid ISO 8601 but not a
 * format JSON consumers handle uniformly. Reducing it to the millisecond
 * precision used everywhere else in the API keeps `blockTime` directly
 * comparable to `lastModified`.
 *
 * Throws if the RPC returned a missing or unparseable timestamp: an invalid
 * block time is a bug worth surfacing, not a value to paper over.
 */
export function normalizeBlockTime(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(`Chain status returned no block time (got ${JSON.stringify(raw)})`);
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Chain status returned an unparseable block time: ${raw}`);
  }
  return parsed.toISOString();
}

/**
 * Probes whether the local chain node's Tendermint RPC is reachable.
 *
 * A healthy snapshot run needs the node serving `/status`. This is separate
 * from the Docker daemon being up: a container can be crash-looping
 * ("Restarting") while the daemon is fine, in which case the RPC connection
 * is refused. Any failure (connection refused, timeout, non-2xx) is treated
 * as unreachable. Never throws.
 */
export async function isNodeReachable(): Promise<boolean> {
  const url = `http://localhost:${config.rpcPort}/status`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Fetches the current status from the local chain node's Tendermint RPC.
 *
 * Calls `GET http://localhost:{RPC_PORT}/status` and extracts the block
 * height from `result.sync_info.latest_block_height`, the chain ID from
 * `result.node_info.network`, and the block header time from
 * `result.sync_info.latest_block_time`.
 *
 * All three fields come from the same response, so the returned block time
 * is guaranteed to be the header time of the returned block height (no
 * second round-trip, and no race with blocks committed in between).
 */
export async function getStatus(): Promise<ChainStatus> {
  const url = `http://localhost:${config.rpcPort}/status`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch chain status: ${res.status} ${res.statusText}`);
  }
  const data:any = await res.json();
  return {
    blockHeight: data.result.sync_info.latest_block_height,
    chainId: data.result.node_info.network,
    blockTime: normalizeBlockTime(data.result.sync_info.latest_block_time),
  };
}
