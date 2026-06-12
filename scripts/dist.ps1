param(
  [ValidateSet('nsis', 'portable')]
  [string]$Target = 'nsis'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

& (Join-Path $PSScriptRoot 'stop-for-build.ps1')

$output = 'build'
$winUnpacked = Join-Path $root (Join-Path $output 'win-unpacked')
if (Test-Path $winUnpacked) {
  $output = 'build-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
  Write-Host ""
  Write-Host "Note: le dossier 'build' est verrouille (Boxes ouvert ou indexation Cursor)."
  Write-Host "      Build de secours dans '$output'."
  Write-Host ""
}

npm version patch --no-git-tag-version
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$configArg = "--config.directories.output=$output"
if ($Target -eq 'portable') {
  npx electron-builder --win portable --x64 $configArg
} else {
  npx electron-builder --win nsis --x64 $configArg
}
exit $LASTEXITCODE
