# 웹(Next.js) 프로덕션 서버 — build 후 start. 0.0.0.0 바인딩(localhost + Tailscale).
# dev와 달리 청크 해시가 빌드 시점에 고정 → 폰 브라우저 캐시와 안 꼬임(까만화면/폰트깨짐 방지).
# 죽으면 자동 재시작(터미널 닫지 않는 한 유지).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $root "packages\web")

Write-Host "프로덕션 빌드 중... (코드 바뀌었으면 필수)" -ForegroundColor Yellow
npx next build
if ($LASTEXITCODE -ne 0) { Write-Host "빌드 실패 — 위 에러 확인" -ForegroundColor Red; exit 1 }

Write-Host "웹 시작 — http://localhost:3000 (죽으면 자동 재시작)" -ForegroundColor Green
while ($true) {
    npx next start --hostname 0.0.0.0 --port 3000
    Write-Host "웹 서버가 종료됨. 3초 후 재시작..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
}
