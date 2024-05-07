

param(
  [Parameter(Position = 0)][String]$Path = "dist", # install directory
  [switch]$S3, # bundle s3 engine
  [switch]$SQL, # bundle sql engine with mysql/pgsql/oracle/mssql
  [switch]$Oracle, # bundle sql engine with oracle (oracledb)
  [switch]$MSSQL, # bundle sql engine with mssql (tedious)
  [switch]$Mysql, # bundle sql engine with mysql (mysql2)
  [switch]$Pgsql, # bundle sql engine with postgres (pg)
  [switch]$Sqlite, # for sqlite just bundle plain SQL engine
  [switch]$Redis, # bundle redis engine
  [switch]$Level, # bundle level db engine
  [switch]$Lmdb, # bundle lmdb engine *
  [switch]$Sftp, # bundle sftp engine
  [switch]$Force, # force reinstall if something is broken in node_modules
  [switch]$Dev, # prevent minificaiton and add verbosity
  [Switch]$Restart, # for dev purposes only: it will force kill cronicle if running, and start it over again once bundling is complete
  [Switch]$Tools, # bundle repair/migrate tools
  [Switch]$All, # bundle all storage engines and tools
  [switch]$V, # verbose
  [switch]$Test, # run unit test at the end  
  [ValidateSet("warning", "debug", "info", "warning", "error","silent")][string]$ESBuildLogLevel = "warning",
  [switch]$Help
  # dummy parameters to capture "--" args
  ,[Parameter(Position = 1)][String]$arg1
  ,[Parameter(Position = 2)][String]$arg2
  ,[Parameter(Position = 3)][String]$arg3
  ,[Parameter(Position = 4)][String]$arg4
  ,[Parameter(Position = 5)][String]$arg5

)

foreach ($arg in $PSBoundParameters.Values) {
  if ($arg -eq "--s3") { $S3 = $true }
  if ($arg -eq "--sql") { $SQL = $true }
  if ($arg -eq "--oracle") { $Oracle = $true }
  if ($arg -eq "--mssql") { $MSSQL = $true }
  if ($arg -eq "--mysql") { $Mysql = $true }
  if ($arg -eq "--pgsql") { $Pgsql = $true }
  if ($arg -eq "--sqlite") { $Sqlite = $true }
  if ($arg -eq "--redis") { $Redis = $true }
  if ($arg -eq "--level") { $Level = $true }
  if ($arg -eq "--lmdb") { $Lmdb = $true }
  if ($arg -eq "--sftp") { $Sftp = $true }
  if ($arg -eq "--force") { $Force = $true }
  if ($arg -eq "--dev") { $Dev = $true }
  if ($arg -eq "--restart") { $Restart = $true }
  if ($arg -eq "--tools") { $Tools = $true }
  if ($arg -eq "--all") { $All = $true }
  if ($arg -eq "--test") { $Test = $true }
  if ($arg -eq "--help") { $Help = $true }
  if ($arg -eq "--verbose") { $V = $true }
}

if($Path -like "--*") { 
  # User likely meant some flag, fallback Path to default
  $Path = "dist"
}

if($Help) {
  Write-Host "Usage: ./bundle.ps1 [path\to\dist]  # default bundle location is dist"
  Write-Host " [ -S3 | -Redis | -Lmdb | -Level | -Redis | -Sftp ] # 1 or more storage engines (FS always added)"
  Write-Host " [ -Mysql | -Pgsql | -Sqlite | -Oracle | -MSSQL ] # SQL storage engines"
  Write-Host " [ -Engine engine ] # (for dev) copy storage engine file from sample_conf to dist/conf/storage.json, engine is s3,lmdb,sqlite,..."
  Write-Host " [ -SQL | -All]  # bundle all sql or just all engines "
  Write-Host " [ -Force ]  # force reinstall if something is broken in node_modules "
  Write-Host " [ -Dev ] # prevent minificaiton and add verbosity"
  Write-Host " [ -Restart ] for dev purposes only: it will force kill cronicle if running, and start it over again once bundling is complete"
  Write-Host " [ -V ] # add verbosity"
  Write-Host " [ -Tools ] # bundle repair/migrate tools"
  Write-Host " [ -Help ] # see this message again"
  exit
}

$ErrorActionPreference = 'Stop'

function Write-Bold { param($Text, [switch]$U)
   $b = "[1m"; if($U) {$b = "[1;4m" }; Write-Output "$( [char]27 )$b$Text$( [char]27 )[0m" 
}

$FullPath = mkdir -Force $Path

