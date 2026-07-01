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

AUTH_DIR = BACKEND_ROOT / "auth"
GEMINI_KEY_PATH = AUTH_DIR / "gemini_key.txt"
GTTS_KEY_PATH = AUTH_DIR / "google_tts_key.json"
LIMITS_PATH = WORKDIR / "settings.json"
MODAL_TOML = Path.home() / ".modal.toml"
DEFAULT_DOWNLOAD_DIR = BACKEND_ROOT / "downloads"   # 다운로드 영상 라이브러리 기본 위치

# 한도 기본값(env로도 조정 가능). settings.json이 있으면 그 값이 우선.
DEFAULT_LIMITS = {
    "gemini_rpd": int(os.environ.get("GEMINI_RPD_LIMIT", "1000")),
    "gemini_tpm": int(os.environ.get("GEMINI_TPM_LIMIT", "250000")),
    "tts_chars": int(os.environ.get("TTS_CHARS_LIMIT", "1000000")),
    "modal_credit": float(os.environ.get("MODAL_CREDIT_LIMIT", "30")),
}


def get_limits() -> dict:
    """기본값 위에 settings.json 저장값을 덮어 반환."""
    d = dict(DEFAULT_LIMITS)
    try:
        saved = json.loads(LIMITS_PATH.read_text(encoding="utf-8"))
        for k in DEFAULT_LIMITS:
            if saved.get(k) is not None:
                d[k] = type(DEFAULT_LIMITS[k])(saved[k])
    except Exception:
        pass
    return d


def set_limits(vals: dict) -> None:
    try:
        cur = json.loads(LIMITS_PATH.read_text(encoding="utf-8"))
    except Exception:
        cur = {}
    for k in DEFAULT_LIMITS:
        v = (vals or {}).get(k)
        if v not in (None, ""):
            try:
                cur[k] = type(DEFAULT_LIMITS[k])(v)
            except Exception:
                pass
    LIMITS_PATH.parent.mkdir(parents=True, exist_ok=True)
    LIMITS_PATH.write_text(json.dumps(cur, ensure_ascii=False, indent=1), encoding="utf-8")


def get_download_dir() -> str:
    """다운로드 영상 보관 폴더(서버측 경로). settings.json 값 > 기본값."""
    try:
        v = json.loads(LIMITS_PATH.read_text(encoding="utf-8")).get("download_dir")
        if v and str(v).strip():
            return str(v).strip()
    except Exception:
        pass
    return str(DEFAULT_DOWNLOAD_DIR)


def set_download_dir(path: str) -> None:
    path = (path or "").strip()
    try:
        cur = json.loads(LIMITS_PATH.read_text(encoding="utf-8"))
    except Exception:
        cur = {}
    cur["download_dir"] = path
    LIMITS_PATH.parent.mkdir(parents=True, exist_ok=True)
    LIMITS_PATH.write_text(json.dumps(cur, ensure_ascii=False, indent=1), encoding="utf-8")


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
        v = json.loads(LIMITS_PATH.read_text(encoding="utf-8")).get("modal_accounts")
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
    try:
        cur = json.loads(LIMITS_PATH.read_text(encoding="utf-8"))
    except Exception:
        cur = {}
    cur["modal_accounts"] = clean
    LIMITS_PATH.parent.mkdir(parents=True, exist_ok=True)
    LIMITS_PATH.write_text(json.dumps(cur, ensure_ascii=False, indent=1), encoding="utf-8")


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
    gem = ""
    try:
        gem = os.environ.get("GEMINI_API_KEY") or (
            GEMINI_KEY_PATH.read_text(encoding="utf-8").strip() if GEMINI_KEY_PATH.exists() else "")
    except Exception:
        pass
    tts_set, tts_email = False, ""
    try:
        if GTTS_KEY_PATH.exists():
            obj = json.loads(GTTS_KEY_PATH.read_text(encoding="utf-8"))
            tts_set, tts_email = True, obj.get("client_email", "")
    except Exception:
        pass
    return {
        "gemini": {"set": bool(gem), "masked": _mask(gem)},
        "google_tts": {"set": tts_set, "email": tts_email},  # email은 식별용(비밀 아님)
        "modal": _modal_status(),
        "modal_accounts": modal_accounts_masked(),   # 로테이션 풀(마스킹)
        "limits": get_limits(),
        "download_dir": get_download_dir(),
    }


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


def test_modal() -> dict:
    """Modal 토큰 + 배포 확인(hydrate로 서버 조회 강제, 실행은 안 함)."""
    try:
        import modal
        # from_name은 지연이라 hydrate로 실제 조회(토큰·배포 유효성 검증).
        modal.Function.from_name("shorts-propainter", "run_propainter").hydrate()
        return {"ok": True, "msg": "shorts-propainter 배포 확인"}
    except Exception as e:
        return {"ok": False, "msg": str(e)[:160]}
