param(
  [switch]$DryRun,
  [switch]$Rescan,
  [switch]$AllDays,
  [int]$Days = 120,
  [string]$Dir
)

# VRChatログの自動取り込み（台帳に登録済みのVR開催日だけ）。
# タスクスケジューラ 'ALLVERSE VRChat Log Sync' から毎朝呼ばれる。
$ErrorActionPreference = 'Stop'
# node の出力はUTF-8。指定しないとログが文字化けする
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
$logFile = Join-Path $root 'scripts\_auto-import-events.log'

Push-Location $root
try {
  $argv = @('--import', 'tsx', 'scripts/auto-import-events.ts', "--days=$Days")
  if ($DryRun)  { $argv += '--dry-run' }
  if ($Rescan)  { $argv += '--rescan' }
  if ($AllDays) { $argv += '--all-days' }
  if ($Dir)     { $argv += "--dir=$Dir" }

  $out = & node @argv 2>&1
  $out | Write-Host
  Add-Content -Path $logFile -Encoding utf8 -Value ("--- {0}`n{1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), ($out -join "`n"))
  if ($LASTEXITCODE -ne 0) { throw "auto-import-events exited with code $LASTEXITCODE" }
} finally {
  Pop-Location
}
