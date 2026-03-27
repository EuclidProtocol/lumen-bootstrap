.PHONY: start stop startd build clean snapshot-api snapshot-api-stop snapshot-api-logs

# Build the Docker images
build:
	@DOCKER_BUILDKIT=1 docker compose build

# Start services in foreground
start:
	@DOCKER_BUILDKIT=1 docker compose up --build

# Start services in background (detached)
startd:
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

clean:
	@rm -rf .config

chown:
	@sudo chown ubuntu -R .config