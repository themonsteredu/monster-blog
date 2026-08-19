@echo off
chcp 65001 >nul
rem build_exe.bat — 데스크톱 프로그램을 .exe 로 포장 (개발용 컴퓨터에서 실행)
rem 결과: desktop\dist\MonsterBlog\MonsterBlog.exe
rem 그다음 installer.iss (Inno Setup) 로 '설치파일 하나'로 만들 수 있다.

cd /d "%~dp0"

echo [1/3] 파이썬 확인...
python --version || (echo 파이썬이 없습니다. python.org 에서 설치 후 다시 실행하세요. & pause & exit /b 1)

echo [2/3] 필요한 패키지 설치...
python -m pip install --upgrade pip >nul
python -m pip install selenium anthropic pillow pyinstaller || (echo 패키지 설치 실패 & pause & exit /b 1)

echo [3/3] exe 만들기... (몇 분 걸립니다)
python -m PyInstaller --noconfirm --clean --windowed --name MonsterBlog main.py || (echo 빌드 실패 & pause & exit /b 1)

echo.
echo ============================================
echo  DONE!  결과: desktop\dist\MonsterBlog\MonsterBlog.exe
echo  설치파일로 만들려면: Inno Setup 으로 installer.iss 를 여세요.
echo ============================================
pause
