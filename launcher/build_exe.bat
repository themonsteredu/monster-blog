@echo off
rem build_exe.bat - build MonsterBlog.exe (extension launcher)
rem Output: launcher\dist\MonsterBlog\MonsterBlog.exe
rem NOTE: keep this file ASCII-only. Korean text breaks cmd.exe batch parsing.

cd /d "%~dp0"

echo [0/4] Closing running app and clearing old build...
taskkill /f /im MonsterBlog.exe >nul 2>&1
for /l %%i in (1,1,3) do (
  if exist dist rmdir /s /q dist >nul 2>&1
  if exist build rmdir /s /q build >nul 2>&1
)
if exist dist (
  echo ERROR: cannot delete "dist" - close Explorer windows showing it, then retry.
  pause
  exit /b 1
)

echo [1/4] Checking Python...
python --version
if errorlevel 1 (
  echo ERROR: Python not found. Install from python.org - check "Add python.exe to PATH".
  pause
  exit /b 1
)

echo [2/4] Installing packages...
python -m pip install --upgrade pip
python -m pip install customtkinter pyinstaller
if errorlevel 1 (
  echo ERROR: package install failed. Check your internet connection.
  pause
  exit /b 1
)
python -m pip install --upgrade --force-reinstall pywin32-ctypes

echo [3/4] Building exe... this takes a few minutes, please wait...
python -m PyInstaller --noconfirm --clean --windowed --name MonsterBlog ^
  --collect-all customtkinter ^
  --add-data "..\extension;extension" ^
  launcher.py > build_log.txt 2>&1
if errorlevel 1 (
  echo.
  echo ===== BUILD FAILED - last 25 lines =====
  powershell -NoProfile -Command "Get-Content build_log.txt -Tail 25"
  echo ========================================
  echo Full log: %~dp0build_log.txt
  pause
  exit /b 1
)

echo [4/4] Checking result...
if not exist dist\MonsterBlog\MonsterBlog.exe (
  echo ERROR: MonsterBlog.exe was not created. See build_log.txt
  pause
  exit /b 1
)

echo.
echo ============================================
echo  DONE!  Run it with:   start dist\MonsterBlog\MonsterBlog.exe
echo ============================================
pause
