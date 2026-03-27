/**
 * Snapshot API server.
 *
 * A lightweight Hono HTTP server that exposes snapshot metadata from
 * S3-compatible storage. Runs standalone on the host (outside Docker)
 * alongside the blockchain node.
 *
 * Endpoints:
 *   GET /health             - Health check
 *   GET /snapshots          - List all snapshots (optional ?chain_id= filter)
 *   GET /snapshots/latest   - Get the most recent snapshot by block height
 *   GET /snapshots/:height  - Get snapshot at a specific block height
 *
 * All snapshot endpoints return metadata with pre-signed download URLs.
 * No file data is streamed through this server.
 *
 * Usage:
 *   bun run src/server.ts       (direct)
 *   bun run start               (via package.json)
 *   bun run dev                 (with watch mode for development)
 */

import { Hono } from "hono";
import { logger } from "hono/logger";
import { config } from "./config.ts";
import { snapshotsRouter } from "./routes/snapshots.ts";

if (!config.chainId) {
  console.error("CHAIN_ID environment variable is required");
  process.exit(1);
}

const app = new Hono();

// Log all incoming requests with method, path, status, and response time.
app.use("*", logger());

// Simple health check for uptime monitors and load balancers.
app.get("/health", (c) => c.json({ status: "ok" }));

// Mount snapshot routes under /snapshots.
app.route("/snapshots", snapshotsRouter);

console.log(`Server starting on port ${config.server.port}`);

// Bun's built-in HTTP server picks up this default export.
export default {
  port: config.server.port,
  fetch: app.fetch,
};
