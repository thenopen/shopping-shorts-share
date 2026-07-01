"""API 사용량(quota) 로컬 집계 — Gemini 토큰/호출수, Google TTS 글자수.

무료티어는 런타임에 잔여 quota를 안 알려준다(응답 헤더에도 없음). 그래서 우리가
호출하는 쪽에서 세어 근사치를 만든다. workdir/usage.json에 영속화(서버 재시작에도
유지). 정확한 서버측 한도/차트는 AI Studio·Cloud Console 대시보드에서 확인.

- Gemini: 무료티어 RPD가 태평양시 자정에 리셋 → 근사로 PST(UTC-8) '날짜' 기준 집계.
- TTS: 무료 글자수는 월 단위 → PST '월' 기준 집계.
- 429(RESOURCE_EXHAUSTED) 감지 시 재시도까지 남은 초를 기록 → 웹이 '소진' 표시.
"""

from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timedelta, timezone

from app.config import WORKDIR

_LOCK = threading.Lock()
_PATH = WORKDIR / "usage.json"

# Gemini RPD 리셋 기준(태평양 표준시). DST 무시한 근사 — 개인 도구엔 충분.
_PACIFIC = timezone(timedelta(hours=-8))
_KST = timezone(timedelta(hours=9))

# 무료티어 한도는 settings.get_limits()가 관리(설정 패널/settings.json/env). '남은 값 =
# 한도 − 우리 사용량' — 이 키를 이 앱만 쓸 때 실제 잔여와 일치. 정확한 서버측 잔여는
# 각 콘솔(AI Studio / Cloud Console / Modal 대시보드)에서 확인.

# Modal GPU 시간당 대략 단가($/hr) — 실제는 콘솔 확인. gpu 이름 부분매칭.
_MODAL_PRICE_PER_HR = {"T4": 0.59, "L4": 0.80, "A10": 1.10, "A100": 2.50, "H100": 4.50}


def _next_daily_reset_kst() -> str:
    """다음 일일 리셋(태평양 자정)을 한국시간 'MM/DD HH:MM'으로."""
    now = datetime.now(_PACIFIC)
    nxt = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return nxt.astimezone(_KST).strftime("%m/%d %H:%M")


def _next_monthly_reset_kst() -> str:
    """다음 월 1일 리셋(태평양)을 한국시간 'MM/DD HH:MM'으로."""
    now = datetime.now(_PACIFIC)
    y, m = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
    nxt = now.replace(year=y, month=m, day=1, hour=0, minute=0, second=0, microsecond=0)
    return nxt.astimezone(_KST).strftime("%m/%d %H:%M")


def _today() -> str:
    return datetime.now(_PACIFIC).strftime("%Y-%m-%d")


def _month() -> str:
    return datetime.now(_PACIFIC).strftime("%Y-%m")


def _load() -> dict:
    try:
        return json.loads(_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save(d: dict) -> None:
    try:
        _PATH.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def record_gemini(model: str, usage_metadata=None) -> None:
    """Gemini 응답 1건 집계. usage_metadata는 google-genai 응답의 토큰수(있으면)."""
    prompt = int(getattr(usage_metadata, "prompt_token_count", 0) or 0)
    cand = int(getattr(usage_metadata, "candidates_token_count", 0) or 0)
    total = int(getattr(usage_metadata, "total_token_count", 0) or (prompt + cand))
    with _LOCK:
        d = _load()
        g = d.setdefault("gemini", {})
        if g.get("day") != _today():
            g.clear()
            g["day"] = _today()
        g["calls"] = g.get("calls", 0) + 1
        g["tokens"] = g.get("tokens", 0) + total
        g["model"] = model
        g["last"] = time.time()
        _save(d)


def record_gemini_429(retry_seconds: float | None) -> None:
    """quota 소진(429) — 재시도까지 남은 초를 기록."""
    with _LOCK:
        d = _load()
        g = d.setdefault("gemini", {})
        if g.get("day") != _today():
            g.clear()
            g["day"] = _today()
        g["exhausted_until"] = time.time() + float(retry_seconds or 30)
        _save(d)


def record_tts(chars: int) -> None:
    """Google TTS 합성 1건 집계(입력 글자수 = 과금 단위)."""
    with _LOCK:
        d = _load()
        t = d.setdefault("tts", {})
        if t.get("month") != _month():
            t.clear()
            t["month"] = _month()
        t["chars"] = t.get("chars", 0) + int(chars)
        t["calls"] = t.get("calls", 0) + 1
        _save(d)


def _modal_cost(seconds: float, gpu: str) -> float:
    """GPU초 → 추정 비용($). gpu 이름 부분매칭으로 단가 선택(없으면 A10G 기준)."""
    price = 1.10
    for key, p in _MODAL_PRICE_PER_HR.items():
        if key in (gpu or ""):
            price = p
            break
    price = float(os.environ.get("MODAL_GPU_PRICE", price))
    return float(seconds or 0) / 3600.0 * price


def record_modal(seconds: float, gpu: str = "") -> None:
    """Modal ProPainter 1건 집계(GPU초 + 추정 비용, 월 단위 = 크레딧 리셋 주기)."""
    cost = _modal_cost(seconds, gpu)
    with _LOCK:
        d = _load()
        mo = d.setdefault("modal", {})
        if mo.get("month") != _month():
            mo.clear()
            mo["month"] = _month()
        mo["jobs"] = mo.get("jobs", 0) + 1
        mo["seconds"] = round(mo.get("seconds", 0.0) + float(seconds or 0), 1)
        mo["cost"] = round(mo.get("cost", 0.0) + cost, 4)
        if gpu:
            mo["gpu"] = gpu
        _save(d)


def snapshot() -> dict:
    """웹 배지용 스냅샷 — 각 API의 '남은 한도'(= 한도 − 우리 사용량) + 리셋시각."""
    with _LOCK:
        d = _load()
    from app import settings
    lim = settings.get_limits()
    g = d.get("gemini", {}) or {}
    t = d.get("tts", {}) or {}
    mo = d.get("modal", {}) or {}
    exhausted = g.get("exhausted_until", 0) or 0
    cooldown = max(0, int(exhausted - time.time())) if exhausted else 0
    g_calls = g.get("calls", 0)
    t_chars = t.get("chars", 0)
    m_cost = mo.get("cost", 0.0)
    rpd, tpm = lim["gemini_rpd"], lim["gemini_tpm"]
    tts_lim, modal_lim = lim["tts_chars"], lim["modal_credit"]
    return {
        "gemini": {
            "calls": g_calls,
            "tokens": g.get("tokens", 0),
            "model": g.get("model"),
            "cooldown": cooldown,                 # 429 재시도까지 남은 초(0이면 정상)
            "limit": rpd,
            "remaining": max(0, rpd - g_calls),
            "tpm_limit": tpm,
            "reset": _next_daily_reset_kst(),      # 매일 태평양 자정(한국시간 표기)
        },
        "tts": {
            "chars": t_chars,
            "calls": t.get("calls", 0),
            "limit": tts_lim,
            "remaining": max(0, tts_lim - t_chars),
            "reset": _next_monthly_reset_kst(),    # 매월 1일
        },
        "modal": {
            "jobs": mo.get("jobs", 0),
            "seconds": mo.get("seconds", 0.0),
            "cost": round(m_cost, 2),
            "gpu": mo.get("gpu"),
            "limit": modal_lim,
            "remaining": round(max(0.0, modal_lim - m_cost), 2),
            "reset": _next_monthly_reset_kst(),    # 매월 1일(크레딧 리셋)
        },
    }
