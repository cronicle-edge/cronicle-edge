
@echo off

set SCRIPT_LOC=%~dp0
set DEBUG=0

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
) else if /I "%1"=="--sqlstring" (
    if "%2"=="" (
      echo Connection string is not specified
      exit
    )    
    set CRONICLE_sqlstring=%2
    echo Using custom SQL db as storage    
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
  set DEBUG=1
  shift
) else if /I "%1"=="--help" (
    echo Usage:  .\manager [--port  port] [ --storage /path/to/storage.json] 
    echo         [ --reset ]  # make current host the manager
    echo         [ --cluster "server1,server2"]  # add extra workers on setup
    echo         [ --debug ] # enable debug mode
    echo         [ --sqlite C:/path/to/sqlite.db ] # use sqlite as engine
    echo         [ --sqlstring 'driver://user:password@host:port/db' ] # use sql engine [pg/mysql2/mssql/oracledb]
    shift
    exit    
) else (exit)

goto parseArgs

:endArgs

if defined GIT_REPO (
  echo Error: GIT_REPO bootstrap is unsupported and was deprecated; restore data explicitly before starting the manager. 1>&2
  exit /b 1
)

cd /D %SCRIPT_LOC%

REM check for custom node version
IF EXIST "%~dp0..\nodejs\node.exe" (
  SET "PATH=%~dp0..\nodejs;%PATH%"
)

REM setup or reset manager
if "%CRONICLE_RESET%"=="1" (
  node .\storage-cli.js reset || node .\storage-cli.js setup
  if errorlevel 1 goto setup_failed
  echo Croncile manager was reset to current host
) else (
  node .\storage-cli.js setup
  if errorlevel 1 goto setup_failed
)

node .\cronicle.js --manager --echo --foreground --color --debug %DEBUG%
exit /b

:setup_failed
exit /b 1
