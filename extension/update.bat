@echo off
cd /d "%~dp0"
echo ==============================
echo  Blog extension update start
echo ==============================
set V=%RANDOM%
if not exist prompts mkdir prompts
curl.exe -L -s -o manifest.json "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/manifest.json?v=%V%"
echo   - manifest.json OK
curl.exe -L -s -o popup.html "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/popup.html?v=%V%"
echo   - popup.html OK
curl.exe -L -s -o popup.css "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/popup.css?v=%V%"
echo   - popup.css OK
curl.exe -L -s -o popup.js "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/popup.js?v=%V%"
echo   - popup.js OK
curl.exe -L -s -o prompts\hooks.js "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/prompts/hooks.js?v=%V%"
echo   - prompts/hooks.js OK
curl.exe -L -s -o prompts\body.js "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/prompts/body.js?v=%V%"
echo   - prompts/body.js OK
curl.exe -L -s -o prompts\bridge.js "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/prompts/bridge.js?v=%V%"
echo   - prompts/bridge.js OK
curl.exe -L -s -o background.js "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/background.js?v=%V%"
echo   - background.js OK
curl.exe -L -s -o content.js "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/content.js?v=%V%"
echo   - content.js OK
echo.
echo ==============================
echo  UPDATE DONE!
echo  1) Open chrome://extensions
echo  2) Click refresh button on the extension card
echo ==============================
pause
