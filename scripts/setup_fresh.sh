#!/bin/sh
set -eo pipefail

# Usage
# ./setup_fresh.sh <binary> <chain_home> <gas_denom> <stake_denom> <validator_moniker> <funds>

BINARY=$1

CHAIN_HOME=$2
CONFIG_FOLDER=$CHAIN_HOME/config


GAS_DENOM=$3
STAKE_DENOM=$4

VALIDATOR_MONIKER=$5
# list of addresses and amounts like "euclid12456 1000000ulapha,1000000ustake;euclid12457 1000000ulapha,1000000ustake"
FUNDS=$6

GENESIS=$CONFIG_FOLDER/genesis.json

# Update staking module
dasel put -t string -f $GENESIS '.app_state.staking.params.bond_denom' -v "$STAKE_DENOM"

# Update crisis module
dasel put -t string -f $GENESIS '.app_state.crisis.constant_fee.denom' -v "$STAKE_DENOM"

# Update mint module
dasel put -t string -f $GENESIS '.app_state.mint.params.mint_denom' -v "$STAKE_DENOM"


# Update wasm permission (Nobody or Everybody)
dasel put -t string -f $GENESIS '.app_state.wasm.params.code_upload_access.permission' -v "Everybody"



edit_genesis


VALIDATOR_ADDRESS=$($BINARY keys show -a $VALIDATOR_MONIKER --keyring-backend test --home $CHAIN_HOME)
# Split funds list by semicolon and replace with newline
FUNDS_LIST=$(echo $FUNDS | tr ';' '\n')
echo "FUNDS_LIST: $FUNDS_LIST"
# Add vaildator account to funds list
FUNDS_LIST="$VALIDATOR_ADDRESS 500000000$STAKE_DENOM\n$FUNDS_LIST"
for FUND in $FUNDS_LIST; do
    ADDRESS=$(echo $FUND | cut -d ' ' -f 1)
    AMOUNT=$(echo $FUND | cut -d ' ' -f 2)
    $BINARY add-genesis-account $ADDRESS $AMOUNT --home $CHAIN_HOME --keyring-backend test
done

$BINARY genesis gentx $VALIDATOR_MONIKER 500000000$STAKE_DENOM --keyring-backend test --chain-id $CHAIN_ID --home $CHAIN_HOME
$BINARY genesis collect-gentxs --home $CHAIN_HOME