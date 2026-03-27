/**
 * Chain RPC client.
 *
 * Queries the Tendermint RPC endpoint exposed by the local blockchain node
 * (default port 26657). The `/status` endpoint returns the node's current
 * sync state, including the latest committed block height and the network
 * (chain) identifier.
 *
 * These values are used by the CLI to name snapshot archives and organize
 * them in S3 by chain ID.
 */

import { config } from "../config.ts";

export interface ChainStatus {
  /** Latest committed block height as a string (preserves the RPC format). */
  blockHeight: string;
  /** Network identifier, e.g. "lumen-1" or "lumen-test-1". */
  chainId: string;
}

/**
 * Fetches the current status from the local chain node's Tendermint RPC.
 *
 * Calls `GET http://localhost:{RPC_PORT}/status` and extracts the block
 * height from `result.sync_info.latest_block_height` and the chain ID
 * from `result.node_info.network`.
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
  };
}
