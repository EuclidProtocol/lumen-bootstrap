/**
 * Snapshot compression using tar + lz4.
 *
 * Creates lz4-compressed tar archives of the chain's data directory.
 * The compression is done via piped child processes (`tar | lz4`) using
 * `Bun.spawn`, which avoids loading the entire archive into memory.
 *
 * Wasm handling:
 *   Cosmos SDK chains may store compiled wasm contracts in one of two
 *   locations depending on the chain version and configuration:
 *
 *   - "outside": `$CHAIN_HOME/wasm/`   (separate from the data dir)
 *   - "inside":  `$CHAIN_HOME/data/wasm/`  (nested within data)
 *
 *   When wasm exists, two archives are created:
 *   1. A full snapshot (`{chain_id}_{height}.tar.lz4`) containing data + wasm
 *   2. A wasm-only snapshot (`{chain_id}_{height}_wasmonly.tar.lz4`) for
 *      operators who only need to restore wasm state.
 *
 *   The wasm cache directory is always excluded to reduce archive size.
 */

import { existsSync, mkdirSync } from "fs";
import { config } from "../config.ts";

/** Where wasm contracts are stored relative to CHAIN_HOME. */
export type WasmLocation = "outside" | "inside" | "none";

export interface SnapshotResult {
  /** Path to the main snapshot archive (data + wasm). */
  mainFile: string;
  /** Path to the wasm-only archive, if wasm was detected. */
  wasmFile?: string;
}

/**
 * Auto-detects where wasm contracts are stored by checking for the
 * existence of `$CHAIN_HOME/wasm` or `$CHAIN_HOME/data/wasm`.
 */
function detectWasm(chainHome: string): WasmLocation {
  if (existsSync(`${chainHome}/wasm`)) return "outside";
  if (existsSync(`${chainHome}/data/wasm`)) return "inside";
  return "none";
}

/**
 * Runs a `tar | lz4` pipeline as two piped child processes.
 *
 * tar's stdout is piped directly into lz4's stdin, and lz4 writes
 * to the output file. This streams the data without buffering the
 * entire archive in memory.
 *
 * @param tarArgs  - Arguments passed to `tar` (excludes, mode flags, paths)
 * @param outputPath - Where to write the compressed .tar.lz4 file
 * @param cwd - Working directory for tar (determines relative paths in archive)
 */
async function runPipeline(
  tarArgs: string[],
  outputPath: string,
  cwd: string,
): Promise<void> {
  const sudo = config.enableSudo ? ["sudo"] : [];
  const tar = Bun.spawn([...sudo, "tar", ...tarArgs], {
    cwd,
    stdout: "pipe",
    stderr: "inherit",
  });

  const lz4 = Bun.spawn([...sudo, "lz4"], {
    stdin: tar.stdout,
    stdout: Bun.file(outputPath),
    stderr: "inherit",
  });

  const [tarExit, lz4Exit] = await Promise.all([tar.exited, lz4.exited]);
  if (tarExit !== 0) throw new Error(`tar failed with exit code ${tarExit}`);
  if (lz4Exit !== 0) throw new Error(`lz4 failed with exit code ${lz4Exit}`);
}

/**
 * Creates compressed snapshot archive(s) from the chain's data directory.
 *
 * Handles three cases based on wasm location:
 *
 * 1. **outside** (`$CHAIN_HOME/wasm/`):
 *    - Main archive includes both `data/` and `wasm/` dirs
 *    - Wasm-only archive includes just `wasm/`
 *    - Both exclude `wasm/wasm/cache`
 *
 * 2. **inside** (`$CHAIN_HOME/data/wasm/`):
 *    - Main archive includes `data/` (which contains wasm)
 *    - Wasm-only archive is created from `data/wasm/`
 *    - Both exclude `wasm/cache`
 *
 * 3. **none**: Only the main archive is created with `data/`
 *
 * @param chainHome - Absolute path to the chain's home directory
 * @param chainId - Network identifier (e.g. "lumen-1")
 * @param blockHeight - Block height at time of snapshot
 * @returns Paths to the created archive file(s)
 */
export async function createSnapshot(
  chainHome: string,
  chainId: string,
  blockHeight: string,
): Promise<SnapshotResult> {
  const outputDir = config.snapshotDir;
  mkdirSync(outputDir, { recursive: true });

  const wasm = detectWasm(chainHome);
  const filename = `${chainId}_${blockHeight}.tar.lz4`;
  const mainPath = `${outputDir}/${filename}`;

  console.log(`    Wasm: ${wasm}`);

  let wasmFile: string | undefined;

  if (wasm === "outside") {
    // Wasm dir sits alongside data dir. Include both in the main snapshot,
    // and create a separate wasm-only archive for convenience.
    await runPipeline(
      ["--exclude=wasm/wasm/cache", "-cvf", "-", "data", "wasm"],
      mainPath,
      chainHome,
    );

    const wasmFilename = `${chainId}_${blockHeight}_wasmonly.tar.lz4`;
    const wasmPath = `${outputDir}/${wasmFilename}`;
    await runPipeline(
      ["--exclude=wasm/wasm/cache", "-cvf", "-", "wasm"],
      wasmPath,
      chainHome,
    );
    wasmFile = wasmPath;
  } else if (wasm === "inside") {
    // Wasm dir is nested inside data dir. The main snapshot gets all of data/
    // and we extract data/wasm separately for the wasm-only archive.
    await runPipeline(
      ["--exclude=data/wasm/cache", "-cvf", "-", "data"],
      mainPath,
      chainHome,
    );

    const wasmFilename = `${chainId}_${blockHeight}_wasmonly.tar.lz4`;
    const wasmPath = `${outputDir}/${wasmFilename}`;
    await runPipeline(
      ["--exclude=wasm/cache", "-cvf", "-", "wasm"],
      wasmPath,
      `${chainHome}/data`,
    );
    wasmFile = wasmPath;
  } else {
    // No wasm contracts detected. Archive data dir only.
    await runPipeline(["-cvf", "-", "data"], mainPath, chainHome);
  }

  return { mainFile: mainPath, wasmFile };
}
