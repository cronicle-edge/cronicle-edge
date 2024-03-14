
@echo off
cd /D "%~dp0"

REM check for custom node version
IF EXIST "%~dp0..\nodejs\node.exe" (
  SET "PATH=%~dp0..\nodejs;%PATH%"
)

node .\storage-cli.js setup

if not "%~1"=="" (
    set "CRONICLE_WebServer__http_port=%1"
    echo CRONICLE_http_port is set to %1
)

node .\cronicle.js --manager --echo --foreground --color