include .env
export

.PHONY: start stop startd build clean snapshot-api snapshot-api-stop snapshot-api-logs \
	snapshot-job-start snapshot-job-stop snapshot-job-restart snapshot-job-delete snapshot-job-logs \
	snapshot-job-status snapshot-job-now

# Build the Docker images
build:
	@mkdir -p cache
	@DOCKER_BUILDKIT=1 docker compose build

# Start services in foreground
start:
	@mkdir -p cache
	@DOCKER_BUILDKIT=1 docker compose up --build

# Start services in background (detached)
startd:
	@mkdir -p cache
	@DOCKER_BUILDKIT=1 docker compose up -d --build

# Stop all services
stop:
	@DOCKER_BUILDKIT=1 docker compose down

logs:
	@DOCKER_BUILDKIT=1 docker compose logs -f --since 10s

# Start snapshot API server (detached)
snapshot-api:
	@DOCKER_BUILDKIT=1 docker compose --profile snapshot up -d --build snapshot-api

# Stop snapshot API server
snapshot-api-stop:
	@DOCKER_BUILDKIT=1 docker compose --profile snapshot stop snapshot-api

# View snapshot API logs
snapshot-api-logs:
	@DOCKER_BUILDKIT=1 docker compose --profile snapshot logs -f snapshot-api --since 10s

# ──────────────────────────────────────────────────────────────
# Snapshot job (PM2)
#
# The snapshot CLI is one-shot: PM2 launches it on a cron schedule, it runs to
# completion, then exits. A "stopped" status in `pm2 list` between runs is
# expected, not a failure.
# ──────────────────────────────────────────────────────────────

# Register the snapshot job with PM2 and activate its cron schedule
snapshot-job-start:
	@mkdir -p logs
	@pm2 start ecosystem.config.cjs
	@pm2 save

# Pause the cron schedule (job stays in `pm2 list`)
snapshot-job-stop:
	@pm2 stop snapshot-job
	@pm2 save

# Reload the job after editing ecosystem.config.cjs or SNAPSHOT_CRON
snapshot-job-restart:
	@pm2 restart ecosystem.config.cjs --update-env
	@pm2 save

# Remove the job from PM2 entirely
snapshot-job-delete:
	@pm2 delete snapshot-job
	@pm2 save

# Tail snapshot job logs
snapshot-job-logs:
	@pm2 logs snapshot-job --lines 50

# Show job status and next scheduled run
snapshot-job-status:
	@pm2 describe snapshot-job

# Trigger a snapshot immediately, outside the cron schedule
snapshot-job-now:
	@bun run snapshot

# Remove chain data, backing up node_key.json to cache/ first
clean:
	@mkdir -p cache
	@if [ -f .config/$(CHAIN_ID)/config/node_key.json ]; then \
		cp .config/$(CHAIN_ID)/config/node_key.json cache/node_key.json; \
		echo "Backed up node_key.json to cache/"; \
	fi
	@rm -rf .config

chown:
	@sudo chown ubuntu -R .config