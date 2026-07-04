"""Typecast TTS 엔진 — 한국어 고품질 + 감정 + 네이티브 단어 타임스탬프.

talescale=Typecast(typecast.ai). 사용자 BYOK: auth/typecast_key.txt 또는 TYPECAST_API_KEY.
- 인증: X-API-KEY 헤더
- 합성+싱크: POST /v1/text-to-speech/with-timestamps?granularity=word
  → {audio(base64 wav), audio_duration, words:[{text,start,end}]} — whisper 재정렬 불필요
- 감정: prompt.emotion_type = "smart"(문맥 자동) | "preset"(happy/sad/angry/whisper/toneup/tonedown)
- 1크레딧=1자, 무료 월 30,000자. 잔여: GET /v1/users/me/subscription
"""
import base64
import os
import time
from pathlib import Path

import requests

from app.config import BACKEND_ROOT

BASE = "https://api.typecast.ai"
KEY_PATH = BACKEND_ROOT / "auth" / "typecast_key.txt"
DEFAULT_MODEL = "ssfm-v30"
# 기본 보이스(한국어 배우, TikTok/Reels/Shorts 태그) — 프론트 보이스 선택이 override.
DEFAULT_VOICE_ID = "tc_69fc0cff784968297fb45daa"   # Sanghyun (male)
_TIMEOUT = 90
# ssfm-v30 감정 프리셋(보이스별 지원 목록은 voice.models[].emotions 확인).
EMOTION_PRESETS = ("normal", "happy", "sad", "angry", "whisper", "toneup", "tonedown")


import re as _re

# Typecast 보이스에 언어 필드가 없어(다국어 모델) 이름 로마자로 한국어 배우 추정.
# 명백한 일/중 배우는 제외, 한국 성씨/한국어 특유 음절이면 한국어로 본다(정밀 우선, 놓친 건 '전체'로).
_KO_SURNAME = {"kim", "lee", "park", "choi", "jung", "jeong", "kang", "cho", "yoon", "yun",
    "jang", "lim", "im", "han", "oh", "seo", "shin", "kwon", "hwang", "ahn", "an", "song",
    "ryu", "hong", "jeon", "ko", "go", "moon", "yang", "bae", "baek", "heo", "nam", "sim",
    "ji", "noh", "no", "ha", "jin", "chae", "woo", "sohn", "son", "yu", "yoo", "koo", "joo",
    "ju", "gil", "min"}
_KO_SYL = _re.compile(
    r"(hyun|hyeon|seo|seok|seong|sung|jeong|jung|kyung|gyeong|wook|woon|joon|jun|jin|hwan|"
    r"hee|eun|young|yeong|sook|suk|byung|byeong|sang|gwang|kwang|kang|deok|geun|cheol|chul|"
    r"hyo|gyu|kyu|hyung|hyeong|kwon|yoon|yeol|myung|myeong|jae|tae|dae|bok|chan|chun|cheon|"
    r"hoon|hun|kyoung|yeon|ryeol|seul|hye|gyeom|wan|won|mok|sol|sun|seon|jong|sik|nam|"
    r"ryeong|pil|eogwool|mongsil|booqoo|bboddo|okji|soye|jain|gowoon|daeun|minuk|wonwoo)",
    _re.I)
_JP = {"sato", "suzuki", "tanaka", "watanabe", "ito", "yamamoto", "nakamura", "kobayashi",
    "kato", "yoshida", "yamada", "sasaki", "yamaguchi", "matsumoto", "inoue", "kimura",
    "hayashi", "shimizu", "yamazaki", "mori", "abe", "ikeda", "hashimoto", "ishida",
    "ishikawa", "ichikawa", "nomura", "murata", "ono", "goto", "okada", "murakami",
    "takahashi", "tomoko", "yui", "nanami", "daichi", "miki", "rin", "mirei", "touma",
    "miu", "daidai", "tonakai", "kaito", "souta", "yuto", "sakura", "hina", "riko", "yuki",
    "yuna", "haru", "takuya", "ryouta"}
_CN = {"wang", "zhang", "liu", "chen", "huang", "zhao", "zhou", "zhu", "guo", "lin", "luo",
    "zheng", "liang", "xie", "tang", "feng", "dong", "cheng", "cao", "yuan", "deng", "shen",
    "peng", "hao", "ran", "lili", "hua"}


