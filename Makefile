.PHONY: start stop startd build clean

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

clean:
	@rm -rf .config

chown:
	@sudo chown ubuntu -R .config