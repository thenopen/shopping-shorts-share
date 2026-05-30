# 코어(8000) + 웹(3000) 동시 실행 — 각각 새 창. Tailscale로 외부접속 가능.
$root = Split-Path -Parent $PSScriptRoot
$scripts = $PSScriptRoot

Start-Process powershell -ArgumentList "-NoExit", "-File", (Join-Path $scripts "start-core.ps1")
Start-Process powershell -ArgumentList "-NoExit", "-File", (Join-Path $scripts "start-web.ps1")

$ts = (tailscale ip -4 2>$null | Select-Object -First 1)
Write-Host ""
Write-Host "서버 시작됨 (각 창 확인)" -ForegroundColor Green
Write-Host "  로컬:     http://localhost:3000  (웹) / http://localhost:8000  (코어 API)"
if ($ts) {
    Write-Host "  Tailscale: http://${ts}:3000  (웹) / http://${ts}:8000  (코어 API)" -ForegroundColor Cyan
    Write-Host "  작업실앱:  http://${ts}:8765/office"
}
Write-Host ""
