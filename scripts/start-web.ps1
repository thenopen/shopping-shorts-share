# 웹(Next.js) 개발 서버 — 0.0.0.0 바인딩 (localhost + Tailscale 접속)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $root "packages\web")
# Start-Process로 새로 뜬 창은 옛 PATH 스냅샷이라 node/npx를 못 찾을 수 있음 → 직접 prepend
$nodeDir = "C:\Program Files\nodejs"
if ((Test-Path $nodeDir) -and ($env:PATH -notlike "*$nodeDir*")) {
    $env:PATH = "$nodeDir;$env:PATH"
}
npx next dev --hostname 0.0.0.0 --port 3000
