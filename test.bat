@echo off
cd /d "%~dp0"
chcp 65001 >nul 2>&1
setlocal

echo.
echo ============================================
echo   Boxes - Test developpement
echo ============================================
echo.

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] npm est introuvable. Installez Node.js puis relancez.
  goto fail
)

set "MODE=%~1"
if /I "%MODE%"=="help" goto help
if /I "%MODE%"=="/?" goto help
if /I "%MODE%"=="-h" goto help
if /I "%MODE%"=="rebuild" goto do_rebuild
if /I "%MODE%"=="legacy" goto do_legacy
if /I "%MODE%"=="ole" goto do_ole

goto do_start

:do_rebuild
echo Rebuild du module natif shell_utils...
echo.
call npm run rebuild-native
if errorlevel 1 goto fail
echo.
goto do_start

:do_ole
echo Mode : drag OLE force (--native-dnd)
set "EXTRA_ARGS=--native-dnd"
goto do_start

:do_legacy
echo Mode : drag placeholder legacy (--legacy-dnd)
set "EXTRA_ARGS=--legacy-dnd"
goto do_start

:do_start
echo Arret des instances Boxes en cours...
call npm run stop >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { ($_.Name -eq 'electron.exe' -or $_.Name -eq 'Boxes.exe') -and $_.CommandLine -like '*fences-lite*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 2 /nobreak >nul

for /f "delims=" %%V in ('node -p "require('./package.json').version"') do set "APP_VER=%%V"
echo Version : %APP_VER%
echo Branche  : 
git branch --show-current 2>nul
echo.
echo Stockage des fichiers : Bureau\Boxes\ (dossier masque dans l Explorateur)
for /f "tokens=1,2 delims=|" %%A in ('node -e "const os=require(''os''),p=require(''path''),f=require(''fs'');const home=os.homedir(),od=process.env.OneDrive;const names=[''Desktop'',''Bureau''];const ds=[];for(const n of names){ds.push(p.join(home,n));if(od)ds.push(p.join(od,n));}let desktop=null;for(const d of ds){if(f.existsSync(d)){desktop=d;break;}}if(!desktop)desktop=p.join(home,''Desktop'');const boxes=p.join(desktop,''Boxes'');console.log((f.existsSync(boxes)?''present'':''absent'')+''|''+boxes);"') do (
  if /I "%%A"=="present" echo Dossier present : %%B
  if /I "%%A"=="absent" echo Dossier absent  : %%B ^(cree au demarrage si besoin^)
)
echo.
echo Lancement de Boxes...
echo Fermez Boxes via le systray ou Ctrl+C dans cette fenetre.
echo (Les lignes cache_util au demarrage sont souvent benignes.)
echo.

set "ELECTRON_CLI=%~dp0node_modules\electron\cli.js"
if not exist "%ELECTRON_CLI%" (
  echo [ERREUR] Electron introuvable. Lancez : npm install
  goto fail
)

if defined EXTRA_ARGS (
  node "%ELECTRON_CLI%" . %EXTRA_ARGS%
) else (
  node "%ELECTRON_CLI%" .
)

goto end

:help
echo.
echo Usage : test.bat [mode]
echo          PowerShell : .\test.bat [mode]   ou   .\test.ps1 [mode]
echo.
echo   test.bat           Arrete Boxes puis lance Electron (DnD natif si mode bureau)
echo   test.bat rebuild   Rebuild natif puis lance
echo   test.bat ole       Force le drag OLE (--native-dnd)
echo   test.bat legacy    Force l ancien mode placeholder (--legacy-dnd)
echo   test.bat help      Affiche cette aide
echo.
echo Tests rapides apres le lancement :
echo   1. Verifier Bureau\Boxes\ dans l Explorateur
echo   2. Glisser un fichier du bureau dans une box
echo   3. Glisser un raccourci du bureau public (copie attendue)
echo.
pause
exit /b 0

:fail
echo.
echo ============================================
echo   [ERREUR] Le test a echoue.
echo ============================================
echo.
echo Verifications :
echo   - npm install a ete execute dans ce dossier
echo   - Quittez Boxes via le systray avant de relancer
echo   - Pour un rebuild natif : test.bat rebuild
echo.
pause
exit /b 1

:end
echo.
echo Boxes ferme.
exit /b 0
