#!/bin/sh
set -eo pipefail

BINARY="${BINARY:-lumend}"

CHAIN_HOME=$HOME/.$BINARY
CONFIG_FOLDER=$CHAIN_HOME/config

DENOM="${DENOM:-ualpha}"
STAKE_DENOM="${STAKE_DENOM:-usync}"

add_account(){
    local MNEMONIC=$1
    local MONIKER=$2
    local INDEX=${3:-0}

    echo $MNEMONIC | $BINARY keys add $MONIKER --account=$INDEX --recover --home $CHAIN_HOME --keyring-backend test
}

get_address(){
    local MONIKER=$1
    $BINARY keys show $MONIKER --home $CHAIN_HOME --keyring-backend test --address
}

edit_config () {
    # Expose the rpc
    dasel put -t string -f $CONFIG_FOLDER/config.toml '.rpc.laddr' -v "tcp://0.0.0.0:26657"

    dasel put -t string -f $CONFIG_FOLDER/config.toml '.moniker' -v "$VALIDATOR_MONIKER"
    dasel put -t string -f $CONFIG_FOLDER/config.toml '.p2p.external_address' -v "$NODE_IP:26656"


    PEERS_LIST=""
    # Add peers
    for peer in $PEERS; do
        # GET the node id from original chain and add peers in this chain
        node_id=$(get_node_id $peer | tr -d '"')
        echo "Node Id - $node_id"
        if [[ $PEERS_LIST != "" ]]; then
            PEERS_LIST="$PEERS_LIST,"
        fi
        PEERS_LIST="$PEERS_LIST$node_id@$peer:26656"
    done

    dasel put -t string -f $CONFIG_FOLDER/config.toml '.p2p.persistent_peers' -v "$PEERS_LIST"

    if [[ $PRIMARY_SNAP_RPC_IP != "" ]]; then
        HEIGHT=$(curl -s "http://$PRIMARY_SNAP_RPC_IP:26657/block" | jq -r .result.block.header.height)
        HEIGHT=$(($HEIGHT - 10000))
        HASH=$(curl -s "http://$PRIMARY_SNAP_RPC_IP:26657/block?height=$HEIGHT" | jq -r .result.block_id.hash)
        # Enable statesync
        dasel put -t bool -f $CONFIG_FOLDER/config.toml '.statesync.enable' -v true
        dasel put -t string -f $CONFIG_FOLDER/config.toml '.statesync.rpc_servers' -v "$SNAP_RPCS"
        dasel put -t string -f $CONFIG_FOLDER/config.toml '.statesync.chunk_fetchers' -v "50"
        dasel put -t string -f $CONFIG_FOLDER/config.toml '.statesync.chunk_request_timeout' -v "600s"
        dasel put -t string -f $CONFIG_FOLDER/config.toml '.statesync.temp_dir' -v "$CHAIN_HOME/tmp/statesync"
        dasel put -t string -f $CONFIG_FOLDER/config.toml '.statesync.trust_height' -v "$HEIGHT"
        dasel put -t string -f $CONFIG_FOLDER/config.toml '.statesync.trust_hash' -v "$HASH"
        dasel put -t string -f $CONFIG_FOLDER/config.toml '.statesync.trust_period' -v "168h0m0s"
    fi
}

edit_client () {
    # Expose the rpc
    dasel put -t string -f $CONFIG_FOLDER/client.toml '.keyring-backend' -v "test"
    dasel put -t string -f $CONFIG_FOLDER/client.toml '.chain-id' -v $CHAIN_ID
}

edit_app () {
    local APP=$CONFIG_FOLDER/app.toml

    # Enable lcd
    dasel put -t bool -f $APP '.api.enable' -v true
    dasel put -t bool -f $APP '.api.enabled-unsafe-cors' -v true
    dasel put -t string -f $APP '.api.address' -v "tcp://0.0.0.0:1317"
    dasel put -t bool -f $APP '.api.swagger' -v true
    dasel put -t string -f $APP '.grpc.address' -v "0.0.0.0:9090"
    dasel put -t bool -f $APP '.grpc.enable' -v true
    # Gas Price
    dasel put -t string -f $APP 'minimum-gas-prices' -v "0.015$DENOM"
}


get_node_id(){
    local ip=$1
    json=$(curl -s "http://$ip:26657/status")

    node_id=$(echo "$json" | dasel -r json '.result.node_info.id')

    echo $node_id
}

if [[ ! -d $CONFIG_FOLDER ]];
then
    echo "🧪 Creating home for $VALIDATOR_MONIKER"
    echo $VALIDATOR_MNEMONIC | $BINARY init $VALIDATOR_MONIKER --chain-id $CHAIN_ID --home $CHAIN_HOME --default-denom $DENOM --recover
    cp /$BINARY/config.toml $CONFIG_FOLDER/config.toml
    cp /$BINARY/genesis.json $CONFIG_FOLDER/genesis.json

    edit_client
    edit_app
    echo "APP Config Updated"
    edit_config
    echo "Complete Config"

    add_account "$VALIDATOR_MNEMONIC" "$VALIDATOR_MONIKER"
fi


echo "🏁 Starting $CHAIN_ID..."
$BINARY start \
    --home $CHAIN_HOME \
    --rpc.laddr tcp://0.0.0.0:26657 \
    --api.enable true \
    --api.swagger true \
    --api.enabled-unsafe-cors true