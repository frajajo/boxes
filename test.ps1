# Lance test.bat (PowerShell exige .\ pour les scripts du dossier courant)
$bat = Join-Path $PSScriptRoot 'test.bat'
if (-not (Test-Path -LiteralPath $bat)) {
  Write-Error "test.bat introuvable : $bat"
  exit 1
}
& cmd.exe /c "`"$bat`" $args"
exit $LASTEXITCODE
