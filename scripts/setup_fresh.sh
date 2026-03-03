#!/bin/bash

# Usage
# ./setup_fresh.sh <binary> <chain_home> <gas_denom> <stake_denom> <validator_moniker> <funds>
# Example:
# ./scripts/setup_fresh.sh lumentestd lumen-test-1 ./tmp ualpha usync validator 'euclid1z328t58xya5hw32a869n6hah33uaehw5zz9rj3 1000000000000000ualpha,1000000000000000usync'

BINARY=$1
CHAIN_ID=$2
CHAIN_HOME=$3
CONFIG_FOLDER=$CHAIN_HOME/config


GAS_DENOM=$4
STAKE_DENOM=$5

VALIDATOR_MONIKER=$6

# list of addresses and amounts like "euclid12456 1000000ulapha,1000000ustake;euclid12457 1000000ulapha,1000000ustake"
FUNDS=$7

echo "$VALIDATOR_MNEMONIC" | $BINARY init $VALIDATOR_MONIKER --chain-id $CHAIN_ID --home $CHAIN_HOME --default-denom $STAKE_DENOM --recover
echo "$VALIDATOR_MNEMONIC" | $BINARY keys add $VALIDATOR_MONIKER --keyring-backend test --home $CHAIN_HOME --recover

GENESIS=$CONFIG_FOLDER/genesis.json

# Update staking module
dasel put -t string -f $GENESIS '.app_state.staking.params.bond_denom' -v "$STAKE_DENOM"

# Update crisis module
dasel put -t string -f $GENESIS '.app_state.crisis.constant_fee.denom' -v "$STAKE_DENOM"

# Update mint module
dasel put -t string -f $GENESIS '.app_state.mint.params.mint_denom' -v "$STAKE_DENOM"


# Update wasm permission (Nobody or Everybody)
dasel put -t string -f $GENESIS '.app_state.wasm.params.code_upload_access.permission' -v "Everybody"



VALIDATOR_ADDRESS=$($BINARY keys show -a $VALIDATOR_MONIKER --keyring-backend test --home $CHAIN_HOME)
# Split funds list by semicolon and replace with newline
FUNDS_LIST=$(echo $FUNDS | tr ';' '\n')
# Add vaildator account to funds list
FUNDS_LIST="$VALIDATOR_ADDRESS 500000000$STAKE_DENOM\n$FUNDS_LIST"
echo "FUNDS_LIST: $FUNDS_LIST"

# Loop by line
while IFS= read -r FUND; do
    echo "FUND: $FUND"
    ADDRESS=$(echo $FUND | cut -d ' ' -f 1)
    AMOUNT=$(echo $FUND | cut -d ' ' -f 2-)
    echo "Adding genesis account $ADDRESS $AMOUNT"
    $BINARY genesis add-genesis-account $ADDRESS $AMOUNT --home $CHAIN_HOME --keyring-backend test
done < <(echo -e "$FUNDS_LIST")

$BINARY genesis gentx $VALIDATOR_MONIKER 500000000$STAKE_DENOM --keyring-backend test --chain-id $CHAIN_ID --home $CHAIN_HOME
$BINARY genesis collect-gentxs --home $CHAIN_HOME