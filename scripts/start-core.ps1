# 코어 API 서버 — 0.0.0.0 바인딩 (localhost + Tailscale 접속)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $root "packages\core")
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"
# venv를 PATH 최상단에 둬서 자식 워커도 venv python으로 스폰되게 강제(글로벌 python 폴백 방지)
$venv = Join-Path (Get-Location) ".venv\Scripts"
$env:PATH = "$venv;$env:PATH"
$env:VIRTUAL_ENV = (Join-Path (Get-Location) ".venv")
# _run_server.py = uvicorn.Server.run() 직접 호출(단일 프로세스). uvicorn CLI/uvicorn.run은
# 워커를 글로벌 python(venv의 _base_executable)으로 재스폰해 lama/easyocr 없는 환경에서 실패함
Write-Host "코어 서버 시작 — http://localhost:8000 (로그 이 창에 표시)" -ForegroundColor Green
& "$venv\python.exe" "app\_run_server.py"
