; installer.nsh - Script NSIS pour Boxes

!macro customHeader
  !system "echo Boxes Installer Build"
!macroend

; S'execute AVANT la verification de process par NSIS
!macro customInstallMode
  nsExec::ExecToLog 'taskkill /F /IM "Boxes.exe" /T'
  Sleep 2500
!macroend

!macro customInstall
  ; Double securite
  nsExec::ExecToLog 'taskkill /F /IM "Boxes.exe" /T'
  Sleep 500
!macroend

!macro customUnInstall

  nsExec::ExecToLog 'taskkill /F /IM "Boxes.exe" /T'
  Sleep 1000

  Delete "$SMPROGRAMS\Boxes V3.0.8\Boxes V3.0.8.lnk"
  Delete "$SMPROGRAMS\Boxes V3.0.8\Desinstaller Boxes V3.0.8.lnk"
  RMDir "$SMPROGRAMS\Boxes V3.0.8"
  Delete "$DESKTOP\Boxes*.lnk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Boxes"

!macroend
