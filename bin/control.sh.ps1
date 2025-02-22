param(
    [Parameter(Position = 0)][String]$Command,    
    [Parameter(Position = 1)][String]$Key,
    [int]$Tail = 40, # for logs
    [switch]$Hide,
    [String[]]$CronicleArgs,
    [switch]$WinMon,
    [Switch]$Force,
    [Switch]$Manager,
    [Switch]$Echo,
    [Switch]$Color,

    # list collection items
    [Int32]$Limit = 50,
    [Int32]$Offset = 0,
    [switch]$Full,

    [switch]$Version,
    [switch]$Help
)

$ErrorActionPreference = "stop"

if($Version -OR $Command -eq "version") {  
    Write-Host $(node -p -e "require('./package.json').version")
    exit 0 
}
 
# if this commanfd crashes - there shu;d be something wrong with config file
$conf = Get-Content "$PSScriptRoot\..\conf\config.json" | ConvertFrom-Json -Depth 10 

if (!$Command -OR $Help) {
    Write-Host "Usage:

    .\control.ps1 start [-Manager] [-Echo] [-Force] [-Color] [-WinMon] [-Hide]
         Force: force stop cronicle if running already (Restart)
         WinMon: enable windows event monitor (to catch Windows restart for graceful shutdown)
         Manager: become a manager immediatly (no wait for 60 seconds)
         Echo: print cronicle logs in console
         Hide: start cronicle on the background (this will prevent graceful shutdown, unless you do it from cronicle UI
    .\control.ps1 start -CronicleArgs @('--echo', '--manager', ...) # pass a custom set of parameters to cronicle.js

    .\control.ps1 stop [-Force] # stop cronicle. If running in the background can only stop with -Force (non-graceful shutdown)

    .\control.ps1 status ### check if cronicle is running

    .\control.ps1 logs [-Tail 20]  ## check Cronicle.log records

    .\control.ps1 ls  events|jobs|servers|server_groups|api_keys|conf_keys|secrets|cats|users|logs [-Limit 50] [-Offset 0]  # browse cronicle storage
      examples:
      .\control.ps1 ls events | sort -Property mod -Descending | ft
      .\control.ps1 ls events | sort -Property category -Descending | ft -GroupBy category
      .\control.ps1 ls jobs -Limit 20 | ft

     
"
}

if(Test-Path $PSScriptRoot\..\nodejs\node.exe) {
    $env:Path =  "$PSScriptRoot\..\nodejs\;$env:Path;"
    # Write-Warning "Using custom node version $(node -v)"
  }

# ===========================   LOGS / LS commands first  (no need to check process) ==========================================

# ======================= LOGS =================
if ($Command -eq "logs") {
    $logFile = Get-ChildItem "$PSScriptRoot\..\logs\Cronicle.log"
    Write-Host "log file: $logFile"   
    if($Key) {$Tail = $Key} # control.ps1 
    Get-Content -Tail $Tail $logFile
    exit 0
}

# ======================= LS/LIST =================

if ($Command -in "list", "ls") {
    if (!$Key) { 
        Write-Host " events => global/schedule"
        Write-Host " jobs => logs/completed"
        Write-Host " servers => global/servers"
        Write-Host " groups => global/server_groups"
        Write-Host " api => global/api_keys"
        Write-Host " plugins => global/plugins"
        Write-Host " conf => global/conf_keys"
        Write-Host " cats => global/categories"
        Write-Host " users => global/users"
        Write-Host " logs => logs/activity"
        exit 0
    }
    
    # aliased lists
    $alias = @{
        events = "global/schedule"
        jobs = "logs/completed"
        servers = "global/servers"
        groups = "global/server_groups"
        api = "global/api_keys"
        conf = "global/conf_keys"
        cat = "global/categories"
        categories = "global/categories"
        users = "global/users"
        plugins = "global/plugins"
        plug = "global/plugins"
        logs = "logs/activity"
        secrets = "global/secrets"
        sec = "global/secrets"

    }

    $list = $alias[$Key]
    if(!$list) { $list = $Key}
    
    $timing = @{n = "schedule"; e = {      
            if ($_.timing.years) { "custom" }
            elseif ($_.timing.months) { "yearly" }
            elseif ($_.timing.days) { "monthly" }
            elseif ($_.timing.weekdays) { "weekly" }
            elseif ($_.timing.hours) { "daily" }
            elseif ($_.timing.minutes) { "hourly" }
            else { "on demand" }
        } 
    }

    $global:cats = @{}
    $global:plugs = @{}
    if ($Key -eq "events" -OR $list -eq "global/schedule") {
        node $PSScriptRoot\storage-cli.js list_get 'global/categories' 0 0 1 | convertfrom-json | foreach { $global:cats[$_.id] = $_.title }
        node $PSScriptRoot\storage-cli.js list_get 'global/plugins' 0 0 1 | convertfrom-json |  foreach { $global:plugs[$_.id] = $_.title }
    }

    $mod = @{name = "mod"; e = { [System.DateTimeOffset]::FromUnixTimeSeconds($_.modified).ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss") } }
    $epoch = @{name = "epoch"; e = { [System.DateTimeOffset]::FromUnixTimeSeconds($_.epoch).ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss") } }
    $notes = @{name = "notes"; e = { if($_.notes.Length -gt 40) { $_.notes.Substring(0, 40) + "..." } else { $_.notes } }}
    $cat = @{name = "category"; e = { $cats[$_.category] } }
    $plug = @{name = "plugin"; e = { $plugs[$_.plugin] } }

    #  Adjust layouts for collections
    $propMap = @{
        events   = @( "title", "id", $cat, $plug, $timing, $mod, $notes )
        logs       = @("action", "username", "ip", $epoch )
        api   = @("title", $mod, "privileges")
        secrets    = @("id", "encrypted", "form", "data")
        sec    = @("id", "encrypted", "form", "data")
        cat  = @("id", "title", "enabled", "description", $mod)
        categories  = @("id", "title", "enabled", "description", $mod)
        plugins    = @("id", "title", "enabled", "command", $mod)
        plug    = @("id", "title", "enabled", "command", $mod)
        conf  = @("title", "key")
        jobs = @($epoch, "event_title", "category_title", "plugin_title", "elapsed", "code", 'description')

    }
    
    $props = $propMap[$Key];
    if(!$props)  { $props = "*"}

    $items = node $PSScriptRoot\storage-cli.js list_get $list $Offset $Limit 1 | convertfrom-json
    $items | select $props
    exit 0
}


# ======================================  START/STOP/STATUS === need to check proc


# -------------------- check if process is up

Push-Location "$PSScriptRoot/.."
$pidFile = Get-ChildItem ($env:CRONICLE_pid_file ?? $conf.pid_file ?? "logs\cronicled.pid") -ErrorAction SilentlyContinue
Pop-Location

$proc = $null
$state = "Stopped"
if ($pidFile -AND (Test-Path $pidFile)) {
    $p = Get-Content -Raw $pidFile
    $proc = Get-Process -Id $p  -ErrorAction SilentlyContinue
    $state = "Stopped [ Crashed ]"
    if($proc) { $state = "Running [ $($proc.Id) ]"}
}

# ======================= STATUS=================

if ($Command -eq "status") {
    Write-Host "Cronicle is $state"
    exit 0
}

# ======================= START =================

if ($Command -eq "start") {

    $args = [System.Collections.Generic.List[String]]::new()
    
    [void]$args.Add("$PSScriptRoot\cronicle.js")
    [void]$args.Add( "--foreground" )
    if ($Echo.IsPresent) { [void]$args.Add("--echo") }
    if ($WinMon.IsPresent) { [void]$args.Add("--winmon") }
    if ($manager.IsPresent) { [void]$args.Add("--manager") }
    if ($Color.IsPresent) { [void]$args.Add("--color") }

    if ($Force.IsPresent) {
        $proc | Stop-Process
        $proc = $null
    }

    if ($proc) { Write-Host "Cronicle already running ($($proc.id)), use -Force to restart"; exit 1 }
    
    $winStyle = "Minimized"
    if( $Hide.IsPresent ) { $winStyle = "Hidden" }

    if ($CronicleArgs) {

        Start-Process node -WindowStyle $winStyle -ArgumentList @CronicleArgs
        Write-Host "Cronicle started"

    }
    else {
        # default
        Start-Process node -WindowStyle $winStyle -ArgumentList $args
        Write-Host "Cronicle started"
    }
    
    exit 0
}

# ======================= STOP =================

if ($Command -eq "stop") {

    if (!$proc) {
        Write-Host "Cronicle is not running"; exit 0;
    }


    if ($proc.CloseMainWindow()) {
        $proc.WaitForExit()
        Write-Host "Cronicle has been stopped gracefully"
    }
    else {
        if ($Force.IsPresent) {
            Stop-Process -id $proc.Id
            Write-Host "Cronicle has been stopped (forced)"
        }
        else {
            Write-Host "Cannot shutdown cronicle (it's running in the backgroud)"
            Write-Host "Use -Force option to force kill the process, or shut it down from UI"
        }
    }

    exit 0
}

# ======================= Anything else =================
Write-Host "Unknown command: $Command"
exit 1