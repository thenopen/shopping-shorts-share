"""Google Cloud TTS 엔진 — API 키 방식(BYOK). 서비스계정 JSON 불필요.

기존 google_tts.py는 서비스계정(GOOGLE_APPLICATION_CREDENTIALS) 방식이라 그대로 두고,
이 모듈은 버터떡 스튜디오와 동일하게 **API 키 하나(?key=)** 로 목록조회+합성한다.
→ 사용자가 키만 넣으면 음성 목록이 바로 뜨는 통일 UX.

- 합성: POST /v1/text:synthesize?key= → {audioContent(base64 mp3)}
- 목록: GET /v1/voices?key=&languageCode= → {voices:[{name, languageCodes, ssmlGender}]}
- 단어 타임스탬프 없음 → server_api가 whisper로 재정렬.

키 소스 우선순위: GOOGLE_TTS_API_KEY 환경변수 > auth/google_api_key.txt.
"""
import base64
import os
from pathlib import Path

import requests

from app.config import BACKEND_ROOT

BASE = "https://texttospeech.googleapis.com/v1"
KEY_PATH = BACKEND_ROOT / "auth" / "google_api_key.txt"
DEFAULT_LANG = "ko-KR"
_TIMEOUT = 120


def api_key() -> str | None:
    env = os.environ.get("GOOGLE_TTS_API_KEY")
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


def _lang_of(voice: str) -> str:
    parts = (voice or "").split("-")
    return f"{parts[0]}-{parts[1]}" if len(parts) >= 2 else DEFAULT_LANG


def check_key(key: str | None = None) -> dict:
    """BYOK 검증 — 보이스 목록 1회 조회로 키 유효성만 확인(합성 안 함, 무과금)."""
    key = key or api_key()
    if not key:
        return {"ok": False, "error": "키 없음"}
    try:
        r = requests.get(f"{BASE}/voices", params={"key": key, "languageCode": DEFAULT_LANG},
                         timeout=30)
        if r.status_code in (400, 401, 403):
            return {"ok": False, "error": "잘못된 API 키 또는 TTS API 미활성화"}
        r.raise_for_status()
        n = len(r.json().get("voices", []) or [])
        return {"ok": True, "count": n}
    except Exception as e:
        return {"ok": False, "error": str(e)[:140]}


def list_voices(key: str | None = None, lang: str | None = None) -> list:
    """보이스 목록. lang 기본 ko-KR. [{name, languageCodes, ssmlGender, naturalSampleRateHertz}]."""
    key = key or api_key()
    if not key:
        raise RuntimeError("Google API 키가 필요합니다.")
    params = {"key": key}
    if lang != "all":
        params["languageCode"] = lang or DEFAULT_LANG
    r = requests.get(f"{BASE}/voices", params=params, timeout=30)
    r.raise_for_status()
    return r.json().get("voices", []) or []


def synthesize(text: str, out_path, voice: str | None = None,
               rate: float = 1.0, pitch: float = 0.0,
               lang: str | None = None, key: str | None = None) -> tuple:
    """Google 합성 → mp3. 반환 (Path, []) — 단어 타임스탬프 없음(whisper 폴백)."""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    key = key or api_key()
    if not key:
        raise RuntimeError("Google API 키가 필요합니다.")
    voice = (voice or "").strip()
    voice_cfg: dict = {"languageCode": lang or _lang_of(voice)}
    if voice:
        voice_cfg["name"] = voice
    body = {"input": {"text": (text or "").strip()},
            "voice": voice_cfg,
            "audioConfig": {"audioEncoding": "MP3",
                            "speakingRate": max(0.25, min(4.0, float(rate))),
                            "pitch": max(-20.0, min(20.0, float(pitch)))}}
    r = requests.post(f"{BASE}/text:synthesize", params={"key": key},
                      json=body, timeout=_TIMEOUT)
    r.raise_for_status()
    out_path.write_bytes(base64.b64decode(r.json()["audioContent"]))
    return out_path, []
