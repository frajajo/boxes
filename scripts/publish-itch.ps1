# Publie Boxes-Setup-<version>.exe sur https://frajajo.itch.io/boxes
# Prerequis (une seule fois) :
#   1. Creer une cle API : https://itch.io/user/settings/api-keys
#   2. Definir :  $env:ITCHIO_API_KEY = "votre_cle"
#      ou lancer : butler login
#
# Usage : powershell -File scripts/publish-itch.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version
$setupName = "Boxes-Setup-$version.exe"
$toolsDir = Join-Path $root 'tools\butler'
$butlerExe = Join-Path $toolsDir 'butler.exe'

function Find-ButlerExe {
  if (Test-Path $butlerExe) { return $butlerExe }
  $nested = Get-ChildItem -Path $toolsDir -Recurse -Filter 'butler.exe' -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
  if ($nested) { return $nested }
  return $null
}

function Ensure-Butler {
  if (Find-ButlerExe) { return }
  Write-Host 'Telechargement de butler...'
  New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
  $zip = Join-Path $toolsDir 'butler.zip'
  $urls = @(
    'https://github.com/itchio/butler/releases/latest/download/butler-windows-amd64.zip',
    'https://broth.itch.zone/butler/windows-amd64/LATEST/archive/default',
    'https://broth.itch.ovh/butler/windows-amd64/LATEST/archive/default'
  )
  $downloaded = $false
  foreach ($url in $urls) {
    try {
      Invoke-WebRequest -Uri $url -OutFile $zip
      $downloaded = $true
      break
    } catch {
      Write-Host "Echec telechargement : $url"
    }
  }
  if (-not $downloaded) { throw 'Impossible de telecharger butler.' }
  Expand-Archive -Path $zip -DestinationPath $toolsDir -Force
  Remove-Item $zip -Force
  if (-not (Find-ButlerExe)) {
    throw 'butler.exe introuvable apres extraction.'
  }
}

function Find-SetupExe {
  $dirs = @(Get-ChildItem -Directory -Path $root -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq 'build' -or $_.Name -like 'build-*' } |
    Sort-Object LastWriteTime -Descending)
  foreach ($dir in $dirs) {
    $candidate = Join-Path $dir.FullName $setupName
    if (Test-Path $candidate) { return $candidate }
  }
  throw "Installateur introuvable : $setupName. Lancez d'abord build.bat nolaunch"
}

Ensure-Butler
$butlerExe = Find-ButlerExe
$setupPath = Find-SetupExe
$staging = Join-Path $root "build\itch-upload-$version"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force -Path $staging | Out-Null
Copy-Item -LiteralPath $setupPath -Destination (Join-Path $staging $setupName)

Write-Host ""
Write-Host "Publication itch.io : frajajo/boxes:windows (v$version)"
Write-Host ""

if ($env:ITCHIO_API_KEY -and -not $env:BUTLER_API_KEY) {
  $env:BUTLER_API_KEY = $env:ITCHIO_API_KEY
}

$butlerArgs = @(
  'push', $staging, 'frajajo/boxes:windows',
  '--userversion', $version,
  '--assume-yes'
)

& $butlerExe @butlerArgs
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host '[ERREUR] Publication echouee.'
  Write-Host 'Authentification requise :'
  Write-Host '  $env:ITCHIO_API_KEY = "votre_cle_api"'
  Write-Host '  https://itch.io/user/settings/api-keys'
  Write-Host 'Puis relancez : powershell -File scripts\publish-itch.ps1'
  exit 1
}

Write-Host ""
Write-Host 'Publication itch.io terminee.'
Write-Host 'https://frajajo.itch.io/boxes'
Write-Host ""
Write-Host 'Mettez a jour manuellement la description de la page (Edit project) :'
Write-Host "  - Version : $version"
Write-Host "  - Fichier : $setupName"
Write-Host '  - Notes : voir CHANGELOG.md section' $version
