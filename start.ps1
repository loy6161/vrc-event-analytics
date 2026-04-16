# VRChat Event Analytics — Production Start Script (PowerShell)
# Usage: .\start.ps1 [port]

param(
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

Write-Host "VRChat Event Analytics" -ForegroundColor Cyan
Write-Host "======================" -ForegroundColor Cyan

# Check Node.js
try {
    $nodeVersion = node --version
    Write-Host "Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Node.js is not installed or not in PATH." -ForegroundColor Red
    exit 1
}

# Check dist/ exists
$distPath = Join-Path $PSScriptRoot "dist"
if (-not (Test-Path $distPath)) {
    Write-Host ""
    Write-Host "dist/ not found. Building frontend..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed." -ForegroundColor Red
        exit 1
    }
}

# Check better-sqlite3 bindings
Write-Host ""
Write-Host "Checking database bindings..." -ForegroundColor Yellow
$bindingsCheck = node -e "try { require('better-sqlite3'); process.exit(0) } catch { process.exit(1) }" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: better-sqlite3 native bindings not found." -ForegroundColor Yellow
    Write-Host "  → Run: npm rebuild better-sqlite3" -ForegroundColor Yellow
    Write-Host "  → Requires Visual Studio Build Tools (C++ Desktop workload)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "The server will start but database features will be unavailable." -ForegroundColor Yellow
    Write-Host ""
}

# Start server
Write-Host "Starting server on port $Port ..." -ForegroundColor Green
Write-Host "  → http://localhost:$Port" -ForegroundColor Cyan
Write-Host ""

$env:PORT = $Port
$env:NODE_ENV = "production"
node --import tsx server/index.ts
