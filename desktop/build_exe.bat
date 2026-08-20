@echo off
rem build_exe.bat - build MonsterBlog.exe (run this on your Windows PC)
rem Output: desktop\dist\MonsterBlog\MonsterBlog.exe
rem NOTE: keep this file ASCII-only. Korean text breaks cmd.exe batch parsing.

cd /d "%~dp0"

echo [0/4] Closing running app and clearing old build...
taskkill /f /im MonsterBlog.exe >nul 2>&1
taskkill /f /im chromedriver.exe >nul 2>&1
rem Explorer can hold the dist folder open; retry a few times.
for /l %%i in (1,1,3) do (
  if exist dist rmdir /s /q dist >nul 2>&1
  if exist build rmdir /s /q build >nul 2>&1
)
if exist dist (
  echo.
  echo ERROR: cannot delete the "dist" folder - something still has it open.
  echo   1. Close every Explorer window showing MonsterBlog or dist
  echo   2. Close the MonsterBlog app and any Chrome window it opened
  echo   3. If it still fails, restart Windows and run this again
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
python -m pip install selenium anthropic pillow customtkinter pyinstaller
if errorlevel 1 (
  echo ERROR: package install failed. Check your internet connection.
  pause
  exit /b 1
)
rem Microsoft Store Python ships a broken pywin32-ctypes ("Could not import pywintypes")
python -m pip install --upgrade --force-reinstall pywin32-ctypes

echo [3/4] Building exe... this takes a few minutes, please wait...
rem --collect-all: selenium/customtkinter load parts lazily, PyInstaller misses them otherwise
rem Full output goes to build_log.txt so the error can be read afterwards.
python -m PyInstaller --noconfirm --clean --windowed --name MonsterBlog --collect-all selenium --collect-all anthropic --collect-all customtkinter main.py > build_log.txt 2>&1
if errorlevel 1 (
  echo.
  echo ===== BUILD FAILED - last 25 lines =====
  powershell -NoProfile -Command "Get-Content build_log.txt -Tail 25"
  echo ========================================
  echo Full log saved to: %~dp0build_log.txt
  echo.
  echo TIP: you do NOT need the exe to test. Just run:   python main.py
  pause
  exit /b 1
)

echo [4/4] Checking result...
if not exist dist\MonsterBlog\MonsterBlog.exe (
  echo ERROR: MonsterBlog.exe was not created.
  pause
  exit /b 1
)

echo.
echo ============================================
echo  DONE!  Run it with:   start dist\MonsterBlog\MonsterBlog.exe
echo ============================================
pause
