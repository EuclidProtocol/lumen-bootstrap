FROM alpine:3.20

RUN apk update
RUN apk add curl
RUN apk add "dasel>2.0.0"
RUN apk add jq

# Download binary and config files
RUN curl -L https://so7hoepmu4vbb7pi.public.blob.vercel-storage.com/lumen/lumend_x86_64 -o /bin/lumend
RUN curl -L https://so7hoepmu4vbb7pi.public.blob.vercel-storage.com/lumen/genesis.json -o /lumend/genesis.json
RUN curl -L https://so7hoepmu4vbb7pi.public.blob.vercel-storage.com/lumen/config.toml -o /lumend/config.toml


# Make binary executable
RUN chmod +x /bin/lumend

COPY scripts/setup_chain.sh /lumend/setup.sh
# Make sript executable
RUN chmod +x /lumend/setup.sh


ENV HOME /lumend
WORKDIR $HOME

# P2P
EXPOSE 26656
# RPC
EXPOSE 26657
# Rest
EXPOSE 1317
# GRPC
EXPOSE 9090

ENTRYPOINT ["/lumend/setup.sh"]