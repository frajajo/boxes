# Arrête Boxes (dev + packagé) et libère les dossiers de build si possible.
$ErrorActionPreference = 'SilentlyContinue'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

try { npm run stop | Out-Null } catch {}

Start-Sleep -Milliseconds 400

# Instance packagée (Boxes.exe) ou electron lancé depuis win-unpacked
Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -in @('Boxes.exe', 'electron.exe') -and (
      $_.ExecutablePath -like '*\fences-lite\*' -or
      $_.ExecutablePath -like '*\win-unpacked\*' -or
      $_.CommandLine -like '*fences-lite*' -or
      $_.CommandLine -like '*win-unpacked*'
    )
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Start-Sleep -Milliseconds 400

function Remove-DirWithRetry([string]$path, [int]$retries = 5) {
  if (-not (Test-Path $path)) { return $true }
  for ($i = 1; $i -le $retries; $i++) {
    try {
      Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
      return $true
    } catch {
      Start-Sleep -Milliseconds 800
    }
  }
  return $false
}

foreach ($dir in @('build\win-unpacked', 'dist\win-unpacked')) {
  $full = Join-Path $root $dir
  if (-not (Remove-DirWithRetry $full)) {
    Write-Host "Avertissement: impossible de supprimer $dir (fichier verrouille). Fermez Boxes et l'explorateur sur ce dossier."
  }
}

exit 0
