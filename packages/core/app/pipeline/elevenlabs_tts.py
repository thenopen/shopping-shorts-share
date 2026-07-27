"""ElevenLabs TTS 엔진 — 다국어 고품질 음성. 사용자 BYOK.

- 인증: xi-api-key 헤더
- 합성: POST /v1/text-to-speech/{voice_id} → audio/mpeg(mp3) 바이트 그대로
- 보이스 목록: GET /v1/voices → [{voice_id, name, ...}]
- 단어 타임스탬프는 반환하지 않음(문자단위 with-timestamps는 있으나 미사용) →
  server_api가 stamps 비면 whisper로 재정렬하므로 자막 싱크는 정상 동작.
- 키/잔여: GET /v1/user (character_count/character_limit)

키 소스 우선순위: ELEVENLABS_API_KEY 환경변수 > auth/elevenlabs_key.txt.
"""
import os
from pathlib import Path

import requests

from app.config import BACKEND_ROOT

BASE = "https://api.elevenlabs.io/v1"
KEY_PATH = BACKEND_ROOT / "auth" / "elevenlabs_key.txt"
DEFAULT_MODEL = "eleven_multilingual_v2"
_TIMEOUT = 120


def api_key() -> str | None:
    env = os.environ.get("ELEVENLABS_API_KEY")
    if env:
        return env.strip()
    if KEY_PATH.exists():
        return KEY_PATH.read_text(encoding="utf-8").strip()
    return None


def available() -> bool:
    return bool(api_key())


def save_key(key: str) -> None:
    KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    KEY_PATH.write_text((key or "").strip(), encoding="utf-8")


def _headers(key: str | None = None) -> dict:
    return {"xi-api-key": key or api_key() or ""}


def check_key(key: str | None = None) -> dict:
    """BYOK 검증 + 잔여 글자수. {ok, plan, remaining, used, limit} | {ok:False, error}."""
    try:
        r = requests.get(f"{BASE}/user", headers=_headers(key), timeout=30)
        if r.status_code == 401:
            return {"ok": False, "error": "잘못된 API 키"}
        r.raise_for_status()
        j = r.json()
        sub = j.get("subscription") or {}
        used = int(sub.get("character_count", 0))
        limit = int(sub.get("character_limit", 0))
        return {"ok": True, "plan": sub.get("tier", ""),
                "used": used, "limit": limit, "remaining": max(0, limit - used)}
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else 0
        return {"ok": False, "error": f"HTTP {code}"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:140]}


def list_voices(key: str | None = None) -> list:
    """계정의 보이스 목록(기본 보이스 + 커스텀). [{voice_id, name, labels, preview_url}]."""
    r = requests.get(f"{BASE}/voices", headers=_headers(key), timeout=30)
    r.raise_for_status()
    return r.json().get("voices", []) or []


def synthesize(text: str, out_path, voice_id: str | None = None,
               stability: float = 0.5, similarity: float = 0.75,
               style: float = 0.0, speed: float = 1.0,
               model: str | None = None, key: str | None = None) -> tuple:
    """ElevenLabs 합성 → mp3. 반환 (Path, []) — 단어 타임스탬프 없음(whisper 폴백).

    stability/similarity/style는 voice_settings, speed는 0.7~1.2 권장.
    """
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    vid = (voice_id or "").strip()
    if not vid:
        raise RuntimeError("ElevenLabs voice_id가 필요합니다. 보이스를 선택하세요.")
    vs: dict = {"stability": max(0.0, min(1.0, float(stability))),
                "similarity_boost": max(0.0, min(1.0, float(similarity)))}
    if style:
        vs["style"] = max(0.0, min(1.0, float(style)))
    # speed는 0.7~1.2만 허용(그 밖은 400) — 말속도 슬라이더(0.5~2.0)를 이 범위로 클램프.
    vs["speed"] = max(0.7, min(1.2, float(speed)))
    body = {"text": (text or "").strip(),
            "model_id": model or DEFAULT_MODEL,
            "voice_settings": vs}
    r = requests.post(f"{BASE}/text-to-speech/{vid}",
                      headers={**_headers(key), "Content-Type": "application/json",
                               "Accept": "audio/mpeg"},
                      json=body, timeout=_TIMEOUT)
    r.raise_for_status()
    out_path.write_bytes(r.content)
    return out_path, []
