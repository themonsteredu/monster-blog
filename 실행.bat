@echo off
cd /d "%~dp0"
echo ============================================
echo   monster-blog - blog automation
echo ============================================
echo.
echo [1/2] Installing required packages...
echo       (first run takes 1-2 minutes, please wait)
echo.
python -m pip install -r requirements.txt
echo.
echo [2/2] Starting the app. Your browser will open shortly.
echo       Keep this black window open. Close it to stop the app.
echo.
python -m streamlit run app.py
echo.
echo If you see a red error above, take a screenshot.
pause