Write-Bold  "`nInstalling cronicle bundle into $FullPath`n" -U

# Write-Host "-----------------------------------------"
# Write-Host " Installing cronicle bundle into $($Path)"
# Write-Host "-----------------------------------------"

$proc = $null
$pidFile = "$Path\logs\cronicled.pid"

if(Test-Path $pidFile ) {
  $proc = Get-Process -Id $(Get-Content -Raw $pidFile ) -ErrorAction SilentlyContinue
}

if($proc) {
  if($Restart) {
    Write-Host "Shutting down cronicle..."
    if(!$proc.CloseMainWindow()) {Stop-Process -id $proc.Id }
  }
  else {
    Write-Error "Cronicle is still running, stop it first or use -Restart option"
    exit 1
  }
}

# debug settings
$minify = "--minify=true"
$ESBuildLogLevel = "warning"
$npmLogLevel = "warn"

if($Restart) { $minify = "--minify=false" }

if ($Dev) { 
  $minify = "--minify=false" 
  $ESBuildLogLevel = "info"  
  $npmLogLevel = "info"
}

if($V) {
  $ESBuildLogLevel = "info"  
  $npmLogLevel = "info"
}

if($All) {
  $S3 = $true
  $Sftp = $true
  $Lmdb = $true
  $Level = $true
  $Sql = $true 
  $Tools = $true
}

# -------------------------

if(Test-Path $PSScriptRoot\nodejs\node.exe) {
  $env:Path =  "$PSScriptRoot\nodejs\;$env:Path;"
  Write-Warning "Using custom node version $(node -v)"
  # exit 0
}

if (!(Test-Path .\node_modules) -or $Force) {
   Write-Host "`n---- Installing npm packages`n"
   npm install --loglevel $npmLogLevel
   Write-Host "`n-----------------------------------------" 
   }

# add esbuild exe to path if needed
if (!(Get-Command esbuild -ErrorAction SilentlyContinue)) { 
  $env:Path = "$env:Path;$PSScriptRoot\node_modules\@esbuild\win32-x64\"
}

# ---- set up bin and htdocs folders on dist (will overwrite)
# mkdir -Force $Path | Out-Null
Copy-Item -Force -r htdocs $Path/
mkdir -EA SilentlyContinue $Path/htdocs/js/external, $Path/htdocs/css, $Path/htdocs/fonts | Out-Null

mkdir -EA SilentlyContinue $Path/bin | Out-Null
Copy-Item -Force bin/manager.bat, bin/worker.bat, bin/control.sh.ps1 $Path/bin/
Copy-Item bin/win-install.js $Path/bin/install.js
Copy-Item bin/win-uninstall.js $Path/bin/uninstall.js
Copy-Item -Force package.json $Path/bin/

$FullPath = (Get-Item $Path).FullName

# EXTERNAL JS
Copy-Item -Force  `
  node_modules/jquery/dist/jquery.min.js `
  , node_modules/moment/min/moment.min.js `
  , node_modules/moment-timezone/builds/moment-timezone-with-data.min.js `
  , node_modules/chart.js/dist/Chart.min.js `
  , node_modules/jstimezonedetect/dist/jstz.min.js `
  , node_modules/socket.io/client-dist/socket.io.min.js `
  , node_modules/ansi_up/ansi_up.js `
  , node_modules/jquery-ui-dist/jquery-ui.min.js `
  , node_modules/graphlib/dist/graphlib.min.js `
  , node_modules/vis-network/dist/vis-network.min.js `
  , node_modules/xss/dist/xss.min.js `
  , node_modules/jquery-datetimepicker/build/jquery.datetimepicker.full.min.js `
  , node_modules/diff/dist/diff.min.js `
  $Path/htdocs/js/external/

