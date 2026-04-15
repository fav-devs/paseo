@echo off
setlocal

if "%~1"=="" (
  echo Usage: %~nx0 ^<REMOTE_HOST^>
  echo Example: %~nx0 192.168.1.90
  exit /b 1
)

set "REMOTE_HOST=%~1"
set "EXPO_PORT=%EXPO_PORT%"
if "%EXPO_PORT%"=="" set "EXPO_PORT=8090"
set "DAEMON_PORT=%DAEMON_PORT%"
if "%DAEMON_PORT%"=="" set "DAEMON_PORT=9239"
set "EXPO_DEV_URL=http://%REMOTE_HOST%:%EXPO_PORT%"
set "EXPO_PUBLIC_LOCAL_DAEMON=%REMOTE_HOST%:%DAEMON_PORT%"
set "PASEO_REPO_ROOT=%CD%"

echo REMOTE_HOST=%REMOTE_HOST%
echo EXPO_PORT=%EXPO_PORT%
echo DAEMON_PORT=%DAEMON_PORT%
echo EXPO_DEV_URL=%EXPO_DEV_URL%
echo EXPO_PUBLIC_LOCAL_DAEMON=%EXPO_PUBLIC_LOCAL_DAEMON%
echo PASEO_REPO_ROOT=%PASEO_REPO_ROOT%
echo.

if not "%PASEO_CLOSE_INSTALLED%"=="0" (
  echo Closing installed Paseo app to avoid single-instance lock...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-Process Paseo -ErrorAction SilentlyContinue ^| Where-Object { $_.Path -like 'C:\Program Files\Paseo\*' }; if ($p) { $p ^| Stop-Process -Force; Start-Sleep -Milliseconds 300 }"
)

echo Launching remote desktop client...
echo Note: In app settings, disable "Manage built-in daemon" to avoid auto-starting local Windows daemon.
echo.

if not exist "packages\desktop" (
  echo Error: run this from your paseo repo root.
  exit /b 1
)

npx electron packages/desktop
