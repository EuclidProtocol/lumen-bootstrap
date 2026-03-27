/**
 * Chain node lifecycle management via Makefile targets.
 *
 * Delegates to `make stop` and `make startd` to control the blockchain
 * node container. This matches the operator workflow and ensures all
 * Makefile-level logic (DOCKER_BUILDKIT, flags, etc.) is respected.
 *
 * The snapshot CLI stops the node before compressing chain data (to
 * avoid corrupted state) and restarts it once the archive is written.
 *
 * Commands are executed via `Bun.spawn` with inherited stdio so the
 * operator can see output in real time. When `ENABLE_SUDO` is set,
 * all commands are prefixed with `sudo`.
 */

import { config } from "../config.ts";

/** Repo root directory where the Makefile lives. */
const REPO_ROOT = import.meta.dir + "/../../";

/**
 * Optionally prepends `sudo` to a command array based on config.
 */
function buildCommand(args: string[]): string[] {
  return config.enableSudo ? ["sudo", ...args] : args;
}

/**
 * Spawns a shell command, inherits stdio, and throws on non-zero exit.
 */
async function run(args: string[]): Promise<void> {
  const cmd = buildCommand(args);
  console.log(`    $ ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, {
    stdout: "inherit",
    stderr: "inherit",
    cwd: REPO_ROOT,
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${cmd.join(" ")}`);
  }
}

/**
 * Stops the blockchain node by running `make stop`.
 * The node must be stopped before creating a snapshot to ensure
 * data consistency.
 */
export async function stopNode(): Promise<void> {
  await run(["make", "stop"]);
}

/**
 * Starts the blockchain node by running `make startd` (detached mode).
 * Called after snapshot compression completes (or on compression failure
 * to restore the node to a running state).
 */
export async function startNode(): Promise<void> {
  await run(["make", "startd"]);
}

/**
 * Wipes chain data by running `make clean`. This backs up node_key.json
 * to cache/ before deleting .config/, so node identity is preserved.
 * The next `make startd` will trigger a fresh state sync.
 */
export async function cleanChainData(): Promise<void> {
  await run(["make", "clean"]);
}
