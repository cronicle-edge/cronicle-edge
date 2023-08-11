
@echo off
cd /D "%~dp0"

node .\storage-cli.js setup
node .\cronicle.js --manager --echo --foreground --color