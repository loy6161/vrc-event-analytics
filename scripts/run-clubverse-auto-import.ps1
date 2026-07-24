param(
  [switch]$DryRun,
  [switch]$Rescan,
  [int]$Days = 120
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
  $args = @('--import', 'tsx', 'scripts/auto-import-clubverse.ts', "--days=$Days")
  if ($DryRun) { $args += '--dry-run' }
  if ($Rescan) { $args += '--rescan' }
  & node @args
  if ($LASTEXITCODE -ne 0) { throw "Auto import exited with code $LASTEXITCODE" }
} finally {
  Pop-Location
}
