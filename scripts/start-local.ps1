param(
  [int]$Port = 3000,
  [int]$ApiPort = 8787,
  [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Url = "http://localhost:$Port/"
$ApiUrl = "http://localhost:$ApiPort/api/health"
$DbUrl = "http://localhost:$ApiPort/api/db/health"
$OutLog = Join-Path $ProjectRoot '.codex-local-full.out.log'
$ErrLog = Join-Path $ProjectRoot '.codex-local-full.err.log'

function Test-HttpOk {
  param([string]$TargetUrl)

  try {
    $response = Invoke-WebRequest -Uri $TargetUrl -UseBasicParsing -TimeoutSec 4
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Stop-ProjectListener {
  param([int]$TargetPort)

  $listeners = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    $commandLine = if ($process) { [string]$process.CommandLine } else { '' }
    if ($commandLine.Contains($ProjectRoot)) {
      Write-Host "Stopping stale project process PID $($listener.OwningProcess) on port $TargetPort."
      Stop-Process -Id $listener.OwningProcess -Force
    } else {
      Write-Host "Port $TargetPort is occupied by a non-project process PID $($listener.OwningProcess)."
      if ($commandLine) { Write-Host "Command: $commandLine" }
      throw "Cannot start shared local stack while port $TargetPort is occupied."
    }
  }
}

if ((Test-HttpOk $Url) -and (Test-HttpOk $ApiUrl) -and (Test-HttpOk $DbUrl)) {
  Write-Host "OK: shared local stack is already running."
  Write-Host "Web: $Url"
  Write-Host "API: http://localhost:$ApiPort"
  if ($OpenBrowser) { Start-Process $Url }
  exit 0
}

Stop-ProjectListener -TargetPort $Port
Stop-ProjectListener -TargetPort $ApiPort

if (-not (Test-Path (Join-Path $ProjectRoot 'node_modules'))) {
  Write-Host "node_modules not found. Installing dependencies with npm.cmd install..."
  Push-Location $ProjectRoot
  try {
    & npm.cmd install
  } finally {
    Pop-Location
  }
}

"[$(Get-Date -Format o)] Starting shared local stack with npm.cmd run dev:full" | Out-File -LiteralPath $OutLog -Encoding utf8
"[$(Get-Date -Format o)] stderr log" | Out-File -LiteralPath $ErrLog -Encoding utf8

$process = Start-Process `
  -FilePath 'npm.cmd' `
  -ArgumentList @('run', 'dev:full') `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $OutLog `
  -RedirectStandardError $ErrLog `
  -PassThru

Write-Host "Started shared local stack process PID $($process.Id). Waiting for $Url and $ApiUrl ..."

for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 1

  if ((Test-HttpOk $Url) -and (Test-HttpOk $ApiUrl) -and (Test-HttpOk $DbUrl)) {
    Write-Host "OK: shared local stack is reachable."
    Write-Host "Web: $Url"
    Write-Host "API: http://localhost:$ApiPort"
    Write-Host "Logs:"
    Write-Host "  $OutLog"
    Write-Host "  $ErrLog"
    if ($OpenBrowser) { Start-Process $Url }
    exit 0
  }

  if ($process.HasExited) {
    Write-Host "ERROR: shared local stack process exited early with code $($process.ExitCode)."
    Write-Host "Last stdout:"
    Get-Content -LiteralPath $OutLog -Tail 80 -ErrorAction SilentlyContinue
    Write-Host "Last stderr:"
    Get-Content -LiteralPath $ErrLog -Tail 80 -ErrorAction SilentlyContinue
    exit 1
  }
}

Write-Host "ERROR: shared local stack did not become reachable within 90 seconds."
Write-Host "PID $($process.Id) may still be running. Check logs:"
Write-Host "  $OutLog"
Write-Host "  $ErrLog"
exit 1
