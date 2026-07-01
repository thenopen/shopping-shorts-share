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


# 일시오류(과부하·타임아웃·순간 quota) — 지수백오프 재시도 대상.
# TRANSIENT_WIDE: refine 계열 기본. TRANSIENT_NARROW: product_scrape가 원래 쓰던 좁은 집합.
TRANSIENT_WIDE = ("503", "UNAVAILABLE", "overloaded", "500", "INTERNAL",
                  "429", "RESOURCE_EXHAUSTED", "deadline", "timeout")
TRANSIENT_NARROW = ("503", "UNAVAILABLE", "overloaded", "429", "RESOURCE_EXHAUSTED")
_TRANSIENT = TRANSIENT_WIDE   # 하위호환 별칭


def _retry_seconds(e: Exception) -> float | None:
    """429 RESOURCE_EXHAUSTED면 retryDelay 초, 아니면 None."""
    s = str(e)
    if "RESOURCE_EXHAUSTED" not in s and "429" not in s:
        return None
    import re
    m = re.search(r"retry.?delay\D*(\d+)", s, re.I)
    return float(m.group(1)) if m else 30.0


def generate(contents, model: str, retries: int = 3, record: bool = True,
             backoff: float = 1.5, transient: tuple = TRANSIENT_WIDE,
             wrap_error: bool = False) -> str:
    """Gemini 호출(텍스트/비전 공용) + 일시오류 지수백오프 재시도.

    동작보존을 위해 호출부별 파라미터를 노출한다:
    - record: usage 토큰/429쿨다운 집계 여부.
    - backoff: 재시도 대기 base초(backoff*(i+1)).
    - transient: 재시도할 에러 문자열 집합.
    - wrap_error: 최종 실패를 'Gemini 호출 실패(재시도 N회): …'로 감쌀지.
    끝까지 실패하면 예외(호출측이 폴백).
    """
    import time

    from google import genai

    key = api_key()
    if not key:
        raise RuntimeError("no gemini key")
    client = genai.Client(api_key=key)
    last = None
    for i in range(max(1, retries)):
        try:
            res = client.models.generate_content(model=model, contents=contents)
            if record:
                try:
                    from app import usage          # 지연 import(순환 회피)
                    usage.record_gemini(model, getattr(res, "usage_metadata", None))
                except Exception:
                    pass
            return (res.text or "").strip()
        except Exception as e:
            last = e
            secs = _retry_seconds(e)
            if secs is not None and record:
                try:
                    from app import usage
                    usage.record_gemini_429(secs)
                except Exception:
                    pass
            if any(c in str(e) for c in transient) and i < retries - 1:
                time.sleep(backoff * (i + 1))
                continue
            if wrap_error:
                raise RuntimeError(f"Gemini 호출 실패(재시도 {retries}회): {str(last)[:160]}") from e
            raise
    if wrap_error:
        raise RuntimeError(f"Gemini 호출 실패(재시도 {retries}회): {str(last)[:160]}")
    raise last if last else RuntimeError("gemini call failed")
