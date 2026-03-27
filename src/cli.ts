/**
 * Snapshot CLI.
 *
 * Replaces the original `snapshot.sh` bash script with a TypeScript
 * implementation. Orchestrates the full snapshot lifecycle:
 *
 *   1. Query the chain node for current block height and chain ID
 *   2. Stop the node (required for data consistency)
 *   3. Compress chain data into lz4 archives
 *   4. Upload archives to S3-compatible storage
 *   5. Clean up local archives
 *   6. Wipe chain data (make clean) to trigger fresh state sync
 *   7. Restart the node
 *
 * Usage:
 *   bun run src/cli.ts snapshot
 *   bun run snapshot              (via package.json script)
 */

import { resolve } from "path";
import { unlinkSync } from "fs";
import { config } from "./config.ts";
import { getStatus } from "./lib/chain.ts";
import { stopNode, startNode, cleanChainData } from "./lib/docker.ts";
import { createSnapshot } from "./lib/compress.ts";
import { uploadSnapshot } from "./lib/storage.ts";

const command = process.argv[2];

if (command !== "snapshot") {
  console.log("Usage: bun run src/cli.ts snapshot");
  process.exit(1);
}

async function runSnapshot() {
  // Step 1: Fetch chain state from the local RPC endpoint.
  console.log("==> Fetching chain info...");
  const status = await getStatus();
  console.log(`    Chain ID:     ${status.chainId}`);
  console.log(`    Block height: ${status.blockHeight}`);

  // Resolve chain home directory. If not explicitly set via CHAIN_HOME,
  // derive it from the chain ID (e.g. `.config/lumen-1`).
  const chainHome = config.chainHome
    ? resolve(config.chainHome)
    : resolve(`.config/${status.chainId}`);

  console.log(`    Chain home:   ${chainHome}`);

  // Step 2: Stop the node to ensure data directory is not being written to.
  console.log("==> Stopping service...");
  await stopNode();

  // Step 3: Compress chain data. If compression fails, restart the node
  // before re-throwing so the chain doesn't stay down.
  let result;
  try {
    console.log("==> Compressing snapshot...");
    result = await createSnapshot(chainHome, status.chainId, status.blockHeight);
    console.log(`    Snapshot: ${result.mainFile}`);
    if (result.wasmFile) {
      console.log(`    Wasm-only: ${result.wasmFile}`);
    }
  } catch (err) {
    console.error("==> Compression failed, restarting service...");
    await startNode();
    throw err;
  }

  // Step 4: Upload to S3. Files are stored under a chain ID prefix
  // (e.g. `lumen-1/lumen-1_1234567.tar.lz4`).
  const s3Prefix = `${status.chainId}/`;
  const mainKey = `${s3Prefix}${status.chainId}_${status.blockHeight}.tar.lz4`;

  console.log(`==> Uploading snapshot to S3 (${mainKey})...`);
  await uploadSnapshot(result.mainFile, mainKey);
  console.log(`    Uploaded ${mainKey}`);

  if (result.wasmFile) {
    const wasmKey = `${s3Prefix}${status.chainId}_${status.blockHeight}_wasmonly.tar.lz4`;
    console.log(`==> Uploading wasm snapshot (${wasmKey})...`);
    await uploadSnapshot(result.wasmFile, wasmKey);
    console.log(`    Uploaded ${wasmKey}`);
  }

  // Step 5: Remove local archives after successful upload.
  console.log("==> Cleaning up local files...");
  unlinkSync(result.mainFile);
  if (result.wasmFile) {
    unlinkSync(result.wasmFile);
  }

  // Step 6: Wipe chain data to keep snapshots small. make clean backs up
  // node_key.json to cache/ automatically, so node identity is preserved.
  // The next startup will trigger a fresh state sync.
  console.log("==> Cleaning chain data (will state sync on restart)...");
  await cleanChainData();

  // Step 7: Restart the node. It will state sync from peers to catch up.
  console.log("==> Starting service (state syncing)...");
  await startNode();

  console.log("==> Done.");
}

runSnapshot().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
