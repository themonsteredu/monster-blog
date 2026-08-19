@echo off
cd /d C:\blog-desktop 2>nul || (mkdir C:\blog-desktop & cd /d C:\blog-desktop)
echo ==========================================
echo   Monster Blog DESKTOP - install/update
echo ==========================================
echo.
echo [1/3] Downloading latest files...
curl.exe -L -s -o monster.zip "https://codeload.github.com/themonsteredu/monster-blog/zip/refs/heads/main"
tar -xf monster.zip
xcopy /e /y /q monster-blog-main . >nul
rmdir /s /q monster-blog-main
del monster.zip
echo   OK - files are in C:\blog-desktop
echo.
echo [2/3] Checking Python...
python --version 2>nul | findstr /i "Python" >nul
if errorlevel 1 goto NOPYTHON
echo   OK - Python found
echo.
echo [3/3] Installing packages and starting the app...
echo       (first run takes 1-2 minutes - your browser will open)
echo       Keep this black window open. Close it to stop the app.
echo.
python -m pip install -r requirements.txt
python -m streamlit run app.py
echo.
echo If you saw a red error above, take a screenshot and send it.
pause
exit /b

:NOPYTHON
echo   Python is NOT installed on this computer yet.
echo   Opening the Python download page now...
echo.
echo   1) Click the yellow [Download Python] button on that page
echo   2) Run the installer and CHECK the box "Add python.exe to PATH"
echo      (the checkbox is at the BOTTOM of the first screen - important!)
echo   3) When install finishes, double-click install-desktop.bat
echo      in the C:\blog-desktop folder to continue
start "" "https://www.python.org/downloads/"
pause
