"""부팅 토큰 인증 — 코어(0.0.0.0:8000)가 같은 와이파이에 노출되므로,
모든 API 요청에 공유 토큰을 요구해 LAN 내 임의 접근·API 키 탈취를 막는다.

토큰 생명주기:
  - 서버 첫 부팅 시 1회 생성(secrets.token_urlsafe(32) ≈ 43자).
  - workdir/auth_token.txt 에 영속화(0600). workdir 는 이미 .gitignore 됨.
  - 환경변수 FORCE_AUTH_TOKEN 있으면 그것이 우선(배포/재설정/CI용).
  - 토큰을 잊거나 바꾸려면: 파일 삭제(또는 FORCE_AUTH_TOKEN 변경) 후 재기동.

인증 우회(escape hatch):
  - ALLOW_NO_AUTH=1 이면 인증 완전 skip. 오직 본인 PC 단독 개발용. LAN/터널 노출 땐 금지.

미들웨어 동작(server_api.py 에서 사용):
  - 허용 경로(/, /health)는 토큰 없이 허용 — 상태 확인용.
  - 토큰 검출 순서: Authorization: Bearer <t> 헤더 → ?token=<t> 쿼리(폰 1회 입력).
  - 불일치 시 401 + WWW-Authenticate: Bearer.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path

from app.config import WORKDIR

TOKEN_PATH = WORKDIR / "auth_token.txt"


def _read_stored() -> str:
    try:
        return TOKEN_PATH.read_text(encoding="utf-8").strip()
    except Exception:
        return ""


def get_or_create_token() -> str:
    """현재 유효한 토큰. FORCE_AUTH_TOKEN 환경변수 > 저장된 파일 > 새 발급(저장)."""
    forced = os.environ.get("FORCE_AUTH_TOKEN", "").strip()
    if forced:
        return forced
    stored = _read_stored()
    if len(stored) >= 24:
        return stored
    new = secrets.token_urlsafe(32)
    try:
        TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_PATH.write_text(new, encoding="utf-8")
        try:                       # 0600 — 소유자만 읽기
            TOKEN_PATH.chmod(0o600)
        except Exception:
            pass
    except Exception:
        pass                       # 저장 실패해도 세션 토큰은 동작(재기동 시 새 발급)
    return new


def auth_disabled() -> bool:
    """ALLOW_NO_AUTH=1 이면 인증 skip(로컬 개발 전용)."""
    return os.environ.get("ALLOW_NO_AUTH") == "1"
