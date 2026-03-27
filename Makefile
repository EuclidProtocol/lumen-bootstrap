include .env
export

.PHONY: start stop startd build clean snapshot-api snapshot-api-stop snapshot-api-logs

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