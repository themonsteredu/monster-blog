@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   더몬스터학원 블로그 자동화 - 실행 준비
echo ============================================
echo.
echo [1/2] 필요한 프로그램을 확인/설치합니다 (처음 한 번만 시간이 걸려요)...
python -m pip install -r requirements.txt
echo.
echo [2/2] 프로그램을 켭니다. 잠시 뒤 브라우저가 자동으로 열립니다.
echo        (이 검은 창은 닫지 마세요. 프로그램을 끄려면 이 창을 닫으면 됩니다.)
echo.
python -m streamlit run app.py
pause
