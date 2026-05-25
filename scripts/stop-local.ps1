param(
  [int]$Port = 3000,
  [int]$ApiPort = 8787
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stopped = 0

foreach ($TargetPort in @($Port, $ApiPort)) {
  $listeners = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue

  if (-not $listeners) {
    Write-Host "OK: no process is listening on port $TargetPort."
    continue
  }

  foreach ($listener in $listeners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    $commandLine = if ($process) { [string]$process.CommandLine } else { '' }

    if ($commandLine.Contains($ProjectRoot)) {
      Write-Host "Stopping local shared-stack process PID $($listener.OwningProcess) on port $TargetPort."
      Stop-Process -Id $listener.OwningProcess -Force
      $stopped += 1
    } else {
      Write-Host "Skipping PID $($listener.OwningProcess): it is listening on port $TargetPort but does not look like this project."
      if ($commandLine) {
        Write-Host "Command: $commandLine"
      }
    }
  }
}

if ($stopped -gt 0) {
  Write-Host "OK: stopped $stopped local shared-stack process(es)."
} else {
  Write-Host "No matching local shared-stack process was stopped."
}
