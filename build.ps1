# Lance build.bat (PowerShell : .\build.ps1)
$bat = Join-Path $PSScriptRoot 'build.bat'
if (-not (Test-Path -LiteralPath $bat)) {
  Write-Error "build.bat introuvable : $bat"
  exit 1
}
& cmd.exe /c "`"$bat`" $args"
exit $LASTEXITCODE
