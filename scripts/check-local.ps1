param(
  [int]$Port = 3000,
  [int]$ApiPort = 8787
)

$ErrorActionPreference = 'Stop'
$WebUrl = "http://localhost:$Port/"
$ApiHealthUrl = "http://localhost:$ApiPort/api/health"
$DbHealthUrl = "http://localhost:$ApiPort/api/db/health"

function Assert-HttpOk {
  param(
    [string]$Name,
    [string]$TargetUrl
  )

  try {
    $response = Invoke-WebRequest -Uri $TargetUrl -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      Write-Host "OK: $Name is reachable at $TargetUrl (HTTP $($response.StatusCode))."
      return
    }
    throw "$TargetUrl responded with HTTP $($response.StatusCode)."
  } catch {
    Write-Host "ERROR: $Name is not reachable at $TargetUrl."
    Write-Host $_.Exception.Message
    throw
  }
}

try {
  Assert-HttpOk -Name 'local web app' -TargetUrl $WebUrl
  Assert-HttpOk -Name 'local API' -TargetUrl $ApiHealthUrl
  Assert-HttpOk -Name 'local database API' -TargetUrl $DbHealthUrl
  Write-Host "OK: shared local app is ready. Team task results use the shared PostgreSQL data source."
  exit 0
} catch {
  foreach ($TargetPort in @($Port, $ApiPort)) {
    $listener = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
      Write-Host "A process is listening on port ${TargetPort}:"
      Write-Host "PID: $($listener.OwningProcess)"
      if ($process) {
        Write-Host "Command: $($process.CommandLine)"
      }
    } else {
      Write-Host "No process is listening on port $TargetPort."
    }
  }
  Write-Host "Run npm.cmd run local:start to start the shared local stack."
  exit 1
}
