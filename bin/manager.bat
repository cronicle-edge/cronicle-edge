
@echo off

set SCRIPT_LOC=%~dp0

:parseArgs

if "%1"=="" goto endArgs

if /I "%1"=="--port" (
    if "%2"=="" (
      echo Specify http port for cronicle
      exit
    )    
    set CRONICLE_WebServer__http_port=%2
    echo Custom port set: %2
    shift
    shift
) else if /I "%1"=="--storage" (
    if "%2"=="" (
      echo Specify path to storage.json config file
      exit
    )
    set CRONICLE_storage_config=%~f2
    echo Custom storage set: %~f2
    shift
    shift
) else if /I "%1"=="--key" (
    if "%2"=="" (
      echo Secret key not specified
      exit
    )    
    set CRONICLE_secret_key=%2
    echo Using custom secret key: *****
    shift
    shift
) else if /I "%1"=="--help" (
    echo Usage:  .\manager [--port  port] [ --storage /path/to/storage.json]
    shift    
) else (exit)

goto parseArgs

:endArgs

cd /D %SCRIPT_LOC%

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
