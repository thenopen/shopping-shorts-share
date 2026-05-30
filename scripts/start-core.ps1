# 코어 API 서버 — 0.0.0.0 바인딩 (localhost + Tailscale 접속)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $root "packages\core")
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"
& ".venv\Scripts\python.exe" -m uvicorn app.server_api:app --host 0.0.0.0 --port 8000
