# 코어 API 서버 — venv 단일프로세스. 죽으면 자동 재시작.
# venv를 PATH 최상단에 둬 자식 워커도 venv python으로(글로벌 폴백 방지).
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $root "packages\core")
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"
$venv = Join-Path (Get-Location) ".venv\Scripts"
$env:PATH = "$venv;$env:PATH"
$env:VIRTUAL_ENV = (Join-Path (Get-Location) ".venv")

Write-Host "코어 서버 시작 — http://localhost:8000 (죽으면 자동 재시작)" -ForegroundColor Green
while ($true) {
    & "$venv\python.exe" "app\_run_server.py"
    Write-Host "코어 서버가 종료됨. 3초 후 재시작..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
}
