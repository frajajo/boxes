param(
  [switch]$Launch,
  [ValidateSet('nsis', 'portable', 'any')]
  [string]$Mode = 'any'
)

function Get-InstalledBoxesExe {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Boxes\Boxes.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\boxes\Boxes.exe')
  )
  foreach ($path in $candidates) {
    if (Test-Path $path) { return $path }
  }

  $keyPaths = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($keyPath in $keyPaths) {
    $props = Get-ItemProperty $keyPath -ErrorAction SilentlyContinue
    foreach ($entry in $props) {
      if ($entry.DisplayName -like 'Boxes*' -and $entry.InstallLocation) {
        $exe = Join-Path $entry.InstallLocation 'Boxes.exe'
        if (Test-Path $exe) { return $exe }
      }
    }
  }

  return $null
}

function Start-BoxesIfNeeded([string]$preferredPath) {
  if (Get-Process -Name 'Boxes' -ErrorAction SilentlyContinue) {
    Write-Host 'Boxes est deja en cours d execution.'
    return $true
  }

  $target = $null
  if ($preferredPath -and (Test-Path $preferredPath)) {
    $target = $preferredPath
  } else {
    $target = Get-InstalledBoxesExe
  }

  if (-not $target) {
    Write-Host '[ERREUR] Executable Boxes introuvable apres installation.'
    return $false
  }

  Write-Host ('Lancement de Boxes : ' + $target)
  Start-Process -FilePath $target
  return $true
}

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$dirs = @(Get-ChildItem -Directory -Path $root -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq 'build' -or $_.Name -like 'build-*' } |
  Sort-Object LastWriteTime -Descending)

if (-not $dirs) {
  Write-Host 'Dossier de sortie introuvable.'
  exit 1
}

$out = $dirs[0]
$setup = Get-ChildItem -Path $out.FullName -Filter 'Boxes-Setup-*.exe' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
$portable = Get-ChildItem -Path $out.FullName -Filter 'Boxes-portable-*.exe' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
$unpacked = Join-Path $out.FullName 'win-unpacked\Boxes.exe'

Write-Host ('Dossier : ' + $out.FullName)
if ($setup) { Write-Host ('Installateur : ' + $setup.FullName) }
if ($portable) { Write-Host ('Portable : ' + $portable.FullName) }
if (Test-Path $unpacked) { Write-Host ('win-unpacked : ' + $unpacked) }

explorer $out.FullName

if (-not $Launch) { exit 0 }

if ($Mode -eq 'portable') {
  if (-not $portable) {
    Write-Host '[ERREUR] Executable portable introuvable.'
    exit 1
  }
  Write-Host ''
  Write-Host ('Lancement portable : ' + $portable.FullName)
  Start-Process -FilePath $portable.FullName
  exit 0
}

if ($setup) {
  Write-Host ''
  Write-Host 'Installation silencieuse (reponses automatiques)...'
  Write-Host ('> ' + $setup.FullName + ' /S')
  $proc = Start-Process -FilePath $setup.FullName -ArgumentList '/S' -Wait -PassThru
  if ($proc.ExitCode -ne 0) {
    Write-Host ('[ERREUR] Installateur termine avec le code ' + $proc.ExitCode)
    exit 1
  }

  Start-Sleep -Seconds 1
  if (-not (Start-BoxesIfNeeded)) { exit 1 }
  exit 0
}

if (Test-Path $unpacked) {
  Write-Host ''
  Write-Host ('Lancement win-unpacked : ' + $unpacked)
  Start-Process -FilePath $unpacked
  exit 0
}

if ($portable) {
  Write-Host ''
  Write-Host ('Lancement portable : ' + $portable.FullName)
  Start-Process -FilePath $portable.FullName
  exit 0
}

Write-Host '[ERREUR] Aucun executable Boxes trouve pour le lancement.'
exit 1
