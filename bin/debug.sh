#!/bin/sh

# Start Cronicle in debug mode
# No daemon fork, and all logs emitted to stdout
# Add --manager to force instant manager on startup

HOMEDIR="$(dirname "$(cd -- "$(dirname "$0")" && (pwd -P 2>/dev/null || pwd))")"

cd $HOMEDIR
node --trace-warnings $HOMEDIR/lib/main.js --debug --debug_level 9 --echo "$@"
