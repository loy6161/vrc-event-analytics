# 毎朝 06:20 に VRChatログの自動取り込みを走らせるタスクを登録する。
# 06:20 なのは、App_Dev の夜間同期 data-sync（06:40 JST）より前に Turso へ入れておくため。
# PCが落ちていた朝は StartWhenAvailable で次に起動したときに走る。
$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'run-auto-import-events.ps1'
$taskName = 'ALLVERSE VRChat Log Sync'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $runner)
$trigger = New-ScheduledTaskTrigger -Daily -At 06:20
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Registered: $taskName (毎日 06:20 / PCが落ちていた場合は次回起動時)"
