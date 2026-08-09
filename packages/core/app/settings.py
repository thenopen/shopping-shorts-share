"""설정 저장/조회 — API 키(auth/), 한도(settings.json), Modal 토큰(~/.modal.toml).

보안 원칙: 키는 서버 파일로만 저장하고, 조회 시 전체 키를 절대 반환하지 않는다(끝 4자리만
마스킹). 코어가 0.0.0.0로 노출되므로 개인망(Tailscale, WireGuard 암호화) 신뢰를 전제로 한다.

- Gemini 키: auth/gemini_key.txt (refine._api_key가 매 호출 읽음 → 저장 즉시 반영)
- Google TTS: auth/google_tts_key.json (google_tts._client가 매 호출 읽음)
- Modal 토큰: ~/.modal.toml 프로필(token_id/token_secret). 기존 프로필 보존, 우리 것만 active.
- 한도값: workdir/settings.json (usage.snapshot이 매 호출 읽음 → 배지에 즉시 반영)
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from app.config import BACKEND_ROOT, WORKDIR
from app.gemini import KEY_PATH as GEMINI_KEY_PATH, api_key as _gemini_api_key   # Gemini 키 단일 소스

AUTH_DIR = BACKEND_ROOT / "auth"
GTTS_KEY_PATH = AUTH_DIR / "google_tts_key.json"
LIMITS_PATH = WORKDIR / "settings.json"
MODAL_TOML = Path.home() / ".modal.toml"
DEFAULT_DOWNLOAD_DIR = BACKEND_ROOT / "downloads"   # 다운로드 영상 라이브러리 기본 위치

# 한도 기본값(env로도 조정 가능). settings.json이 있으면 그 값이 우선 — 단 아래 FREE_QUOTA로 캡.
DEFAULT_LIMITS = {
    "gemini_rpd": int(os.environ.get("GEMINI_RPD_LIMIT", "1000")),
    "gemini_rpm": int(os.environ.get("GEMINI_RPM_LIMIT", "15")),   # 분당 요청(무료 등급 실제 병목)
    "gemini_tpm": int(os.environ.get("GEMINI_TPM_LIMIT", "250000")),
    "tts_chars": int(os.environ.get("TTS_CHARS_LIMIT", "1000000")),
    "modal_credit": float(os.environ.get("MODAL_CREDIT_LIMIT", "30")),
}

# 각 서비스 무료 등급의 '실제' 한도(공식 문서 기준 · 수시 변동, 2026-07 확인 요망).
# get_limits가 min(설정값, 이 값)으로 캡 → 사용자가 크게 넣어도 배지가 실제보다 크게 표시 안 함.
# Gemini(AI Studio 무료): gemini-2.5-flash-lite RPD 1000·RPM 15·TPM 250k
#   (gemini-2.5-flash는 RPD 250·RPM 10로 더 낮음 — 앱이 둘 다 써서 보수 표기).
# Google TTS Chirp3-HD: 월 100만 자. Modal: 무료 크레딧 월 $30.
FREE_QUOTA = {
    "gemini_rpd": 1000, "gemini_rpm": 15, "gemini_tpm": 250000,
    "tts_chars": 1000000, "modal_credit": 30.0,
}


def _load_settings() -> dict:
    """settings.json 로드(없거나 깨지면 {})."""
    try:
        return json.loads(LIMITS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_settings(cur: dict) -> None:
    LIMITS_PATH.parent.mkdir(parents=True, exist_ok=True)
    LIMITS_PATH.write_text(json.dumps(cur, ensure_ascii=False, indent=1), encoding="utf-8")


def get_limits() -> dict:
    """기본값 위에 settings.json 저장값을 덮되, 실제 무료 한도(FREE_QUOTA)로 캡(min).

    사용자가 설정에서 더 큰 값을 넣어도 배지가 실제 무료 quota보다 크게 표시하지 않음.
    """
    d = dict(DEFAULT_LIMITS)
    try:
        saved = _load_settings()
        for k in DEFAULT_LIMITS:
            if saved.get(k) is not None:
                d[k] = type(DEFAULT_LIMITS[k])(saved[k])
    except Exception:
        pass
    for k, cap in FREE_QUOTA.items():        # 실제 quota로 상한 캡
        if d.get(k):
            d[k] = min(d[k], cap)
    return d


def set_limits(vals: dict) -> None:
    cur = _load_settings()
    for k in DEFAULT_LIMITS:
        v = (vals or {}).get(k)
        if v not in (None, ""):
            try:
                cur[k] = type(DEFAULT_LIMITS[k])(v)
            except Exception:
                pass
    _save_settings(cur)


def get_download_dir() -> str:
    """다운로드 영상 보관 폴더(서버측 경로). settings.json 값 > 기본값."""
    try:
        v = _load_settings().get("download_dir")
        if v and str(v).strip():
            return str(v).strip()
    except Exception:
        pass
    return str(DEFAULT_DOWNLOAD_DIR)


def set_download_dir(path: str) -> None:
    path = (path or "").strip()
    cur = _load_settings()
    cur["download_dir"] = path
    _save_settings(cur)


def _mask(s: str) -> str:
    s = (s or "").strip()
    if not s:
        return ""
    return "•" * len(s) if len(s) <= 6 else "••••" + s[-4:]


def save_gemini_key(key: str) -> None:
    key = (key or "").strip()
    if not key:
        return
    AUTH_DIR.mkdir(parents=True, exist_ok=True)
    GEMINI_KEY_PATH.write_text(key, encoding="utf-8")


def save_tts_json(raw: str) -> None:
    raw = (raw or "").strip()
    if not raw:
        return
    obj = json.loads(raw)  # 유효 JSON 검증
    if "private_key" not in obj or "client_email" not in obj:
        raise ValueError("서비스계정 JSON이 아님(private_key/client_email 필요)")
    AUTH_DIR.mkdir(parents=True, exist_ok=True)
    GTTS_KEY_PATH.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")


def _read_modal() -> tuple[str, dict]:
    """(활성 프로필명, 전체 프로필 dict). 파일 없으면 ('default', {})."""
    if not MODAL_TOML.exists():
        return "default", {}
    try:
        import tomllib
        data = tomllib.loads(MODAL_TOML.read_text(encoding="utf-8"))
    except Exception:
        return "default", {}
    active = next((n for n, p in data.items() if isinstance(p, dict) and p.get("active")), None)
    if not active and data:
        active = next(iter(data))
    return active or "default", data


def save_modal_token(token_id: str, token_secret: str) -> None:
    """기존 프로필 보존, 활성 프로필의 토큰만 교체(우리 프로필만 active=true)."""
    token_id, token_secret = (token_id or "").strip(), (token_secret or "").strip()
    if not (token_id and token_secret):
        return
    name, data = _read_modal()
    profiles: dict = {n: dict(p) for n, p in data.items() if isinstance(p, dict)}
    prof = dict(profiles.get(name, {}))
    prof.update(token_id=token_id, token_secret=token_secret, active=True)
    for n in profiles:                       # 다른 프로필은 비활성화(활성 하나 보장)
        profiles[n]["active"] = False
    profiles[name] = prof
    lines: list[str] = []
    for n, p in profiles.items():
        lines.append(f"[{n}]")
        for k, v in p.items():
            lines.append(f"{k} = {'true' if v else 'false'}" if isinstance(v, bool) else f'{k} = "{v}"')
        lines.append("")
    MODAL_TOML.write_text("\n".join(lines), encoding="utf-8")


def _modal_status() -> dict:
    name, data = _read_modal()
    prof = data.get(name, {}) if data else {}
    tid = prof.get("token_id", "")
    return {"set": bool(tid), "masked": _mask(tid), "profile": name if tid else None}


def get_modal_accounts() -> list[dict]:
    """멀티계정 로테이션 풀(token_id/token_secret/label). settings.json에 보관."""
    try:
        v = _load_settings().get("modal_accounts")
        if isinstance(v, list):
            return [a for a in v if a.get("token_id") and a.get("token_secret")]
    except Exception:
        pass
    return []


def set_modal_accounts(accts: list) -> None:
    clean = []
    for a in (accts or []):
        tid = (a.get("token_id") or "").strip()
        tsec = (a.get("token_secret") or "").strip()
        if tid and tsec:
            entry = {"token_id": tid, "token_secret": tsec,
                     "label": (a.get("label") or "").strip()}
            if a.get("deployed"):          # 배포 성공 플래그 보존(재시작에도 유지)
                entry["deployed"] = True
            clean.append(entry)
    cur = _load_settings()
    cur["modal_accounts"] = clean
    _save_settings(cur)


def set_account_deployed(token_id: str, deployed: bool = True) -> None:
    """계정의 배포 성공 플래그를 영속화(재시작 후에도 '배포됨' 표시)."""
    accts = get_modal_accounts()
    hit = False
    for a in accts:
        if a.get("token_id") == token_id:
            a["deployed"] = bool(deployed)
            hit = True
    if hit:
        set_modal_accounts(accts)


def multi_account_enabled() -> bool:
    """Modal 멀티계정 로테이션 활성 여부.

    기본은 단일 계정(~/.modal.toml 대표 프로필). 멀티 풀은 명시적 옵트인일 때만:
      - 환경변수 MODAL_MULTI_ACCOUNT=1, 또는
      - settings.json 의 allow_multi_account == True
    이유: 다수 무료 계정을 돌리는 건 Modal ToS 멀티어카운팅에 걸려 계정 정지 위험이 있어
    기본 동작으로 두지 않는다(2026-08-09, 보안 개선). 사용자가 위험을 알고 명시할 때만.
    """
    if os.environ.get("MODAL_MULTI_ACCOUNT") == "1":
        return True
    try:
        if _load_settings().get("allow_multi_account") is True:
            return True
    except Exception:
        pass
    return False


def set_allow_multi_account(enabled: bool) -> None:
    """settings.json 의 allow_multi_account 플래그 쓰기.

    /modal/accounts/add 가 풀에 첫 계정을 넣을 때 자동으로 True 로 세팅(추가 행위 = 옵트인).
    env(MODAL_MULTI_ACCOUNT)는 여전히 우선이므로, settings 가 False 여도 env=1 이면 활성.
    """
    cur = _load_settings()
    cur["allow_multi_account"] = bool(enabled)
    _save_settings(cur)


def effective_accounts() -> list[dict]:
    """실제 로테이션·크레딧 합산 대상 계정 목록.

    기본(단일): ~/.modal.toml 의 활성(대표) 프로필 1개만.
    멀티 옵트인(multi_account_enabled) 시: 풀 계정(settings.json modal_accounts) + 대표 프로필.
    같은 token_id 이면 중복 추가하지 않는다. 기존 풀 데이터는 보존(활성화만 off).
    """
    name, data = _read_modal()
    prof = data.get(name, {}) if data else {}
    tid, tsec = prof.get("token_id"), prof.get("token_secret")
    default = ({"token_id": tid, "token_secret": tsec,
                "label": name or "기존", "default": True}
               if (tid and tsec) else None)

    if not multi_account_enabled():
        return [default] if default else []

    pool = get_modal_accounts()
    ids = {a.get("token_id") for a in pool}
    out = list(pool)
    if default and default["token_id"] not in ids:
        out.append(default)
    return out


def modal_accounts_masked() -> list[dict]:
    """계정 풀의 마스킹 상태(전체 토큰 미포함) — 라벨·끝4자리만."""
    out = []
    for a in get_modal_accounts():
        out.append({"label": a.get("label", ""), "masked": _mask(a["token_id"])})
    return out


def add_modal_account(token_id: str, token_secret: str, label: str = "") -> None:
    """계정 하나 추가(기존 시크릿 재전송 없이 서버측에서 append)."""
    token_id, token_secret = (token_id or "").strip(), (token_secret or "").strip()
    if not (token_id and token_secret):
        raise ValueError("token_id/token_secret 필요")
    accts = get_modal_accounts()
    accts.append({"token_id": token_id, "token_secret": token_secret,
                  "label": (label or "").strip()})
    set_modal_accounts(accts)


def remove_modal_account(index: int) -> bool:
    accts = get_modal_accounts()
    if 0 <= index < len(accts):
        accts.pop(index)
        set_modal_accounts(accts)
        return True
    return False


def status() -> dict:
    """마스킹된 키 상태 + 현재 한도값(전체 키는 절대 미포함)."""
    try:
        gem = _gemini_api_key() or ""
    except Exception:
        gem = ""
    tts_set, tts_email = False, ""
    try:
        if GTTS_KEY_PATH.exists():
            obj = json.loads(GTTS_KEY_PATH.read_text(encoding="utf-8"))
            tts_set, tts_email = True, obj.get("client_email", "")
    except Exception:
        pass
    # 멀티엔진 TTS BYOK 키(각 엔진 모듈이 auth/에 보관) — 마스킹만 노출.
    try:
        from app.pipeline import elevenlabs_tts as _el
        el_key = _el.api_key() or ""
    except Exception:
        el_key = ""
    try:
        from app.pipeline import google_api_tts as _gapi
        gapi_key = _gapi.api_key() or ""
    except Exception:
        gapi_key = ""
    return {
        "gemini": {"set": bool(gem), "masked": _mask(gem)},
        "google_tts": {"set": tts_set, "email": tts_email},  # email은 식별용(비밀 아님)
        "elevenlabs": {"set": bool(el_key), "masked": _mask(el_key)},
        "google_api": {"set": bool(gapi_key), "masked": _mask(gapi_key)},
        "modal": _modal_status(),
        "modal_accounts": modal_accounts_masked(),   # 로테이션 풀(마스킹)
        "limits": get_limits(),
        "download_dir": get_download_dir(),
    }


def save_elevenlabs_key(key: str) -> None:
    if not (key or "").strip():
        return
    from app.pipeline import elevenlabs_tts
    elevenlabs_tts.save_key(key)


def save_google_api_key(key: str) -> None:
    if not (key or "").strip():
        return
    from app.pipeline import google_api_tts
    google_api_tts.save_key(key)


# ---- 유효성 테스트(설정 패널 '테스트' 버튼) ----

def test_gemini() -> dict:
    """Gemini 키 검증 — 아주 짧은 실호출 1회(요청 1개 소모)."""
    from app.pipeline.refine import available, _call_gemini
    if not available():
        return {"ok": False, "msg": "키 없음"}
    try:
        out = _call_gemini("한 단어로만 답: OK")
        return {"ok": True, "msg": f"응답: {(out or '')[:30]}"}
    except Exception as e:
        return {"ok": False, "msg": str(e)[:140]}


def test_tts() -> dict:
    """TTS 자격증명 로드 검증(합성 안 함 → 글자수 0)."""
    from app.pipeline import google_tts
    if not google_tts.available():
        return {"ok": False, "msg": "키 없음"}
    try:
        google_tts._client()
        return {"ok": True, "msg": "인증 로드 OK"}
    except Exception as e:
        return {"ok": False, "msg": str(e)[:140]}


def test_elevenlabs() -> dict:
    """ElevenLabs 키 검증 + 잔여 글자수(합성 안 함, 무과금)."""
    from app.pipeline import elevenlabs_tts
    if not elevenlabs_tts.available():
        return {"ok": False, "msg": "키 없음"}
    c = elevenlabs_tts.check_key()
    if c.get("ok"):
        rem = c.get("remaining")
        plan = c.get("plan") or ""
        return {"ok": True, "msg": (f"{plan} · 잔여 {rem:,}자" if rem is not None else "OK")}
    return {"ok": False, "msg": c.get("error", "실패")}


def test_google_api() -> dict:
    """Google API 키 검증 — 보이스 목록 1회 조회(합성 안 함, 무과금)."""
    from app.pipeline import google_api_tts
    if not google_api_tts.available():
        return {"ok": False, "msg": "키 없음"}
    c = google_api_tts.check_key()
    if c.get("ok"):
        return {"ok": True, "msg": f"OK · 보이스 {c.get('count', 0)}개"}
    return {"ok": False, "msg": c.get("error", "실패")}


def test_modal() -> dict:
    """Modal 토큰 + 배포 확인(hydrate로 서버 조회 강제, 실행은 안 함)."""
    try:
        import modal
        # from_name은 지연이라 hydrate로 실제 조회(토큰·배포 유효성 검증).
        modal.Function.from_name("shorts-propainter", "run_propainter").hydrate()
        return {"ok": True, "msg": "shorts-propainter 배포 확인"}
    except Exception as e:
        return {"ok": False, "msg": str(e)[:160]}
