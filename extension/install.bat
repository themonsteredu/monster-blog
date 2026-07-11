@echo off
cd /d C:\blog 2>nul || (mkdir C:\blog & cd /d C:\blog)
echo ================================
echo   Monster Blog - install/update
echo ================================
echo Downloading latest files...
set V=%RANDOM%
curl.exe -L -s -o manifest.json "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/manifest.json?v=%V%"
echo   OK manifest.json
curl.exe -L -s -o popup.html "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/popup.html?v=%V%"
echo   OK popup.html
curl.exe -L -s -o popup.css "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/popup.css?v=%V%"
echo   OK popup.css
curl.exe -L -s -o popup.js "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/popup.js?v=%V%"
echo   OK popup.js
curl.exe -L -s -o background.js "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/background.js?v=%V%"
echo   OK background.js
curl.exe -L -s -o content.js "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/content.js?v=%V%"
echo   OK content.js
curl.exe -L -s -o update.bat "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/update.bat?v=%V%"
echo   OK update.bat
echo.
echo ================================
echo   DONE!  Next 3 steps:
echo   1) Chrome page that just opened: turn ON Developer mode (top right)
echo   2) Click [Load unpacked] and choose the folder:  C:\blog
echo   3) Open the extension and enter your API keys (first time only)
echo   (Updating later? just double-click update.bat then click refresh)
echo ================================
start "" chrome "chrome://extensions"
start "" explorer "C:\blog"
pause
