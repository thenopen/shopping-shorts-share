#!/usr/bin/env bash
# 코어 API 서버(8000) 기동 — macOS/Linux 용. Windows 는 start-core.ps1 사용.
# venv 가 있으면 그 python, 없으면 시스템 python 사용. _run_server.py 는 크로스플랫폼(host=0.0.0.0).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
cd "$ROOT/packages/core"

export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

# venv 경로 크로스플랫폼 — Unix: .venv/bin, Windows(Git Bash 등): .venv/Scripts
if [ -x ".venv/bin/python" ]; then
  PY=".venv/bin/python"
elif [ -x ".venv/Scripts/python.exe" ]; then
  PY=".venv/Scripts/python.exe"
else
  PY="python"
  echo "[start-core] venv 없음 — 시스템 python 사용. 권장: python3 -m venv .venv" >&2
fi

echo "[start-core] $PY app/_run_server.py  → http://localhost:8000"
exec "$PY" "app/_run_server.py"
