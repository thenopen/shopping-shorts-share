@echo off
chcp 65001 >nul
REM ============================================================
REM  쇼핑쇼츠 메이커 - 폰/아이패드 접속용 방화벽 3000 포트 열기
REM  (한 번만 실행하면 됨. 창이 뜨면 "예" 클릭 = 관리자 승인)
REM ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo 관리자 권한이 필요합니다. 창이 뜨면 "예"를 누르세요...
  powershell -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)
netsh advfirewall firewall delete rule name="shopping-shorts web 3000" >nul 2>&1
netsh advfirewall firewall add rule name="shopping-shorts web 3000" dir=in action=allow protocol=TCP localport=3000 profile=any
echo.
echo ============================================================
echo  완료! 이제 폰/아이패드(같은 와이파이)에서 접속하세요:
echo.
echo       http://192.168.0.204:3000
echo.
echo  (PC의 IP가 바뀌면 run_shopping_shorts.bat 실행 창에 뜨는 주소를 쓰세요)
echo ============================================================
echo.
pause
