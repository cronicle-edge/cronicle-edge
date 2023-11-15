
# $Path = "dist"
# if($args[0]) { $Path = $args[0] }
param(
  [Parameter(Position = 0)][String]$Path = "dist", # install directory
  [switch]$S3, # bundle s3 engine
  [switch]$SQL, # bundle sql engine with mysql/pgsql
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
  [ValidateSet("warning", "debug", "info", "warning", "error","silent")][string]$ESBuildLogLevel = "warning"

)

$ErrorActionPreference = 'Stop'

Write-Host "-----------------------------------------"
Write-Host " Installing cronicle bundle into $Path"
Write-Host "-----------------------------------------"

$proc = $null
$pidFile = "$Path\logs\cronicled.pid"

if(Test-Path $pidFile ) {
  $proc = Get-Process -Id $(Get-Content -Raw $pidFile ) -ErrorAction SilentlyContinue
}

if($proc) {
  if($Restart.IsPresent) {
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

if ($Dev.IsPresent) { 
  $minify = "--minify=false" 
  $ESBuildLogLevel = "info"  
  $npmLogLevel = "info"
}

if($V.IsPresent) {
  $ESBuildLogLevel = "info"  
  $npmLogLevel = "info"
}

if($All.IsPresent) {
  $S3 = $true
  $Sftp = $true
  $Lmdb = $true
  $Level = $true
  $Sql = $true 
  $Tools = $true
}
# -------------------------

if (!(Get-Command esbuild -ErrorAction SilentlyContinue)) { npm i esbuild -g --loglevel warn }

if (!(Test-Path .\node_modules) -or $Force.IsPresent) {
   Write-Host "`n---- Installing npm packages`n"
   npm install --loglevel $npmLogLevel
   Write-Host "`n-----------------------------------------" 
   }


# ---- set up bin and htdocs folders on dist (will overwrite)
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

Write-Host "`n ---- Building storage-cli and plugins`n"

esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/ `
  --external:../conf/config.json --external:../conf/storage.json --external:../conf/setup.json `
  bin/storage-cli.js

if($Tools.IsPresent) {
  Write-Host "     - storage-repair.js`n"
  esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/ --external:../conf/config.json bin/storage-repair.js
  Write-Host "     - storage-migrate.js`n"
  esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/ --external:../conf/config.json bin/storage-migrate.js
}
 

esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/  bin/shell-plugin.js
esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/  bin/test-plugin.js
esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/  bin/url-plugin.js
esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/  --loader:.node=file bin/ssh-plugin.js
esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/  bin/workflow.js
esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/  bin/run-detached.js


# ------------ Bundle Storage Engines ------------------------------ #

Write-Host "`n ---- Building Storage Engines:`n"

$engines = "FS"
Write-Host "     - bundling FS Engine`n"
esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/engines engines/Filesystem.js

if ($S3.IsPresent ) {
  Write-Host "     - bundling S3 Engine`n"
  $engines += ", S3"
  npm i @aws-sdk/client-s3 @aws-sdk/lib-storage --no-save --loglevel silent 
  esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/engines engines/S3.js
}

if ($Redis.IsPresent) { 
  Write-Host "     - bundling Redis Engine`n"
  $engines += ", Redis"
  npm i redis@3.1.2 --no-save --loglevel silent 
  esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/engines engines/Redis.js
}

if ($Sftp.IsPresent) {
  Write-Host "     - bundling Sftp Engine`n"
  $engines += ", Sftp"
  npm i ssh2-sftp-client --no-save --loglevel silent 
  esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/engines --loader:.node=file engines/Sftp.js
}

if ($Level.IsPresent) {
  Write-Host "     - bundling Level Engine`n"
  $engines += ", Level"
  npm i level --no-save --loglevel silent 
  esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/engines engines/Level.js
  $lmdbDir = mkdir -EA SilentlyContinue $Path/bin/engines/prebuilds/win32-x64/
  Copy-Item -Force node_modules\classic-level\prebuilds\win32-x64\node.napi.node $lmdbDir
}

if ($SQL.IsPresent) {
  Write-Host "     - bundling SQL Engine*`n"
  $engines += ", SQL"
  npm i knex pg pg-query-stream mysql2 --no-save --loglevel silent 
  # SQL engine bundle up knex, mysql2 and pg. You can install sqlite3, oracledb, tedious separetly
  esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --external:oracledb --external:sqlite3 `
    --external:mysql  --external:tedious --external:pg-native --external:better-sqlite3  `
    --outdir=$Path/bin/engines engines/SQL.js
}

# Lmdb, need to install lmdb separetly (npm i lmdb)
if($Lmdb.IsPresent) {
  Write-Host "     - bundling Lmdb Engine*`n"
  $engines += ", Lmdb"
  esbuild --bundle --log-level=$ESBuildLogLevel $minify --platform=node --outdir=$Path/bin/engines --external:lmdb engines/Lmdb.js 
}



#### ------- SET UP CONFIGS ----- only do it if config folder doesnt exist #
if (!(Test-Path $Path/conf)) {

  Write-Host "`n ---- Setting up initial config files`n"

  Copy-Item -Force -r sample_conf/ $Path/conf

  Remove-Item -Recurse -Force $Path/conf/examples 

  # generate sample secret_key. Please change, or use CRONICLE_secret_key variable to overwrite
  -join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ }) > $Path/conf/secret_key

}

