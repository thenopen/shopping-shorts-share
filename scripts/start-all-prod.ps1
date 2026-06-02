# 코어(8000) + 웹(3000 프로덕션) 동시 실행 — 각각 새 창, 죽으면 자동 재시작.
# 안정 운영용. dev의 청크 깨짐/까만화면/폰트깨짐 없음. 작업실(8765)은 안 건드림.
$scripts = $PSScriptRoot

Start-Process powershell -ArgumentList "-NoExit", "-File", (Join-Path $scripts "start-core-prod.ps1")
Start-Process powershell -ArgumentList "-NoExit", "-File", (Join-Path $scripts "start-web-prod.ps1")

$ts = (tailscale ip -4 2>$null | Select-Object -First 1)
Write-Host ""
Write-Host "프로덕션 서버 시작됨 (각 창 확인. 웹은 빌드 후 기동되니 1~2분 대기)" -ForegroundColor Green
Write-Host "  로컬:     http://localhost:3000  (웹) / http://localhost:8000  (코어 API)"
if ($ts) {
    Write-Host "  Tailscale: http://${ts}:3000  (웹) / http://${ts}:8000  (코어 API)" -ForegroundColor Cyan
    Write-Host "  폰 팁: 처음 접속 시 비공개탭 또는 캐시삭제 1회 (이전 dev 캐시 제거)" -ForegroundColor Yellow
}
Write-Host ""
