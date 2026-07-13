/**
 * PM2 process definition for the snapshot job.
 *
 * The snapshot CLI is a one-shot process: it stops the node, compresses and
 * uploads chain data, wipes local state, restarts the node, then exits. It is
 * NOT a long-running daemon.
 *
 * Because of that:
 *   - `autorestart` is false, so PM2 does not relaunch it the moment it exits
 *     (which would otherwise loop snapshots back-to-back forever).
 *   - `cron_restart` drives the schedule. PM2 launches the process on each cron
 *     tick and lets it exit. A `stopped` status between runs is expected and
 *     healthy.
 *
 * Bun loads .env from `cwd` automatically, so credentials and chain settings do
 * not need to be duplicated here.
 */

module.exports = {
  apps: [
    {
      name: "snapshot-job",
      script: "src/cli.ts",
      args: "snapshot",

      // PM2's daemon may run with a minimal PATH (e.g. under systemd), where
      // `bun` is not resolvable. Set BUN_BIN to an absolute path in that case.
      interpreter: process.env.BUN_BIN || "bun",

      cwd: __dirname,

      // Snapshot schedule. Defaults to every 6 hours. Override with
      // SNAPSHOT_CRON in .env (standard 5-field cron expression).
      cron_restart: process.env.SNAPSHOT_CRON || "0 */6 * * *",

      // One-shot semantics: run on cron, exit, wait for the next tick.
      autorestart: false,

      // A snapshot run is long (compress + multi-GB upload). Never kill it for
      // taking too long, and never treat a slow run as a crash loop.
      exec_mode: "fork",
      instances: 1,
      kill_timeout: 300000,

      out_file: "logs/snapshot-out.log",
      error_file: "logs/snapshot-error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
