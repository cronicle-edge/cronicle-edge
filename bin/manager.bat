
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
) else if /I "%1"=="--sqlite" (
    if "%2"=="" (
      echo Sqlite db path is not specified
      exit
    )    
    set CRONICLE_sqlite=%~f2
    echo Using sqlite as storage: %~f2
    shift
    shift
) else if /I "%1"=="--cluster" (
    if "%2"=="" (
      echo Missing cluster value. Specify comma-separatd hostnames
      exit
    )    
    set CRONICLE_cluster=%2
    echo These servers will be added on setup: %2
    shift
    shift
) else if /I "%1"=="--reset" (
  set CRONICLE_RESET=1
  shift
) else if /I "%1"=="--debug" (
  set CRONICLE_debug=1
  shift
) else if /I "%1"=="--help" (
    echo Usage:  .\manager [--port  port] [ --storage /path/to/storage.json] 
    echo         [ --reset ]  # make current host the manager
    echo         [ --cluster "server1,server2"]  # add extra workers on setup
    shift
    exit    
) else (exit)

goto parseArgs

:endArgs

cd /D %SCRIPT_LOC%

REM check for custom node version
IF EXIST "%~dp0..\nodejs\node.exe" (
  SET "PATH=%~dp0..\nodejs;%PATH%"
)

REM setup or reset manager
if "%CRONICLE_RESET%"=="1" (
  node .\storage-cli.js reset || node .\storage-cli.js setup
  echo Croncile manager was reset to current host
) else (
  node .\storage-cli.js setup
)

node .\cronicle.js --manager --echo --foreground --color
