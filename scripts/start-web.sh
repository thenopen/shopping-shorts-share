#!/usr/bin/env bash
# 웹(Next.js dev, 3000) 기동 — macOS/Linux 용. Windows 는 start-web.ps1 사용.
# 0.0.0.0 바인딩으로 같은 와이파이 폰/아이패드 접속 허용.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
cd "$ROOT/packages/web"

if [ ! -d "node_modules" ]; then
  echo "[start-web] node_modules 없음 — npm install 실행" >&2
  npm install
fi

echo "[start-web] npx next dev → http://localhost:3000"
exec npx next dev --hostname 0.0.0.0 --port 3000
