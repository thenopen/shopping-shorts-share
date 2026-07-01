"""Gemini API 키 조회 — 여러 모듈(refine·product_scrape·settings)이 공유.

키 소스 우선순위: GEMINI_API_KEY 환경변수 > auth/gemini_key.txt.
설정 패널에서 저장하면 auth/gemini_key.txt에 쓰이고, 이 함수가 매 호출 읽으므로 즉시 반영.
"""

from __future__ import annotations

import os

from app.config import BACKEND_ROOT

KEY_PATH = BACKEND_ROOT / "auth" / "gemini_key.txt"


def api_key() -> str | None:
    env = os.environ.get("GEMINI_API_KEY")
    if env:
        return env.strip()
    if KEY_PATH.exists():
        return KEY_PATH.read_text(encoding="utf-8").strip()
    return None


def available() -> bool:
    return bool(api_key())
