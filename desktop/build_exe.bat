@echo off
rem build_exe.bat - build MonsterBlog.exe (run this on your Windows PC)
rem Output: desktop\dist\MonsterBlog\MonsterBlog.exe
rem NOTE: keep this file ASCII-only. Korean text breaks cmd.exe batch parsing.

cd /d "%~dp0"

echo [1/3] Checking Python...
python --version
if errorlevel 1 (
  echo ERROR: Python not found. Install from python.org - check "Add python.exe to PATH".
  pause
  exit /b 1
)

echo [2/3] Installing packages...
python -m pip install --upgrade pip
python -m pip install selenium anthropic pillow pyinstaller
if errorlevel 1 (
  echo ERROR: package install failed. Check your internet connection.
  pause
  exit /b 1
)

echo [3/3] Building exe... this takes a few minutes, please wait...
python -m PyInstaller --noconfirm --clean --windowed --name MonsterBlog main.py
if errorlevel 1 (
  echo ERROR: build failed.
  pause
  exit /b 1
)

echo.
echo ============================================
echo  DONE!  Output: dist\MonsterBlog\MonsterBlog.exe
echo ============================================
pause
