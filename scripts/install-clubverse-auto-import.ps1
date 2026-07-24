$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'run-clubverse-auto-import.ps1'
$taskName = 'ALLVERSE clubVERSE VRChat Log Sync'
$action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$runner`""

schtasks.exe /Create /TN $taskName /TR $action /SC MINUTE /MO 15 /F | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Failed to register scheduled task: $taskName" }

Write-Host "Registered: $taskName"
Write-Host 'New stable VRChat logs will be checked every 15 minutes.'
