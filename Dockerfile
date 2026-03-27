FROM alpine:3.20

ARG BINARY
ARG PLATFORM


RUN apk update
RUN apk add curl
RUN apk add "dasel>2.0.0"
RUN apk add jq

# Download binary and config files
RUN curl -L https://so7hoepmu4vbb7pi.public.blob.vercel-storage.com/${BINARY}/${BINARY}_${PLATFORM} -o /bin/${BINARY}
RUN mkdir -p /${BINARY}
RUN curl -L https://so7hoepmu4vbb7pi.public.blob.vercel-storage.com/${BINARY}/genesis.json -o /${BINARY}/genesis.json
RUN curl -L https://so7hoepmu4vbb7pi.public.blob.vercel-storage.com/${BINARY}/config.toml -o /${BINARY}/config.toml


# Make binary executable
RUN chmod +x /bin/${BINARY}

COPY scripts/setup_chain.sh /${BINARY}/setup.sh
# Make sript executable
RUN chmod +x /${BINARY}/setup.sh

# Copy cached node_key.json if present (preserves node identity across clean rebuilds).
# The cache/ dir is guaranteed to exist via .gitkeep.
COPY cache/ /tmp/cache/
RUN if [ -f /tmp/cache/node_key.json ]; then cp /tmp/cache/node_key.json /${BINARY}/node_key.json; fi
RUN rm -rf /tmp/cache

ENV HOME /${BINARY}
WORKDIR $HOME

# P2P
EXPOSE 26656
# RPC
EXPOSE 26657
# Rest
EXPOSE 1317
# GRPC
EXPOSE 9090

ENTRYPOINT ["./setup.sh"]