# --- CRONICLE.JS
Write-Host "`n ---- Bundling cronicle.js`n"
esbuild --bundle $minify --keep-names --platform=node --outfile=$Path/bin/cronicle.js lib/main.js

# --- fix  formidable
Write-Host "`n ---- Applyig some patches"
esbuild --bundle --log-level=$ESBuildLogLevel $minify --keep-names --platform=node --outdir=$Path/bin/plugins node_modules/formidable/src/plugins/*.js

#  --------------- Final Clean up  ---------------------------

# Remove-Item -Recurse -Force `
#   $Path/bin/jars `
#   , $Path/bin/cms `
#   , $Path/bin/cronicled.init `
#   , $Path/bin/importkey.sh `
#   , $Path/bin/debug.sh `
#   , $Path/bin/java-plugin.js `
#   , $Path/bin/install.js `
#   , $Path/bin/build.js `
#   , $Path/bin/build-tools.js `


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
if($Lmdb.IsPresent) { npm i lmdb --loglevel silent}
Pop-Location


if($Restart.IsPresent) {
  Write-Host "`n---- Restarting cronicle`n"
  # ---
  $env:CRONICLE_dev_version="1.x.dev-$([datetime]::Now.ToString("yyyy-MM-dd HH:mm:ss"))"
  Start-Process node -WindowStyle Minimized -ArgumentList @("$Path\bin\cronicle.js", "--foreground", "--echo", "--manager", "--color")
}

# --- Print setup info / stats
Write-Host "`n-------------------------------------------------------------------------------------------------------------------------------------------`n"
Write-Host "Bundle is ready: $FullPath `n" -ForegroundColor Green
Write-Host "Minified: $(!$Dev.IsPresent)"
Write-Host "Engines bundled: $engines"
if($SQL.IsPresent) {
  Write-Host " * SQL bundle includes mysql and postgres drivers. You can additionally install sqlite3, oracledb, tedious (for mssql)"
}
if($Lmdb.IsPresent) {
  Write-Host " * Lmdb cannot be fully bundled. lmdb package is installed in the dist folder using npm"
}

if($Restart.IsPresent) {
  Write-Host "Running in dev mode. Version: $env:CRONICLE_dev_version `n"
  exit 0
}

if($env:Path.indexOf("$FullPath\bin") -lt 0) { $env:Path = $env:Path + ";$FullPath\bin"; Write-Host "$Path\bin is added to path variable"}

Write-Host "
Before you begin:
 - Configure you storage engine setting in conf/config.json || conf/storage.json || CRONICLE_storage_config=/path/to/custom/storage.json
 - Set you Secret key in conf/congig.json || conf/secret_key file || CRONICLE_secret_key_file || CRONICLE_secret_key env variables

To setup cronicle storage (on the first run):
 node .\$Path\bin\storage-cli.js setup

Start as manager in foreground:
 node .\$Path\bin\cronicle.js --echo --foreground --manager --color

Or  both together: .\$Path\bin\manager

-------------------------------------------------------------------------------------------------------------------------------------------

to reinstall/upgrade run (please back up $FullPath first):
 .\bundle.ps1 $Path -Force

to install as windows service:
  cd $Path
  npm i node-windows -g
  npm link node-windows
  node bin\install.js

test: Get-Service cronicle

to remove service:
  node bin\uninstall.js

"
