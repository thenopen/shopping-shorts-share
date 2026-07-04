"""설정·사용량·Modal 계정 관리 라우터.

JOBS/워커/파이프라인과 무관한 관리용 엔드포인트만 모음(server_api에서 분리).
경로·동작은 기존과 100% 동일 — server_api가 include_router로 마운트한다.
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter()


@router.get("/usage")
def usage_stats():
    """API 사용량(quota 근사) — Gemini 오늘 호출/토큰, TTS 이번달 글자수, 429 쿨다운."""
    from app import usage
    return usage.snapshot()


class SettingsReq(BaseModel):
    gemini_key: str | None = None
    typecast_key: str | None = None   # Typecast(talescale) TTS API 키(BYOK)
    tts_json: str | None = None
    modal_token_id: str | None = None
    modal_token_secret: str | None = None
    modal_accounts: list | None = None   # 로테이션 풀 [{token_id, token_secret, label}]
    limits: dict | None = None
    download_dir: str | None = None


class SettingsTestReq(BaseModel):
    service: str
    token_id: str | None = None      # modal 개별 계정 테스트용(있으면 그 계정 검증)
    token_secret: str | None = None


@router.get("/settings")
def get_settings():
    """마스킹된 키 상태 + 현재 한도값(전체 키는 절대 미포함)."""
    from app import settings
    return settings.status()


@router.post("/settings")
def save_settings(req: SettingsReq):
    """제공된 항목만 저장(빈칸은 기존 유지). 키는 서버 auth/·~/.modal.toml, 한도는 settings.json."""
    from app import settings
    errs: dict = {}
    if req.gemini_key:
        try:
            settings.save_gemini_key(req.gemini_key)
        except Exception as e:
            errs["gemini"] = str(e)[:140]
    if req.typecast_key:
        try:
            from app.pipeline import typecast_tts
            typecast_tts.save_key(req.typecast_key)
        except Exception as e:
            errs["typecast"] = str(e)[:140]
    if req.tts_json:
        try:
            settings.save_tts_json(req.tts_json)
        except Exception as e:
            errs["google_tts"] = str(e)[:140]
    if req.modal_token_id or req.modal_token_secret:
        try:
            settings.save_modal_token(req.modal_token_id or "", req.modal_token_secret or "")
        except Exception as e:
            errs["modal"] = str(e)[:140]
    if req.limits:
        try:
            settings.set_limits(req.limits)
        except Exception as e:
            errs["limits"] = str(e)[:140]
    if req.download_dir is not None:
        try:
            settings.set_download_dir(req.download_dir)
        except Exception as e:
            errs["download_dir"] = str(e)[:140]
    if req.modal_accounts is not None:
        try:
            settings.set_modal_accounts(req.modal_accounts)
        except Exception as e:
            errs["modal_accounts"] = str(e)[:140]
    return {"ok": not errs, "errors": errs, "status": settings.status()}


@router.get("/tts/typecast/status")
def typecast_status():
    """Typecast 키 상태 + 잔여 크레딧(설정 배지·보이스 화면용)."""
    from app.pipeline import typecast_tts
    if not typecast_tts.available():
        return {"set": False}
    return {"set": True, **typecast_tts.check_key()}


@router.get("/tts/voices")
def tts_voices():
    """Typecast 보이스 목록(프론트 검색/필터용). 감정은 ssfm-v30 기준."""
    from app.pipeline import typecast_tts
    if not typecast_tts.available():
        raise HTTPException(400, "Typecast 키가 필요합니다.")
    out = []
    for v in typecast_tts.list_voices():
        em = next((m.get("emotions") for m in v.get("models", [])
                   if m.get("version") == "ssfm-v30"), []) or []
        out.append({
            "voice_id": v.get("voice_id"),
            "name": v.get("voice_name", ""),
            "gender": v.get("gender", ""),
            "age": v.get("age", ""),
            "use_cases": v.get("use_cases") or [],
            "emotions": list(em),
            "shorts": "TikTok/Reels/Shorts" in (v.get("use_cases") or []),
            "korean": typecast_tts.is_korean_voice(v.get("voice_name", "")),
        })
    return {"voices": out, "default": typecast_tts.DEFAULT_VOICE_ID}



class ProjectSaveReq(BaseModel):
    id: str | None = None
    state: dict = {}


@router.post("/projects")
def project_save(req: ProjectSaveReq):
    """프로젝트(편집 전체) 저장 — 신규/덮어씀. state.name 없으면 기본명."""
    from app import projects
    return projects.save(req.state or {}, pid=req.id)


@router.get("/projects")
def projects_list():
    from app import projects
    return {"projects": projects.list_all()}


@router.get("/projects/{pid}")
def project_get(pid: str):
    from app import projects
    d = projects.get(pid)
    if not d:
        raise HTTPException(404, "project not found")
    return d


@router.delete("/projects/{pid}")
def project_delete(pid: str):
    from app import projects
    return {"ok": projects.delete(pid)}


@router.get("/overlays")
def overlays_list():
    """오버레이 에셋 목록(말풍선/트랜지션/리액션) + 썸네일 URL."""
    from app import overlays
    data = overlays.load_manifest()
    for items in data.values():
        for it in items or []:
            if it.get("thumb"):
                it["thumb_url"] = f"/overlays/asset/{it['thumb']}"
    return data


@router.get("/overlays/asset/{path:path}")
def overlay_asset(path: str):
    """오버레이 썸네일/파일 서빙(assets/overlays 하위만)."""
    from app import overlays
    if ".." in path:
        raise HTTPException(403, "invalid path")
    base = overlays.OVERLAY_DIR.resolve()
    f = (base / path).resolve()
    if not f.is_relative_to(base) or not f.exists():
        raise HTTPException(404, "not found")
    return FileResponse(str(f))


@router.post("/settings/test")
def test_settings(req: SettingsTestReq):
    """설정 패널 '테스트' — 서비스별 유효성 확인(gemini는 요청 1회 소모)."""
    from app import settings
    s = (req.service or "").lower()
    if s == "typecast":
        from app.pipeline import typecast_tts
        c = typecast_tts.check_key()
        if c.get("ok"):
            return {"ok": True, "msg": f"{c.get('plan')} · 잔여 {c.get('remaining'):,}자"}
        return {"ok": False, "msg": c.get("error", "실패")}
    if s == "gemini":
        return settings.test_gemini()
    if s == "tts":
        return settings.test_tts()
    if s == "modal":
        if req.token_id and req.token_secret:
            from app import modal_pool
            return modal_pool.test_account(req.token_id, req.token_secret)
        return settings.test_modal()
    raise HTTPException(400, "unknown service")


@router.get("/modal/accounts")
def modal_accounts_status():
    """로테이션 풀 각 계정의 마스킹 + 이번달 추정 사용액/잔여 크레딧 + 배포 상태."""
    from app import settings, usage, modal_pool
    lim = settings.get_limits().get("modal_credit", 30.0)
    out = []
    for a in settings.get_modal_accounts():
        cost = usage.modal_account_cost(a["token_id"])
        dep = modal_pool.deploy_status(a["token_id"])
        state = dep.get("state", "unknown")
        # 라이브 상태가 없으면(재시작 등) 영속 배포플래그로 폴백.
        if state == "unknown" and a.get("deployed"):
            state = "done"
        out.append({
            "label": a.get("label", ""),
            "masked": settings._mask(a["token_id"]),
            "cost": round(cost, 2),
            "remaining": round(max(0.0, lim - cost), 2),
            "deploy": state,                              # unknown|deploying|done|error
            "deploy_msg": (dep.get("msg") or "")[-160:],
        })
    pool_n = len(out)
    total_n = len(settings.effective_accounts())         # 풀 + 기존(대표)
    return {"accounts": out, "limit": lim, "total": total_n,
            "default_included": total_n > pool_n}


class ModalAccountReq(BaseModel):
    token_id: str
    token_secret: str
    label: str = ""


@router.post("/modal/accounts/add")
def modal_account_add(req: ModalAccountReq):
    """계정 추가(기존 시크릿 재전송 없이) + 그 계정에 자동 배포(백그라운드). 갱신 목록 반환."""
    from app import settings, modal_pool
    try:
        settings.add_modal_account(req.token_id, req.token_secret, req.label)
    except Exception as e:
        raise HTTPException(400, str(e)[:140]) from e
    # 추가 즉시 그 계정 워크스페이스에 shorts-propainter 배포 시작(사용자가 CLI 없이 활성화).
    modal_pool.deploy_account(req.token_id, req.token_secret)
    return modal_accounts_status()


class ModalDeployReq(BaseModel):
    index: int


@router.post("/modal/accounts/deploy")
def modal_account_deploy(req: ModalDeployReq):
    """풀의 index 계정에 shorts-propainter 재배포(백그라운드). 상태는 /modal/accounts에."""
    from app import settings, modal_pool
    accts = settings.get_modal_accounts()
    if not (0 <= req.index < len(accts)):
        raise HTTPException(400, "bad index")
    a = accts[req.index]
    modal_pool.deploy_account(a["token_id"], a["token_secret"])
    return {"ok": True, "state": "deploying"}


@router.delete("/modal/accounts/{index}")
def modal_account_del(index: int):
    """풀에서 index 계정 제거."""
    from app import settings
    return {"ok": settings.remove_modal_account(index), **modal_accounts_status()}
