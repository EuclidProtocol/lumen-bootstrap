FROM alpine:3.20

RUN apk update
RUN apk add curl
RUN apk add "dasel>2.0.0"
RUN apk add jq

# Download binary
RUN curl -L https://so7hoepmu4vbb7pi.public.blob.vercel-storage.com/lumen/lumend_x86_64 -o /bin/lumend

# Make binary executable
RUN chmod +x /bin/lumend

COPY scripts/setup_chain.sh /lumend/setup.sh
# Make sript executable
RUN chmod +x /lumend/setup.sh

COPY genesis.json /lumend/genesis.json
COPY config.toml /lumend/config.toml


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