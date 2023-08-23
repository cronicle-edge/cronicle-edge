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
    [Int32]$Page = 0
)

$ErrorActionPreference = "stop"

$conf = Get-Content "$PSScriptRoot\..\conf\config.json" | ConvertFrom-Json -Depth 10


# -------------------- check if process is up
$pidFile = "$PSScriptRoot\..\logs\cronicled.pid"
$proc = $null
$state = "Stopped"
if (Test-Path $pidFile) {
    $p = Get-Content -Raw $pidFile
    $proc = Get-Process -Id $p  -ErrorAction SilentlyContinue
    $state = $proc ? "Running [ $($proc.Id) ]" : "Stopped [ Crashed ]"
}


if ($Command -eq "status") {
    Write-Host "Cronicle is $state"
    exit 0
}

if ($Command -eq "start") {

    $args = [System.Collections.Generic.List[String]]::new()
    
    [void]$args.Add("$PSScriptRoot\cronicle.js")
    [void]$args.Add( "--foreground" )
    if ($Echo.IsPresent) { [void]$args.Add("--echo") }
    if ($WinMon.IsPresent) { [void]$args.Add("--winmon") }
    if ($manager.IsPresent) { [void]$args.Add("--manager") }
    if ($Color.IsPresent) { [void]$args.Add("--color") }

    if($Force.IsPresent) {
        $proc | Stop-Process
        $proc = $null
    }

    if ($proc) { Write-Host "Cronicle already running ($($proc.id)), use -Force to restart"; exit 1 }

    $winStyle = $Hide.IsPresent ? "Hidden" : "Minimized"

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

if ($Command -eq "stop") {

    if(!$proc) {
        Write-Host "Cronicle is not running"; exit 0;
    }


    if ($proc.CloseMainWindow()) {
        $proc.WaitForExit()
        Write-Host "Cronicle has been stopped gracefully"
    }
    else {
        if ($Force.IsPresent) {
            Write-Host ""
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

if ($Command -eq "logs") {
    $logFile = Get-ChildItem "$PSScriptRoot\..\logs\Cronicle.log"
    Write-Host "log file: $logFile"   

    Get-Content -Tail $Tail $logFile
    exit 0
}

if($Command -in "list", "ls") {
    if(!$Key) {
        Write-Host "Specify items to list:"
        Write-Host "[events|servers|server_groups|api_keys|conf_keys|secrets|cats|logs]`n"
        exit 1
    }
        
    if($Key -eq "events") { $Key = "schedule" }
    if($Key -eq "cats") { $Key = "categories" }
     $list = "global/$Key/$Page"
    if($Key -eq "logs") { $list = "logs/activity/$Page" }
    
    $timing = @{n="schedule"; e = {      
        if($_.timing.years) { "custom"}
        elseif ($_.timing.months) {"yearly" }
        elseif ($_.timing.days) {"monthly"}
        elseif ($_.timing.weekdays) {"weekly"}
        elseif ($_.timing.hours) {"daily" }
        elseif ($_.timing.minutes) {"hourly" }
        else {"on demand" }
      } 
    }

    $global:cats = @{}
    $global:plugs = @{}
    if($Key -eq "schedule") {
        node $PSScriptRoot\storage-cli.js get 'global/categories/0' | convertfrom-json | % items | % { $cats[$_.id] = $_.title }
        node $PSScriptRoot\storage-cli.js get 'global/plugins/0' | convertfrom-json | % items | % { $plugs[$_.id] = $_.title }
    }

    $mod = @{name = "mod"; e = {[System.DateTimeOffset]::FromUnixTimeSeconds($_.modified).ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss")}}
    $epoch = @{name = "epoch"; e = {[System.DateTimeOffset]::FromUnixTimeSeconds($_.epoch).ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss")}}
    $notes = @{name="notes"; e={$_.notes.Length -gt 40 ? $_.notes.Substring(0,40) + "..." : $_.notes}}
    $cat = @{name="category"; e = {$cats[$_.category]}}
    $plug = @{name="plugin"; e = {$plugs[$_.plugin]}}

    $propMap = @{
        schedule = @( "title", "id", $cat, $plug, $timing, $mod, $notes )
        logs = @("action", "username", "ip", $epoch )
        api_keys = @("title", $mod, "privileges")
        secrets = @("id", "encrypted", "form")
        categories = @("id", "title", "enabled", "description", $mod)
        plugins = @("id", "title", "enabled", "command", $mod)
        conf_keys = @("title", "key")
    }
    
    $props = $propMap[$Key] ?? "*"
    
    try {
    node $PSScriptRoot\storage-cli.js get $list | convertfrom-json | % items | select $props
    } catch { Write-Host "No such collection"; exit 1}

    exit 0
}


Write-Host "Unknown command: $Command"
exit 1