def is_korean_voice(name: str) -> bool:
    toks = _re.sub(r"[.\-’']", " ", name or "").lower().split()
    if any(t in _JP or t in _CN for t in toks):
        return False
    if any(t in _KO_SURNAME for t in toks):
        return True
    return bool(_KO_SYL.search("".join(toks)))


def api_key() -> str | None:
    env = os.environ.get("TYPECAST_API_KEY")
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
    return {"X-API-KEY": key or api_key() or "", "Content-Type": "application/json"}


def subscription(key: str | None = None) -> dict:
    r = requests.get(f"{BASE}/v1/users/me/subscription", headers=_headers(key), timeout=30)
    r.raise_for_status()
    return r.json()


def check_key(key: str | None = None) -> dict:
    """BYOK 검증 + 잔여 크레딧. {ok, plan, remaining, plan_credits, used_credits} | {ok:False, error}."""
    try:
        s = subscription(key)
        c = s.get("credits") or {}
        plan_c = int(c.get("plan_credits", 0))
        used_c = int(c.get("used_credits", 0))
        return {"ok": True, "plan": s.get("plan"), "remaining": max(0, plan_c - used_c),
                "plan_credits": plan_c, "used_credits": used_c,
                "limits": s.get("limits")}
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else 0
        return {"ok": False, "error": "잘못된 API 키" if code == 401 else f"HTTP {code}"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:140]}


_voices_cache: dict = {"t": 0.0, "data": None}


def list_voices(key: str | None = None, force: bool = False) -> list:
    """전체 보이스(598+). 자주 안 바뀌어 1시간 캐시."""
    now = time.time()
    if not force and _voices_cache["data"] and now - _voices_cache["t"] < 3600:
        return _voices_cache["data"]
    r = requests.get(f"{BASE}/v2/voices", headers=_headers(key), timeout=30)
    r.raise_for_status()
    data = r.json()
    _voices_cache.update(t=now, data=data)
    return data


def voice_emotions(voice_id: str, voices: list | None = None) -> list:
    """보이스가 ssfm-v30에서 지원하는 감정 프리셋 목록."""
    for v in (voices or list_voices()):
        if v.get("voice_id") == voice_id:
            for m in v.get("models", []):
                if m.get("version") == DEFAULT_MODEL:
                    return list(m.get("emotions") or [])
    return list(EMOTION_PRESETS)


def synthesize(text: str, out_path, voice_id: str | None = None, emotion: str = "smart",
               intensity: float = 1.3, tempo: float = 1.0, audio_format: str = "wav",
               key: str | None = None, prev_text: str = "", next_text: str = "") -> tuple:
    """Typecast 합성 + 네이티브 단어 타임스탬프.

    반환: (Path, stamps) — stamps=[{text,offset,duration}](초), build_lines_from_tts 소비 포맷.
    emotion='smart' → 문맥 자동 감정. 프리셋명(happy 등)이면 preset+intensity.
    """
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    vid = voice_id if str(voice_id or "").startswith(("tc_", "uc_")) else DEFAULT_VOICE_ID
    body: dict = {
        "voice_id": vid,
        "text": (text or "").strip()[:2000],
        "model": DEFAULT_MODEL,
        "language": "kor",
        "output": {"audio_format": audio_format},
    }
    if tempo and abs(float(tempo) - 1.0) > 1e-3:
        body["output"]["audio_tempo"] = max(0.5, min(2.0, float(tempo)))
    if emotion == "smart":
        body["prompt"] = {"emotion_type": "smart", "previous_text": prev_text, "next_text": next_text}
    elif emotion and emotion != "normal":
        body["prompt"] = {"emotion_type": "preset", "emotion_preset": emotion,
                          "emotion_intensity": max(0.0, min(2.0, float(intensity)))}
    r = requests.post(f"{BASE}/v1/text-to-speech/with-timestamps?granularity=word",
                      headers=_headers(key), json=body, timeout=_TIMEOUT)
    r.raise_for_status()
    d = r.json()
    out_path.write_bytes(base64.b64decode(d["audio"]))
    stamps = [{"text": w.get("text", ""),
               "offset": float(w.get("start", 0.0)),
               "duration": max(0.0, float(w.get("end", 0.0)) - float(w.get("start", 0.0)))}
              for w in (d.get("words") or []) if (w.get("text") or "").strip()]
    return out_path, stamps