# CSS
Copy-Item -Force htdocs/css/style.css `
  , node_modules/font-awesome/css/font-awesome.min.css `
  , node_modules/@mdi/font/css/materialdesignicons.min.css `
  , node_modules/jquery-ui-dist/jquery-ui.min.css `
  , node_modules/jquery-datetimepicker/build/jquery.datetimepicker.min.css `
  , node_modules/pixl-webapp/css/base.css `
  , node_modules/chart.js/dist/Chart.min.css `
  $Path/htdocs/css/

# FONTS
Copy-Item -Force `
  node_modules/font-awesome/fonts/*.woff2 `
  , node_modules/@mdi/font/fonts/*.woff2 `
  , node_modules/pixl-webapp/fonts/*.woff2 `
  $Path/htdocs/fonts/

# code mirror css (combo)
Get-Content `
	 node_modules/codemirror/lib/codemirror.css `
  , node_modules/codemirror/theme/darcula.css `
  , node_modules/codemirror/theme/solarized.css `
  , node_modules/codemirror/theme/gruvbox-dark.css `
  , node_modules/codemirror/theme/base16-dark.css `
  , node_modules/codemirror/theme/ambiance.css `
  , node_modules/codemirror/theme/nord.css `
  , node_modules/codemirror/addon/scroll/simplescrollbars.css `
  , node_modules/codemirror/addon/display/fullscreen.css `
  , node_modules/codemirror/addon/lint/lint.css `
  , node_modules/codemirror/addon/fold/foldgutter.css `
  > $Path/htdocs/css/codemirror.css

# codemirror js (combo)
Get-Content `
  node_modules/codemirror/lib/codemirror.js `
	 , node_modules/codemirror/addon/scroll/simplescrollbars.js `
	 , node_modules/codemirror/addon/edit/matchbrackets.js `
	 , node_modules/codemirror/addon/selection/active-line.js `
	 , node_modules/codemirror/addon/fold/foldgutter.js `
	 , node_modules/codemirror/addon/fold/foldcode.js `
	 , node_modules/codemirror/addon/fold/brace-fold.js `
	 , node_modules/codemirror/addon/fold/indent-fold.js `
	 , node_modules/codemirror/mode/powershell/powershell.js `
	 , node_modules/codemirror/mode/javascript/javascript.js `
	 , node_modules/codemirror/mode/python/python.js `
	 , node_modules/codemirror/mode/perl/perl.js `
	 , node_modules/codemirror/mode/shell/shell.js `
	 , node_modules/codemirror/mode/groovy/groovy.js `
	 , node_modules/codemirror/mode/clike/clike.js `
	 , node_modules/codemirror/mode/properties/properties.js `
	 , node_modules/codemirror/addon/display/fullscreen.js `
   , node_modules/codemirror/addon/display/placeholder.js `
	 , node_modules/codemirror/mode/xml/xml.js `
	 , node_modules/codemirror/mode/sql/sql.js `
   , node_modules/js-yaml/dist/js-yaml.js `
	 , node_modules/codemirror/addon/lint/lint.js `
	 , node_modules/codemirror/addon/lint/json-lint.js `
	 , node_modules/codemirror/addon/lint/yaml-lint.js `
	 , node_modules/codemirror/addon/mode/simple.js `
	 , node_modules/codemirror/mode/dockerfile/dockerfile.js `
	 , node_modules/codemirror/mode/toml/toml.js `
	 , node_modules/codemirror/mode/yaml/yaml.js `
	 , node_modules/codemirror/addon/comment/comment.js `
  , node_modules/jsonlint-mod/lib/jsonlint.js `
| esbuild $minify > $Path/htdocs/js/codemirror.min.js

# ----- MAIN ------ #

# ----------------------------- CRONICLE FRONT END --------------------------

Get-Content `
  node_modules/pixl-webapp/js/md5.js `
  , node_modules/pixl-webapp/js/oop.js `
  , node_modules/pixl-webapp/js/xml.js `
  , node_modules/pixl-webapp/js/tools.js `
  , node_modules/pixl-webapp/js/datetime.js `
  , node_modules/pixl-webapp/js/page.js `
  , node_modules/pixl-webapp/js/dialog.js `
  , node_modules/pixl-webapp/js/base.js `
| esbuild $minify --keep-names > $Path/htdocs/js/common.min.js

Get-Content `
  htdocs/js/app.js `
  , htdocs/js/pages/Base.class.js `
  , htdocs/js/pages/Home.class.js `
  , htdocs/js/pages/Login.class.js `
  , htdocs/js/pages/Schedule.class.js `
  , htdocs/js/pages/History.class.js `
  , htdocs/js/pages/JobDetails.class.js `
  , htdocs/js/pages/MyAccount.class.js `
  , htdocs/js/pages/Admin.class.js `
  , htdocs/js/pages/admin/Categories.js `
  , htdocs/js/pages/admin/Servers.js `
  , htdocs/js/pages/admin/Users.js `
  , htdocs/js/pages/admin/Plugins.js `
  , htdocs/js/pages/admin/Activity.js `
  , htdocs/js/pages/admin/APIKeys.js `
  , htdocs/js/pages/admin/ConfigKeys.js `
  , htdocs/js/pages/admin/Secrets.js `
| esbuild $minify --keep-names > $Path/htdocs/js/combo.min.js

Copy-Item -Force htdocs/index-bundle.html $Path/htdocs/index.html
  
# -------- Bundle storage-cli and event plugins ----------------------------------------------- #

Write-Bold "Building storage-cli and plugins"

esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/ `
  --external:../conf/config.json --external:../conf/storage.json --external:../conf/setup.json `
  bin/storage-cli.js

if($Tools) {
  Write-Host "     - storage-repair.js"
  esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/ --external:../conf/config.json bin/storage-repair.js
  Write-Host "     - storage-migrate.js"
  esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/ --external:../conf/config.json bin/storage-migrate.js
}
 

esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/  bin/shell-plugin.js
esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/  bin/test-plugin.js
esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/  bin/url-plugin.js
esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/  --loader:.node=file bin/ssh-plugin.js
esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/  --loader:.node=file bin/sshx-plugin.js
esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/  bin/workflow.js
esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/  bin/run-detached.js
esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/ --external:ssh2 bin/docker-plugin.js


# ------------ Bundle Storage Engines ------------------------------ #

Write-Bold "Building Storage Engines:"

$engines = "FS"
Write-Host "     - bundling FS Engine"
esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/engines engines/Filesystem.js

if ($S3 ) {
  Write-Host "     - bundling S3 Engine"
  $engines += ", S3"
  npm i @aws-sdk/client-s3 @aws-sdk/lib-storage --no-save --loglevel silent 
  esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/engines engines/S3.js
}

if ($Redis) { 
  Write-Host "     - bundling Redis Engine"
  $engines += ", Redis"
  npm i redis@3.1.2 --no-save --loglevel silent 
  esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/engines engines/Redis.js
}

if ($Sftp) {
  Write-Host "     - bundling Sftp Engine"
  $engines += ", Sftp"
  npm i ssh2-sftp-client --no-save --loglevel silent 
  esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/engines --loader:.node=file engines/Sftp.js
}

if ($Level) {
  Write-Host "     - bundling Level Engine"
  $engines += ", Level"
  npm i level --no-save --loglevel silent 
  esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/engines engines/Level.js
  $lmdbDir = mkdir -EA SilentlyContinue $Path/bin/engines/prebuilds/win32-x64/
  Copy-Item -Force node_modules\classic-level\prebuilds\win32-x64\node.napi.node $lmdbDir
}

# BUNDLE SQL DRIVERS IF NEEDED

$sqlDrivers = [System.Collections.ArrayList]::new()
$sqlArgs = [System.Collections.ArrayList]::new(@("--bundle", "--minify", "--platform=node", "--outdir=$Path/bin/engines"))
# exclude unused drivers
$sqlArgs.AddRange(@("--external:better-sqlite3", "--external:mysql"))

if($SQL) { $Oracle = $MSSQL = $Mysql = $Pgsql = $true }

$Mysql ? $sqlDrivers.Add("mysql2"): $sqlArgs.Add("--external:mysql2") | Out-Null
$Pgsql ? $sqlDrivers.AddRange(@("pg", "pg-query-stream")) : $sqlArgs.AddRange(@("--external:pg", "--external:pg-query-stream")) | Out-Null
$Oracle ? $sqlDrivers.Add("oracledb@6.5.0") : $sqlArgs.Add("--external:oracledb") | Out-Null
$MSSQL ? $sqlDrivers.Add("tedious") : $sqlArgs.Add("--external:tedious") | Out-Null
$Sqlite ? $sqlDrivers.Add("sqlite3") : $sqlArgs.Add("--external:sqlite3") | Out-Null

# bundle SQL engine if at least 1 SQL driver selected
if($sqlDrivers.Count -gt 0) {
  $sqlInstall = [System.Collections.ArrayList]::new(@("install", "--no-save", "--loglevel", "silent", "knex"))
  $sqlInstall.AddRange($sqlDrivers) | Out-Null
  $sqlArgs.Add("engines/SQL.js") | Out-Null

  Write-Host "     - bundling SQL Engine [$($sqlDrivers -join ",")]"
  $engines += ", SQL [$($sqlDrivers -join ",")]"
  & npm $sqlInstall
  & esbuild $sqlArgs
  if($Sqlite) {
    Copy-Item -Recurse -Force node_modules/sqlite3/build $Path/bin/
  }
}

# Lmdb, need to install lmdb separetly (npm i lmdb)
if($Lmdb) {
  Write-Host "     - bundling Lmdb Engine*"
  $engines += ", Lmdb"
  esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/engines --external:lmdb engines/Lmdb.js 
}

#### ------- SET UP CONFIGS ----- only do it if config folder doesnt exist #
if (!(Test-Path $Path/conf)) {

  Write-Bold "Setting up initial config files"

  Copy-Item -Force -r sample_conf/ $Path/conf

  Remove-Item -Recurse -Force $Path/conf/examples 

  # generate sample secret_key. Please change, or use CRONICLE_secret_key variable to overwrite
  -join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ }) > $Path/conf/secret_key

}

if(Test-Path "sample_conf\examples\storage.$Engine.json") {
  Copy-Item -Force "sample_conf\examples\storage.$Engine.json" $Path\conf\storage.json
}

# no need to fix formidable since using 3.x version
# --- fix  formidable
#Write-Bold "Applyig some patches"
# esbuild --bundle --log-level=$ESBuildLogLevel $minify --keep-names --platform=node --outdir=$Path/bin/plugins node_modules/formidable/src/plugins/*.js

# --- CRONICLE.JS
Write-Bold "Bundling cronicle.js"
esbuild --bundle $minify --keep-names --platform=node --outfile=$Path/bin/cronicle.js lib/main.js

# --- if needed set up npm package in dist folder to install some deps that cannot be bundled
Push-Location $Path
if(!(Test-Path "package.json")) {
  Write-Host " ---- Setting up npm package in $Path `n"
  npm init -y | Out-Null
  npm pkg set name="croniclex"
  npm pkg set bin="bin/control.ps1"
  npm pkg set main="bin/cronicle.js"
  npm pkg set scripts.start="node bin/cronicle.js --foreground --echo --manager --color"
}
if($Lmdb) { npm i "lmdb@2.9.4" --loglevel silent}
Pop-Location

if($Restart) {
  Write-Bold "`Restarting cronicle"
  # ---
  $env:CRONICLE_dev_version="1.x.dev-$([datetime]::Now.ToString("yyyy-MM-dd HH:mm:ss"))"
  Start-Process "$Path\bin\manager" -WindowStyle Minimized 
  #Start-Process node -WindowStyle Minimized -ArgumentList @("$Path\bin\cronicle.js", "--foreground", "--echo", "--manager", "--color")
}

# --- Print setup info / stats
Write-Host "`n [ Bundle is ready: $FullPath ] `n" -ForegroundColor Green
Write-Bold "Info:"
Write-Host "  - minified: $($minify -like '*true*' )"
Write-Host "  - engines bundled: $engines"

if($Restart) {
  Write-Bold "Running in dev mode. Version: $env:CRONICLE_dev_version `n" -U
  exit 0
}

if($env:Path.indexOf("$FullPath\bin") -lt 0) { $env:Path = $env:Path + ";$FullPath\bin"; Write-Host "$Path\bin is added to path variable"}

if(!$Dev -and !$Restart) {  # do not print below info during  dev or debug

Write-Bold "`nBefore you begin:"
Write-Host "  - Configure you storage engine setting in conf/config.json OR conf/storage.json OR CRONICLE_storage_config=/path/to/custom/storage.json"
Write-Host "  - Set you Secret key in conf/congig.json OR via conf/secret_key file OR via CRONICLE_secret_key_file / CRONICLE_secret_key env variables"
Write-Host "  - Init cronicle storage (on the first run): node .\$Path\bin\storage-cli.js setup"
Write-Host "  - Start cronicle as manage: node .\$Path\bin\cronicle.js --echo --foreground --manager --color`n"

Write-Bold  "You can also setup/start cronicle using [manager] entrypoint:"
Write-Host  ".\$Path\bin\manager [ --port 3012 ] [ --storage Path\to\storage.json ] [ --sqlite Path\to\sqlite.db ] [ --key someSecretKey ]`n"

Write-Bold "To Reinstall/upgrade run (please back up $FullPath first):"
Write-Host ".\bundle.ps1 $Path -Force`n"

Write-Bold "To install as Windows Service:" -U
Write-Host "  cd $Path
  npm i node-windows -g
  npm link node-windows
  node bin\install.js
  ### Make sure it's running: Get-Service cronicle
  ### Remove service: node bin\uninstall.js
"
}

# perform unit test if needed
if($Test) {

  Write-Bold "Running unit test"
  Write-Host "     - building test script"
  esbuild --bundle --outdir=$Path/bin/ --platform=node lib/test.js
  node .\node_modules\pixl-unit\unit.js $Path\bin\test.js 
  Remove-Item $Path\bin\test.js 
}