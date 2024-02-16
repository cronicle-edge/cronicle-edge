
@echo off
cd /D "%~dp0"

REM check for custom node version
IF EXIST "%~dp0..\nodejs\node.exe" (
  SET "PATH=%~dp0..\nodejs;%PATH%"
)

node .\storage-cli.js setup
node .\cronicle.js --manager --echo --foreground --color