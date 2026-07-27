@echo off
chcp 65001 >nul
REM ============================================================
REM  쇼핑쇼츠 메이커 - 코어(8000) + 웹(3000) 한 번에 실행
REM  PC + 폰 + 아이패드(같은 와이파이) 접속
REM ============================================================
set "ROOT=%~dp0"
set "FFBIN=C:\Users\PC\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.2-full_build\bin"
set "GITCMD=C:\Program Files\Git\cmd"
set "NODEDIR=C:\Program Files\nodejs"

REM --- 코어 서버(8000) 새 창으로 실행 (venv + ffmpeg + git PATH) ---
start "shopping-shorts CORE :8000" cmd /k "chcp 65001 >nul & cd /d "%ROOT%packages\core" & set "PATH=%ROOT%packages\core\.venv\Scripts;%FFBIN%;%GITCMD%;%PATH%" & set "VIRTUAL_ENV=%ROOT%packages\core\.venv" & set "PYTHONUTF8=1" & set "PYTHONIOENCODING=utf-8" & echo 코어 서버 로딩중(30~60초)... & ".venv\Scripts\python.exe" app\_run_server.py"

REM --- 웹 서버(3000) 새 창으로 실행 (0.0.0.0 바인딩) ---
start "shopping-shorts WEB :3000" cmd /k "chcp 65001 >nul & cd /d "%ROOT%packages\web" & set "PATH=%NODEDIR%;%PATH%" & npx next dev --hostname 0.0.0.0 --port 3000"

echo.
echo ============================================================
echo  실행됨! (두 개의 검은 창이 떴는지 확인하세요)
echo.
echo   이 PC:                    http://127.0.0.1:3000
echo   폰/아이패드(같은 와이파이):  http://192.168.0.204:3000
echo.
echo  폰에서 접속 안 되면 → 폰_접속_허용.bat 한 번 더블클릭
echo  (첫 접속 후 30~60초는 코어 로딩중일 수 있어요)
echo ============================================================
echo.
start "" http://127.0.0.1:3000
pause
