#!/bin/bash
HOMEDIR="$(dirname "$(cd -- "$(dirname "$(readlink -f "$0")")" && (pwd -P 2>/dev/null || pwd))")"
PS_STORE="$HOME/.dotnet/corefx/cryptography/x509stores/my"
mkdir -p $PS_STORE
input=${1:-$HOMEDIR/*.pfx}

cat $input | openssl pkcs12 -clcerts -nodes | tee "$HOMEDIR/conf/key.pem" | openssl pkcs12 -export -out "$PS_STORE/key.pfx" -passout pass:







