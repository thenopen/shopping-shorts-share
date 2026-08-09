#!/usr/bin/env bash
# 코어(8000) + 웹(3000) 동시 기동 — macOS/Linux 용. Windows 는 start-all.ps1 사용.
# 코어는 백그라운드로, 웹은 포그라운드로. Ctrl+C 또는 종료 시 코어도 함께 정리(trap).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

CORE_LOG="$ROOT/packages/core/_server_run.log"
CORE_PID=""

cleanup() {
  if [ -n "$CORE_PID" ] && kill -0 "$CORE_PID" 2>/dev/null; then
    echo ""
    echo "[start-all] 코어(PID $CORE_PID) 종료 중…"
    kill "$CORE_PID" 2>/dev/null || true
    wait "$CORE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "[start-all] 코어 백그라운드 기동(로그: $CORE_LOG)"
bash "$SCRIPT_DIR/start-core.sh" >"$CORE_LOG" 2>&1 &
CORE_PID=$!

# 코어가 뜰 때 잠깐 대기(토큰/uvicorn 기동 시간).
sleep 2

# 접속 안내 — 코어 토큰이 콘솔에 찍혔으므로 로그에서 토큰 URL 추출해 안내.
TS_IP=""
if command -v tailscale >/dev/null 2>&1; then
  TS_IP="$(tailscale ip -4 2>/dev/null || true)"
fi
LAN_IP=""
if command -v ipconfig >/dev/null 2>&1; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"   # macOS
fi

echo "[start-all] 코어 토큰/접속 안내는 $CORE_LOG 상단 배너 참조."
echo "[start-all] - 같은 PC:    http://localhost:3000"
[ -n "$LAN_IP" ] && echo "[start-all] - 폰(LAN):    http://$LAN_IP:3000"
[ -n "$TS_IP" ] && echo "[start-all] - Tailscale: http://$TS_IP:3000"
echo ""

echo "[start-all] 웹 포그라운드 기동(Ctrl+C 로 둘 다 종료)"
bash "$SCRIPT_DIR/start-web.sh"
