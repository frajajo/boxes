@echo off
cd /d "%~dp0"
chcp 65001 >nul 2>&1
setlocal

echo.
echo ============================================
echo   Boxes - Build automatique
echo ============================================
echo.

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] npm est introuvable. Installez Node.js puis relancez.
  goto fail
)

set "MODE=%~1"
if "%MODE%"=="" set "MODE=installateur"
set "LAUNCH=1"
if /I "%MODE%"=="nolaunch" set "LAUNCH=0" & set "MODE=installateur"
if /I "%~2"=="nolaunch" set "LAUNCH=0"

set "RUN_MODE=nsis"
if /I "%MODE%"=="portable" goto do_portable
if /I "%MODE%"=="rebuild" goto do_rebuild
if /I "%MODE%"=="installateur" goto do_installateur
if /I "%MODE%"=="help" goto help
if /I "%MODE%"=="/?" goto help
if /I "%MODE%"=="-h" goto help

echo [ERREUR] Argument inconnu: %MODE%
goto help

:do_installateur
echo Mode : installateur NSIS
echo.
echo Etapes automatiques :
echo   1. Arret de Boxes
echo   2. Liberation des dossiers build/dist
echo   3. Increment de version + compilation
if "%LAUNCH%"=="1" echo   4. Installation silencieuse + lancement de Boxes
echo.
call npm run dist
goto check_result

:do_portable
set "RUN_MODE=portable"
echo Mode : version portable
echo.
call npm run dist:portable
goto check_result

:do_rebuild
echo Mode : rebuild natif + installateur
echo.
call npm run rebuild:clean
goto check_result

:check_result
if errorlevel 1 goto fail

echo.
echo ============================================
echo   Build termine avec succes !
echo ============================================
echo.

if "%LAUNCH%"=="1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\open-build-output.ps1 -Launch -Mode %RUN_MODE%
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\open-build-output.ps1
)

if errorlevel 1 goto fail

echo.
if "%LAUNCH%"=="1" (
  echo Boxes a ete installe silencieusement puis lance.
) else (
  echo Astuce : double-cliquez sur le .exe pour installer ou lancer.
)
echo.
pause
exit /b 0

:help
echo.
echo Usage : build.bat [mode] [nolaunch]
echo.
echo   build.bat                 Installateur NSIS + lancement auto
echo   build.bat installateur    Idem
echo   build.bat portable        Executable portable + lancement auto
echo   build.bat rebuild         Rebuild modules natifs + installateur + lancement
echo   build.bat nolaunch        Build sans lancer Boxes a la fin
echo   build.bat installateur nolaunch
echo   build.bat help            Affiche cette aide
echo.
echo Apres le build : installateur /S puis lancement de Boxes.
echo Mode portable : lance directement l executable portable.
echo.
pause
exit /b 0

:fail
echo.
echo ============================================
echo   [ERREUR] Le build a echoue.
echo ============================================
echo.
echo Verifications :
echo   - Quittez Boxes via le systray
echo   - Fermez l explorateur sur les dossiers build ou dist
echo   - Rechargez Cursor si app.asar est verrouille
echo   - Relancez : build.bat
echo.
echo Si build\ est verrouille, un dossier build-YYYYMMDD-HHMMSS sera utilise.
echo.
pause
exit /b 1
