$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$dashboardDir = Join-Path $projectRoot "dashboard"
$deployDir = Join-Path $projectRoot "pages-deploy"

if (-not (Test-Path $dashboardDir)) {
  throw "Dashboard source folder not found: $dashboardDir"
}

if (Test-Path $deployDir) {
  Get-ChildItem -Force $deployDir | Remove-Item -Recurse -Force
} else {
  New-Item -ItemType Directory -Path $deployDir | Out-Null
}

Copy-Item -Path (Join-Path $dashboardDir "*") -Destination $deployDir -Recurse -Force

Write-Host "pages-deploy rebuilt from dashboard"
Write-Host "Source : $dashboardDir"
Write-Host "Output : $deployDir"
