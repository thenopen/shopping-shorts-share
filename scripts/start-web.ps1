# 웹(Next.js) 개발 서버 — 0.0.0.0 바인딩 (localhost + Tailscale 접속)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $root "packages\web")
npx next dev --hostname 0.0.0.0 --port 3000
