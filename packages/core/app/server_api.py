"""FastAPI backend for the shopping shorts maker."""

from __future__ import annotations

import os
import re
import shutil
import threading
import time
import uuid
from contextlib import contextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import WORKDIR
from app.media_util import grab_frame
from app.url_extract import extract_url

app = FastAPI(title="쇼핏 쇼츠 메이커 API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

JOBS: dict[str, dict] = {}

# GPU 작업(자막 인페인트·whisper STT/정렬) 직렬화 — 동시 실행 시 8GB VRAM OOM 방지.
# HTTP 응답은 워커 스레드가 즉시 반환하고, GPU 구간만 이 세마포어로 한 번에 하나씩.
GPU_SEM = threading.Semaphore(1)


@contextmanager
def gpu_slot(job: dict, wait_stage: str = "GPU 대기 중 (앞 작업 먼저 처리)"):
    """GPU 슬롯 확보. 즉시 못 잡으면 job을 'waiting_gpu'로 표시했다가, 잡으면 원상복귀.

    프론트가 얼어붙은 게 아니라 '대기열'임을 알 수 있게 함. with GPU_SEM 대체.
    """
    if GPU_SEM.acquire(blocking=False):
        got_immediately = True
    else:
        got_immediately = False
        prev_status, prev_stage = job.get("status"), job.get("stage")
        job.update(status="waiting_gpu", stage=wait_stage)
        GPU_SEM.acquire()  # 블로킹 대기
        job.update(status=prev_status, stage=prev_stage)
    try:
        yield got_immediately
    finally:
        GPU_SEM.release()

# 메모리(JOBS)·디스크(workdir) 무한 증가 방지용 TTL. 영속화는 아니며 정리만.
_DONE_TTL = 6 * 3600       # 완료/오류 job: 6시간 후 정리
_HARD_TTL = 24 * 3600      # 모든 job: 24시간 후 강제 정리(작업중 보호 상한)

CTA_TEXT = {
    "comment": "제품 정보는 고정 댓글에서 확인하세요!",
    "profile": "구매처는 프로필 링크에 있어요.",
    "link": "자세한 내용은 하단 링크를 눌러주세요.",
}


def _prune_jobs() -> None:
    """오래된 job을 JOBS·workdir에서 정리. _new_job마다 기회주의적 호출."""
    now = time.time()
    for jid in list(JOBS.keys()):
        j = JOBS.get(jid) or {}
        age = now - j.get("created", now)
        if (j.get("status") in ("done", "error") and age > _DONE_TTL) or age > _HARD_TTL:
            JOBS.pop(jid, None)
            shutil.rmtree(WORKDIR / jid, ignore_errors=True)


def _new_job() -> str:
    _prune_jobs()
    jid = uuid.uuid4().hex[:8]
    JOBS[jid] = {
        "id": jid,
        "status": "queued",
        "progress": 0,
        "stage": "",
        "script": "",
        "preview": None,
        "output": None,
        "error": None,
        "has_speech": None,
        "created": time.time(),
        "meta": {},
    }
    return jid


def _require_job(jid: str) -> dict:
    """job 존재 확인 후 반환. 없으면 404."""
    job = JOBS.get(jid)
    if job is None:
        raise HTTPException(404, "job not found")
    return job


class AnalyzeReq(BaseModel):
    url: str
    # 자막제거 ProPainter 백엔드: modal(클라우드)만 서비스. local(로컬 GPU)은 제품에서
    # 제외됨 — 외부 요청으론 선택 불가, 서버 env ALLOW_LOCAL_GPU=1 일 때만 허용(디버깅용).
    subtitle_backend: str = "modal"
    reuse_nosub: bool = True   # 캐시된 자막제거본이 있으면 재사용(False=강제 재처리)


class TranscribeReq(BaseModel):
    job_id: str
    reuse_script: bool = True   # 캐시된 대본이 있으면 재사용(False=강제 재생성)


class RefineReq(BaseModel):
    script: str


class RenderReq(BaseModel):
    job_id: str
    script: str = ""
    voice: str = "소담"
    speaking_rate: float = 1.0
    cta: str = "profile"
    cta_on: bool = True              # CTA 자막 넣기/빼기(체크박스)
    cta_size: int = 56               # CTA 글자 크기(px)
    cta_pos: float = 0.88            # CTA 세로 위치(0=위~1=아래)
    captions: bool = True            # TTS 대본 자동자막 on/off
    caption_style: dict | None = None  # 웹 CaptionStyle (font/size/color/...) — 기본 스타일
    caption_lines: list | None = None  # 타임라인 편집기서 수정한 줄들(있으면 자동생성 대신 이걸 burn)
    face_cut: bool = False           # 얼굴 전체샷 구간 자동 컷 제거(opt-in, 기본 off)


class CaptionPreviewReq(BaseModel):
    job_id: str
    script: str = ""
    voice: str = "소담"
    speaking_rate: float = 1.0
    caption_style: dict | None = None


class CaptionEditReq(BaseModel):
    lines: list = []                  # 현재 자막 줄 [{text,start,end,style}]
    direction: str = "natural"        # shorter|longer|natural|impact|friendly|concise
    caption_style: dict | None = None


class ProductScriptReq(BaseModel):
    product_url: str = ""              # 제품 상세페이지 URL(스토어/올영 자동크롤, 쿠팡 전용프로필)
    product_image: str = ""            # 캡처 1장 base64(하위호환) — URL 차단 폴백
    product_images: list[str] = []     # 캡처 여러 장 base64(data URL 또는 순수 b64)
    manual_points: str = ""            # 직접 적은 소구포인트(선택)
    video_content: str = ""            # 영상에서 뽑은 내용/현재 대본(있으면 결합)
    combine: bool = True               # True면 영상내용+소구포인트 결합 대본까지 생성


@app.post("/analyze")
def analyze(req: AnalyzeReq):
    jid = _new_job()
    # 로컬 GPU 자막제거는 서비스에서 제외 — 외부 요청이 subtitle_backend로 로컬 GPU를
    # 트리거하지 못하게 modal로 강제. 디버깅 시에만 서버 env ALLOW_LOCAL_GPU=1로 허용.
    backend = req.subtitle_backend
    if backend != "modal" and os.environ.get("ALLOW_LOCAL_GPU") != "1":
        backend = "modal"
    threading.Thread(target=_analyze_worker, args=(jid, req.url, backend, req.reuse_nosub),
                     daemon=True).start()
    return {"job_id": jid}


@app.post("/transcribe")
def transcribe(req: TranscribeReq):
    _require_job(req.job_id)
    threading.Thread(target=_transcribe_worker, args=(req.job_id, req.reuse_script),
                     daemon=True).start()
    return {"job_id": req.job_id}


@app.post("/refine")
def refine(req: RefineReq):
    from app.pipeline.refine import available, refine_script

    if not available():
        raise HTTPException(400, "Gemini key not found. Add auth/gemini_key.txt or GEMINI_API_KEY.")
    return {"script": refine_script(req.script)}


@app.post("/render")
def render(req: RenderReq):
    _require_job(req.job_id)
    threading.Thread(target=_render_worker, args=(req.job_id, req), daemon=True).start()
    return {"job_id": req.job_id}


@app.post("/captions/preview")
def captions_preview(req: CaptionPreviewReq):
    """대본 → TTS 돌려 자동자막 줄(타임코드)을 만들어 반환(편집용, 영상렌더 안 함).

    웹 타임라인 편집기가 이 줄들을 받아 start/end·텍스트·줄별 스타일을 수정한 뒤
    /render 의 caption_lines 로 다시 보낸다. dub.mp3는 캐시로 남겨 렌더때 재사용.
    """
    _require_job(req.job_id)
    if not req.script.strip():
        raise HTTPException(400, "script is empty")
    try:
        from app.pipeline.tts import synthesize_by_nickname
        from app.pipeline.caption import (
            build_lines_from_tts, lines_to_payload, style_from_dict,
        )

        job_dir = WORKDIR / req.job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        dub = job_dir / "dub.mp3"
        _dub, stamps = synthesize_by_nickname(
            req.script, dub, nickname=req.voice, speaking_rate=req.speaking_rate,
        )
        # 프리뷰도 렌더와 동일하게: 타임스탬프 없으면 whisper 재정렬(싱크 일치).
        if not stamps and _dub:
            from app.pipeline.align import word_timestamps
            with GPU_SEM:
                stamps = word_timestamps(_dub, language="ko")
        style = style_from_dict(req.caption_style)
        total = _probe_dur(_dub)
        lines = build_lines_from_tts(stamps, style, total_dur=total, full_text=req.script)
        return {"lines": lines_to_payload(lines, style), "duration": total}
    except Exception as e:
        raise HTTPException(500, f"caption preview failed: {str(e)[:300]}") from e


@app.post("/captions/edit")
def captions_edit(req: CaptionEditReq):
    """현재 자막 줄들을 '수정 방향'대로 변환해 새 줄들 반환(타임코드 유지, 재렌더 안 함).

    방향:
      shorter/longer  — 더 짧게/길게 재분할(결정형, 즉시·무료)
      natural/impact/friendly/concise — Gemini로 의미 재작성 후 재분할
    시간은 원본 전체 구간[첫줄 start ~ 끝줄 end]을 글자수 비례로 재배분.
    """
    from app.pipeline.caption import (
        split_korean_lines, style_from_dict, lines_to_payload, CaptionLine,
    )

    src = [ln for ln in (req.lines or []) if (ln.get("text") or "").strip()]
    if not src:
        raise HTTPException(400, "no caption lines to edit")

    text = " ".join((ln.get("text") or "").replace("\n", " ").strip() for ln in src).strip()
    try:
        t0 = min(float(ln.get("start", 0.0)) for ln in src)
        t1 = max(float(ln.get("end", 0.0)) for ln in src)
    except (TypeError, ValueError):
        t0, t1 = 0.0, 0.0
    if t1 <= t0:
        t1 = t0 + max(1.0, len(src) * 1.5)
    span = t1 - t0

    d = (req.direction or "natural").lower()
    AI_DIRS = ("natural", "impact", "friendly", "concise")
    try:
        if d in AI_DIRS:
            from app.pipeline.refine import rewrite_caption_text, available
            if not available():
                raise HTTPException(400, "AI 다듬기는 Gemini 키가 필요합니다(auth/gemini_key.txt).")
            text = rewrite_caption_text(text, d)
            chunks = split_korean_lines(text, ideal=8, max_chars=10, min_chars=6)
        elif d == "shorter":
            chunks = split_korean_lines(text, ideal=6, max_chars=8, min_chars=4)
        elif d == "longer":
            chunks = split_korean_lines(text, ideal=11, max_chars=14, min_chars=8)
        else:
            chunks = split_korean_lines(text, ideal=8, max_chars=10, min_chars=6)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"caption edit failed: {str(e)[:300]}") from e

    if not chunks:
        raise HTTPException(500, "edit produced no lines")

    style = style_from_dict(req.caption_style)
    total_chars = sum(len(c.replace(" ", "")) for c in chunks) or 1
    out: list = []
    t = t0
    for c in chunks:
        seg = span * (len(c.replace(" ", "")) / total_chars)
        out.append(CaptionLine(text=c, start=round(t, 2), end=round(t + seg, 2), style=style))
        t += seg
    if out:
        out[-1].end = round(t1, 2)
    return {"lines": lines_to_payload(out, style)}


@app.post("/tts/preview")
def tts_preview(req: CaptionPreviewReq):
    """대본 + 선택 voice → TTS mp3 생성, 재생용 URL 반환(영상 렌더 안 함).

    voice 바꿔 다시 호출하면 새로 생성 → 들어보고 맘에 드는 보이스 고를 수 있음.
    파일명에 voice 넣어 브라우저 캐시가 옛 음성 재생하는 것 방지.
    """
    if not req.script.strip():
        raise HTTPException(400, "script is empty")
    try:
        from app.pipeline.tts import synthesize_by_nickname
        import re
        # 서버 재기동으로 JOBS(메모리)가 비어도, 또는 분석 전이라도 미리듣기는 되게:
        # job_id 폴더가 있으면 쓰고, 없으면 '_ttspreview' 공용 폴더에 생성.
        jid = req.job_id if (req.job_id and (WORKDIR / req.job_id).exists()) else "_ttspreview"
        job_dir = WORKDIR / jid
        job_dir.mkdir(parents=True, exist_ok=True)
        safe_voice = re.sub(r"[^0-9A-Za-z가-힣]", "", req.voice) or "voice"
        fname = f"preview_{safe_voice}.mp3"
        _dub, _stamps = synthesize_by_nickname(
            req.script, job_dir / fname, nickname=req.voice, speaking_rate=req.speaking_rate,
        )
        return {"audio": f"/file/{jid}/{fname}", "duration": _probe_dur(_dub)}
    except Exception as e:
        raise HTTPException(500, f"tts preview failed: {str(e)[:300]}") from e


@app.post("/script/product")
def script_product(req: ProductScriptReq):
    """제품 상세페이지(URL/캡처이미지/수동) → 소구포인트 추출 + 영상내용 결합 대본.

    우선순위: manual_points > product_image > product_url.
    어느 입력도 없으면 400. 크롤 차단(쿠팡 등) 시 error에 사유 담아 반환.
    """
    from app.pipeline.product_scrape import extract_selling_points
    from app.pipeline.refine import product_script

    raw_imgs = list(req.product_images or [])
    if req.product_image:
        raw_imgs.append(req.product_image)
    images = [b for b in (_decode_image_b64(s) for s in raw_imgs) if b]
    if not (req.product_url.strip() or images or req.manual_points.strip()):
        raise HTTPException(400, "product_url·product_images·manual_points 중 하나가 필요합니다.")

    debug: list = []
    debug.append(f"입력: url={'있음' if req.product_url.strip() else '없음'}, 이미지 {len(images)}장, "
                 f"manual={'있음' if req.manual_points.strip() else '없음'}, "
                 f"영상내용 {len(req.video_content or '')}자, combine={req.combine}")
    try:
        sp = extract_selling_points(
            url=req.product_url or None,
            images=images or None,
            manual=req.manual_points or None,
            debug=debug,
        )
    except Exception as e:
        raise HTTPException(500, f"소구포인트 추출 실패: {str(e)[:300]}") from e

    points = sp.get("points", "")
    if not points and sp.get("error"):
        # 크롤 차단 등 — 포인트 못 뽑음. 사유 그대로 전달(웹이 폴백 안내).
        debug.append(f"■ 종료: 소구포인트 못 뽑음 (사유: {sp['error'][:140]})")
        return {"selling_points": "", "script": "", "source": sp.get("source", ""),
                "site": sp.get("site", ""), "error": sp["error"], "debug": debug}

    script = ""
    if req.combine:
        script = product_script(req.video_content, points, debug=debug)
    debug.append(f"■ 완료: 소구포인트 {len(points)}자, 대본 {len(script)}자")
    return {"selling_points": points, "script": script,
            "source": sp.get("source", ""), "site": sp.get("site", ""), "error": "", "debug": debug}


def _decode_image_b64(s: str) -> bytes | None:
    """data URL 또는 순수 base64 → bytes."""
    import base64
    s = (s or "").strip()
    if not s:
        return None
    if s.startswith("data:"):
        s = s.split(",", 1)[-1]
    try:
        return base64.b64decode(s)
    except Exception:
        return None


@app.get("/jobs/{jid}")
def get_job(jid: str):
    return _require_job(jid)


class QualityReq(BaseModel):
    job_id: str
    count: int = 8


@app.post("/quality/frames")
def quality_frames(req: QualityReq):
    """자막 제거 품질 확인 — 영상 여러 지점(군데군데)에서 원본 vs 제거본(nosub) 프레임 추출.

    같은 타임스탬프의 원본/제거본을 나란히 보면 자막 잔상·번짐·복원 실패를 바로 눈으로 잡는다.
    """
    import subprocess
    from app.config import FFMPEG

    job = _require_job(req.job_id)
    job_dir = WORKDIR / req.job_id
    try:
        src = _source_for_job(req.job_id)
    except FileNotFoundError:
        raise HTTPException(404, "source not found") from None
    nosub = job_dir / "nosub.mp4"
    have_nosub = nosub.exists()
    dur = _probe_dur(nosub if have_nosub else src) or 0.0
    n = max(2, min(int(req.count or 8), 16))

    def _grab(inp, out, t):
        return grab_frame(inp, out, t)

    frames = []
    for i in range(n):
        t = dur * (i + 0.5) / n if dur else float(i)
        sp = job_dir / f"q{i:02d}_src.jpg"
        npj = job_dir / f"q{i:02d}_nosub.jpg"
        s_ok = _grab(src, sp, t)
        n_ok = have_nosub and _grab(nosub, npj, t)
        frames.append({
            "t": round(t, 1),
            "source": f"/file/{req.job_id}/{sp.name}" if s_ok else None,
            "nosub": f"/file/{req.job_id}/{npj.name}" if n_ok else None,
        })
    return {"frames": frames, "engine": job.get("subtitle_engine"),
            "engine_note": job.get("subtitle_engine_note")}


_SAFE_SEG = re.compile(r"^[A-Za-z0-9_.\-]+$")


@app.get("/file/{jid}/{name}")
def get_file(jid: str, name: str):
    # Path traversal 가드: 세그먼트 화이트리스트 + workdir 밖 탈출 차단.
    if not (_SAFE_SEG.match(jid) and _SAFE_SEG.match(name)) or ".." in jid or ".." in name:
        raise HTTPException(403, "invalid path")
    base = WORKDIR.resolve()
    f = (base / jid / name).resolve()
    try:
        inside = f.is_relative_to(base)
    except AttributeError:  # py<3.9 안전망(런타임은 3.12)
        inside = str(f).startswith(str(base))
    if not inside:
        raise HTTPException(403, "forbidden")
    if not f.exists():
        raise HTTPException(404, "file not found")
    return FileResponse(str(f))


@app.get("/")
def root():
    return {"ok": True, "service": "쇼핏 쇼츠 메이커 API"}


@app.get("/usage")
def usage_stats():
    """API 사용량(quota 근사) — Gemini 오늘 호출/토큰, TTS 이번달 글자수, 429 쿨다운."""
    from app import usage
    return usage.snapshot()


class SettingsReq(BaseModel):
    gemini_key: str | None = None
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


class PreviewUrlReq(BaseModel):
    url: str


@app.get("/settings")
def get_settings():
    """마스킹된 키 상태 + 현재 한도값(전체 키는 절대 미포함)."""
    from app import settings
    return settings.status()


@app.post("/settings")
def save_settings(req: SettingsReq):
    """제공된 항목만 저장(빈칸은 기존 유지). 키는 서버 auth/·~/.modal.toml, 한도는 settings.json."""
    from app import settings
    errs: dict = {}
    if req.gemini_key:
        try:
            settings.save_gemini_key(req.gemini_key)
        except Exception as e:
            errs["gemini"] = str(e)[:140]
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


@app.post("/settings/test")
def test_settings(req: SettingsTestReq):
    """설정 패널 '테스트' — 서비스별 유효성 확인(gemini는 요청 1회 소모)."""
    from app import settings
    s = (req.service or "").lower()
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


@app.get("/modal/accounts")
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


@app.post("/modal/accounts/add")
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


@app.post("/modal/accounts/deploy")
def modal_account_deploy(req: ModalDeployReq):
    """풀의 index 계정에 shorts-propainter 재배포(백그라운드). 상태는 /modal/accounts에."""
    from app import settings, modal_pool
    accts = settings.get_modal_accounts()
    if not (0 <= req.index < len(accts)):
        raise HTTPException(400, "bad index")
    a = accts[req.index]
    modal_pool.deploy_account(a["token_id"], a["token_secret"])
    return {"ok": True, "state": "deploying"}


@app.delete("/modal/accounts/{index}")
def modal_account_del(index: int):
    """풀에서 index 계정 제거."""
    from app import settings
    return {"ok": settings.remove_modal_account(index), **modal_accounts_status()}


@app.post("/preview_url")
def preview_url(req: PreviewUrlReq):
    """확인(미리보기) — 제목·썸네일. 라이브러리에 있으면 재사용 표시, 없으면 yt-dlp 메타.
    도우인은 yt-dlp 미지원이라 분석(다운로드) 후 썸네일이 보인다."""
    from app import library
    url = extract_url(req.url) or (req.url or "").strip()
    if not url:
        raise HTTPException(400, "url is empty")
    ent = library.find(url)
    if ent:
        return {
            "url": url, "in_library": True, "reused": True,
            "title": ent.get("title") or "", "duration": ent.get("duration"),
            "platform": ent.get("platform", ""),
            "stages": ent.get("stages"),
            "thumb": f"/library/thumb/{ent['key']}" if ent.get("has_thumb") else None,
        }
    platform = "douyin" if "douyin" in url else ("tiktok" if "tiktok" in url else "")
    if platform == "douyin":
        return {"url": url, "in_library": False, "reused": False, "platform": "douyin",
                "title": None, "thumb": None,
                "note": "도우인은 분석(다운로드) 후 썸네일이 보여요. 다음부터 자동 재사용됩니다."}
    try:
        from app.pipeline.download import probe_preview
        info = probe_preview(url)
        return {"url": url, "in_library": False, "reused": False, "platform": platform, **info}
    except Exception as e:
        return {"url": url, "in_library": False, "reused": False, "platform": platform,
                "title": None, "thumb": None, "error": str(e)[:200]}


_HEX_KEY = re.compile(r"^[0-9a-f]{6,40}$")


@app.get("/library")
def library_list():
    """다운로드 보관 영상 목록(최근순) — 재사용용."""
    from app import library
    return {"entries": library.list_entries()}


@app.get("/library/thumb/{key}")
def library_thumb(key: str):
    from app import library
    if not _HEX_KEY.match(key or ""):
        raise HTTPException(400, "bad key")
    p = library.thumb_path(key)
    if not p:
        raise HTTPException(404, "thumb not found")
    return FileResponse(str(p))


@app.delete("/library/{key}")
def library_delete(key: str):
    """보관 영상 삭제."""
    from app import library
    if not _HEX_KEY.match(key or ""):
        raise HTTPException(400, "bad key")
    return {"ok": library.delete(key)}


class LibraryLoadReq(BaseModel):
    url: str = ""
    key: str = ""


@app.post("/library/load")
def library_load(req: LibraryLoadReq):
    """'이어하기' — 보관본을 새 job으로 즉시 불러온다(재실행 없이). 캐시된 단계까지
    job에 채워 그 지점부터 이어서 작업: source → (nosub) → (script). 렌더 바로 가능."""
    import shutil
    from app import library

    url = extract_url(req.url) or (req.url or "").strip()
    if not url and req.key:
        for e in library.list_entries(limit=1000):
            if e.get("key") == req.key:
                url = e.get("url", "")
                break
    ent = library.find(url) if url else None
    if not ent:
        raise HTTPException(404, "library entry not found")

    jid = _new_job()
    job = JOBS[jid]
    job_dir = WORKDIR / jid
    job_dir.mkdir(parents=True, exist_ok=True)
    job["meta"]["url"] = url
    job["title"] = ent.get("title") or ""
    job["meta"]["title"] = ent.get("title") or ""
    job["reused"] = True
    stages = ent.get("stages") or {}

    shutil.copy2(ent["source"], job_dir / "source.mp4")
    loaded = "source"
    job["preview"] = f"/file/{jid}/source.mp4"

    if stages.get("nosub") and library.reuse_nosub_into(url, job_dir / "nosub.mp4"):
        job["preview"] = f"/file/{jid}/nosub.mp4"
        job["subtitle_engine"] = "cached"
        loaded = "nosub"

    script = ""
    if stages.get("script"):
        sc = library.get_script(url) or {}
        script = (sc.get("ko_text") or "").strip()
        if script:
            job["script"] = script
            job["has_speech"] = bool(sc.get("has_speech"))
            job["meta"]["transcribe"] = {
                "provider": sc.get("provider"), "zh_text": sc.get("zh_text", ""),
                "segments": sc.get("segments", []),
            }
            loaded = "script"

    if loaded == "script":
        job.update(status="transcribed", stage="대본까지 불러옴 · 이어서 렌더", progress=100)
    elif loaded == "nosub":
        job.update(status="analyzed", stage="자막제거본 불러옴 · 이어서 대본/렌더", progress=100)
    else:
        job.update(status="analyzed", stage="원본 불러옴", progress=100)

    return {"job_id": jid, "loaded": loaded, "title": job["title"],
            "script": script, "preview": job.get("preview"), "stages": stages,
            "has_speech": job.get("has_speech")}


def _analyze_worker(jid: str, raw_url: str, subtitle_backend: str = "modal",
                    reuse_nosub: bool = True):
    job = JOBS[jid]
    try:
        from app.pipeline.download import download_video
        from app.pipeline.douyin_download import download_douyin
        from app.pipeline.subtitle_detect import detect_segments
        from app.pipeline.subtitle_remove import remove_subtitle
        from app.pipeline.subtitle_inpaint import inpaint_subtitles
        from app.pipeline.overlay_mask import fixed_overlay_boxes
        import cv2 as _cv2

        url = extract_url(raw_url) or raw_url
        job_dir = WORKDIR / jid
        job_dir.mkdir(parents=True, exist_ok=True)
        job["meta"]["url"] = url   # transcribe 등 후속 단계가 라이브러리 키로 사용

        from app import library
        from app.pipeline.download import probe_info

        platform = "douyin" if "douyin" in url else ("tiktok" if "tiktok" in url else "")
        # 진행률은 '현재 단계 기준 0~100'. 단계 전환 때마다 그 단계의 0에서 시작.
        job.update(status="downloading", stage="영상 다운로드", progress=0, error=None)
        job_src = job_dir / "source.mp4"

        # 이미 받은 영상이면 재사용(다운로드 생략) — 라이브러리 보관본을 job으로 링크/복사.
        if library.reuse_into(url, job_src):
            source = job_src
            ent = library.find(url) or {}
            job["reused"] = True
            job["title"] = ent.get("title") or ""
            job["meta"]["title"] = ent.get("title") or ""
            job.update(stage="이미 받은 영상 재사용", progress=100)
        else:
            info: dict = {}
            if platform == "douyin":
                # diag 리스트를 먼저 job에 걸어두면 다운로드가 실패(raise)해도
                # 그때까지 수집된 후보/트랙 진단이 job에 남아 웹 F12 콘솔에 표시됨.
                douyin_diag: list = []
                job["douyin_diag"] = douyin_diag
                source = download_douyin(url, jid, diag=douyin_diag)
            else:
                source = download_video(url, jid)
                try:
                    info = probe_info(url)
                except Exception:
                    info = {}
            # 라이브러리 등록: 다음부터 재사용 + 썸네일(ffmpeg 프레임)·메타 저장.
            try:
                meta = library.register(
                    url, source, title=(info.get("title") or ""),
                    duration=info.get("duration"), width=info.get("width"),
                    height=info.get("height"), platform=platform)
                job["title"] = meta.get("title") or ""
                job["meta"]["title"] = meta.get("title") or ""
            except Exception as e:
                print(f"  [library register 실패: {str(e)[:120]}]")
            job["reused"] = False
        job["meta"]["source"] = str(source)

        # 진행률은 '현재 단계 기준 0~100'(전체 파이프라인 아님). 단계마다 0에서 시작.
        job.update(status="removing_subtitle", stage="자막·워터마크 제거", progress=0)
        job_nosub = job_dir / "nosub.mp4"

        # 자막제거 판단/폴백 과정을 DEBUG로 남긴다 → job에 쌓아 웹 F12 콘솔에 노출 + 서버 로그.
        from app.debuglog import make_dbg
        dbg = job.setdefault("subtitle_debug", [])
        _dbg = make_dbg(dbg, "자막제거")

        _dbg(f"입력: reuse_nosub={reuse_nosub}, backend={subtitle_backend}, "
             f"PROPAINTER={os.environ.get('PROPAINTER', '1')}, platform={platform or '-'}")

        # 이미 만든 자막제거본이 있으면 재사용(자막탐지·GPU 인페인트 전부 생략).
        if reuse_nosub and library.reuse_nosub_into(url, job_nosub):
            job["subtitle_engine"] = "cached"
            _dbg("→ 자막제거본 캐시 재사용(다시 처리 안 함). '자막제거 다시'로 강제 재실행 가능")
            job.update(stage="자막 제거본 재사용", progress=100)
        else:
            # 화면 전체 OCR로 자막+워터마크 글자 모두 탐지(언어 무관, 하단제한 해제).
            # require_center=True: 가로로 긴 중앙정렬 자막 형태만 → 상품 패키지/배경 글자 과제거 방지.
            # interval 0.25s: 짧게 뜨는 자막·라벨도 놓치지 않게.
            try:
                segments = detect_segments(source, interval_sec=0.25, full_frame=True,
                                           require_center=True, pad=14)
            except Exception as e:
                _dbg(f"자막 탐지 실패: {str(e)[:150]}")
                segments = []

            # 도우인/틱톡 고정 UI영역(우측 버튼열·좌하단 아이디·상단 탭) 항상 inpaint.
            # OVERLAY_FIXED_UI=0 환경변수로 끔(클린 추출본에서 본체 손상 방지용).
            ui_enabled = platform != "" and os.environ.get("OVERLAY_FIXED_UI", "1") != "0"
            fixed_boxes = []
            if ui_enabled:
                cap = _cv2.VideoCapture(str(source))
                w = int(cap.get(_cv2.CAP_PROP_FRAME_WIDTH))
                h = int(cap.get(_cv2.CAP_PROP_FRAME_HEIGHT))
                cap.release()
                fixed_boxes = fixed_overlay_boxes(w, h, platform=platform, enabled=True)

            _dbg(f"탐지 결과: 자막 세그먼트 {len(segments)}개, 고정 UI박스 {len(fixed_boxes)}개")
            if segments or fixed_boxes:
                def _ip_prog(frac):
                    # 자막제거 단계 자체 0~100 (LaMa 등 프레임 콜백 기준)
                    job.update(progress=int(frac * 100),
                               stage=f"자막·워터마크 제거 ({int(frac*100)}%)")
                nosub = None
                engine = None          # 실제 자막제거에 쓴 엔진 (웹 콘솔 기록용)
                engine_note = ""       # 폴백 사유 등
                # PROPAINTER=0은 '로컬 8GB OOM 회피'용이라 Modal(클라우드·청킹)엔 무관.
                # → modal 백엔드는 이 env를 무시하고 항상 ProPainter. local만 이 env로 끔.
                pp_env_on = os.environ.get("PROPAINTER", "1") != "0"
                use_pp = bool(segments) and (subtitle_backend == "modal" or pp_env_on)
                _dbg(f"엔진 판단: use_pp={use_pp} (segments={len(segments)}, backend={subtitle_backend}, "
                     f"PROPAINTER_env_on={pp_env_on}) → "
                     f"{'ProPainter 시도' if use_pp else 'ProPainter 건너뜀 → LaMa/고정박스'}")

                # 1순위 ProPainter(modal): 클라우드 GPU라 로컬 세마포어 없이 실행 →
                # 여러 영상이 동시에 자막제거되고, 풀이 계정을 로테이션한다.
                if use_pp and subtitle_backend == "modal":
                    try:
                        from app.pipeline.propainter_inpaint import inpaint_with_propainter
                        job.update(stage="자막 제거 (클라우드 AI 배경복원)", progress=0)
                        _dbg("ProPainter(modal) 시도 — Modal 청크 병렬 fan-out")
                        nosub = inpaint_with_propainter(
                            source, job_dir / "nosub.mp4", segments,
                            backend="modal", progress_cb=_ip_prog)
                        engine = "propainter_modal"
                        _dbg("→ ProPainter(modal) 성공")
                    except Exception as pe:
                        engine_note = str(pe)[:300]
                        _dbg(f"→ ProPainter(modal) 실패, LaMa 폴백. 사유: {engine_note}")
                        nosub = None

                # 로컬 GPU 구간(로컬 ProPainter 또는 LaMa)은 세마포어로 직렬화(8GB OOM 방지).
                if nosub is None:
                    with gpu_slot(job, wait_stage="GPU 대기 중 (자막 제거 대기열)"):
                        if use_pp and subtitle_backend == "local":
                            try:
                                from app.pipeline.propainter_inpaint import inpaint_with_propainter
                                job.update(stage="자막 제거 (AI 배경복원)", progress=0)
                                _dbg("ProPainter(local) 시도 — 로컬 GPU")
                                nosub = inpaint_with_propainter(
                                    source, job_dir / "nosub.mp4", segments,
                                    backend="local", progress_cb=_ip_prog)
                                engine = "propainter_local"
                                _dbg("→ ProPainter(local) 성공")
                            except Exception as pe:
                                engine_note = str(pe)[:300]
                                _dbg(f"→ ProPainter(local) 실패, LaMa 폴백. 사유: {engine_note}")
                                nosub = None
                        if nosub is None:
                            reason = "ProPainter 실패 폴백" if engine_note else "ProPainter 미시도(기본)"
                            _dbg(f"LaMa 실행 ({reason})")
                            nosub = inpaint_subtitles(source, job_dir / "nosub.mp4", segments,
                                                      fixed_boxes=fixed_boxes, progress_cb=_ip_prog)
                            engine = "lama_fallback" if engine_note else "lama"
                job["subtitle_engine"] = engine
                if engine_note:
                    job["subtitle_engine_note"] = engine_note
                _dbg(f"■ 최종 엔진: {engine}")
            else:
                remove_subtitle(source, job_dir / "nosub.mp4", use_ocr=False)
                job["subtitle_engine"] = "none"
                _dbg("탐지된 자막/고정박스 없음 → 자막제거 안 함(원본 유지). 엔진: none")
            # 자막제거본을 라이브러리에 보관 → 다음부터 이 단계 생략.
            try:
                library.save_nosub(url, job_nosub)
            except Exception as e:
                print(f"  [library save_nosub 실패: {str(e)[:120]}]")

        job["preview"] = f"/file/{jid}/nosub.mp4"
        job.update(status="analyzed", stage="분석 완료", progress=100)
    except Exception as e:
        job.update(status="error", stage="오류", error=str(e)[:500])


def _transcribe_worker(jid: str, reuse_script: bool = True):
    job = JOBS[jid]
    try:
        from app.pipeline.transcribe import transcribe_to_korean
        from app import library

        src = _source_for_job(jid)
        url = (job.get("meta") or {}).get("url") or ""

        # 이미 만든 대본이 있으면 재사용(STT/번역 생략).
        cached = library.get_script(url) if (reuse_script and url) else None
        if cached:
            ko = (cached.get("ko_text") or "").strip()
            job["script"] = ko
            job["has_speech"] = bool(cached.get("has_speech", len(ko) >= 4))
            job["meta"]["transcribe"] = {
                "provider": cached.get("provider"),
                "zh_text": cached.get("zh_text", ""),
                "segments": cached.get("segments", []),
            }
            job.update(status="transcribed", stage="대본 재사용", progress=100)
            return

        job.update(status="transcribing", stage="중국어 음성 인식/번역", progress=0, error=None)

        def _stt_prog(frac):
            # 대본 단계 자체 0~100 (faster-whisper 세그먼트 진행 기반)
            job.update(progress=int(frac * 100),
                       stage=f"중국어 음성 인식/번역 ({int(frac*100)}%)")

        with gpu_slot(job, wait_stage="GPU 대기 중 (대본 생성 대기열)"):  # whisper STT GPU 직렬화
            result = transcribe_to_korean(src, model_size="small", progress_cb=_stt_prog)

        # 오디오 없는 영상(무음/BGM 제거본) → 대본 없음. 크래시 대신 안내.
        if result.get("no_audio"):
            job["script"] = ""
            job["has_speech"] = False
            job["meta"]["transcribe"] = {"provider": result.get("provider"), "no_audio": True}
            job.update(status="transcribed",
                       stage="음성이 없어요 — 대본은 직접 입력하거나 제품 링크로 만드세요", progress=100)
            return

        ko = (result.get("ko_text") or "").strip()
        job["script"] = ko
        job["has_speech"] = len(ko) >= 4
        payload = {
            "ko_text": ko,
            "has_speech": len(ko) >= 4,
            "provider": result.get("provider"),
            "zh_text": result.get("zh_text", ""),
            "segments": result.get("segments", []),
        }
        job["meta"]["transcribe"] = {
            "provider": payload["provider"], "zh_text": payload["zh_text"],
            "segments": payload["segments"],
        }
        if url:  # 대본을 라이브러리에 보관 → 다음부터 STT 생략
            try:
                library.save_script(url, payload)
            except Exception as e:
                print(f"  [library save_script 실패: {str(e)[:120]}]")
        job.update(status="transcribed", stage="대본 생성 완료", progress=100)
    except Exception as e:
        job.update(status="error", stage="대본 생성 오류", error=str(e)[:500])


def _build_caption_style(style_dict: dict | None):
    """웹 CaptionStyle(dict) → caption.CaptionStyle(dataclass) 매핑."""
    from app.pipeline.caption import style_from_dict
    return style_from_dict(style_dict)


def _render_worker(jid: str, req: RenderReq):
    job = JOBS[jid]
    try:
        from app.pipeline.audio_strip import strip_audio
        from app.pipeline.compose import compose
        from app.pipeline.tts import synthesize_by_nickname

        job_dir = WORKDIR / jid
        nosub = job_dir / "nosub.mp4"
        base = nosub if nosub.exists() else _source_for_job(jid)

        # [4] 얼굴 전체샷 컷 제거(opt-in). 인물 클로즈업 구간을 빼고 제품샷 위주로 재연결.
        if req.face_cut:
            from app.pipeline.face_cut import cut_face_segments
            job.update(status="face_cut", stage="얼굴샷 컷 제거", progress=0)
            base = cut_face_segments(base, job_dir / "facecut.mp4")

        dub = None
        stamps: list = []
        if req.script.strip():
            job.update(status="dubbing", stage="TTS 더빙", progress=0, error=None)
            base = strip_audio(base, job_dir / "muted.mp4")
            dub, stamps = synthesize_by_nickname(
                req.script,
                job_dir / "dub.mp3",
                nickname=req.voice,
                speaking_rate=req.speaking_rate,
            )
            # Google TTS는 단어 타임스탬프를 안 줌([]) → 더빙 음성을 whisper로 재정렬해
            # 자막 싱크 정확도 확보(없으면 caption이 글자수 균등분할로 폴백).
            if not stamps and dub:
                from app.pipeline.align import word_timestamps
                job.update(stage="자막 싱크 정렬", progress=55)
                with gpu_slot(job, wait_stage="GPU 대기 중 (자막 정렬 대기열)"):
                    stamps = word_timestamps(dub, language="ko")

        job.update(status="composing", stage="영상 합성", progress=0)
        out = compose(
            video_path=base,
            audio_path=dub,
            out_path=job_dir / "output.mp4",
            # CTA 체크 켜졌을 때만. 사전정의 key면 맵 텍스트, 아니면 커스텀 문구 그대로.
            cta_text=(CTA_TEXT.get(req.cta, req.cta) or None) if req.cta_on else None,
            replace_audio=bool(dub),
            cta_size=req.cta_size,
            cta_pos=req.cta_pos,
        )

        # 자막 burn-in: 편집된 줄(caption_lines) 있으면 그걸로, 없으면 TTS 자동생성
        if req.captions and (req.caption_lines or req.script.strip()):
            try:
                from app.pipeline.caption import (
                    build_lines_from_tts, render_ass, burn_captions,
                    lines_from_payload,
                )
                from app.config import TARGET_W, TARGET_H, BACKEND_ROOT
                job.update(status="captioning", stage="자막 입히기", progress=0)
                style = _build_caption_style(req.caption_style)
                total = _probe_dur(dub) if dub else None
                if req.caption_lines:
                    # 타임라인 편집기서 수정한 줄(시간/내용/줄별스타일) 그대로 사용
                    lines = lines_from_payload(req.caption_lines, style)
                else:
                    lines = build_lines_from_tts(
                        stamps, style, total_dur=total, full_text=req.script,
                    )
                if lines:
                    ass = render_ass(lines, job_dir / "caption.ass", TARGET_W, TARGET_H)
                    capped = burn_captions(
                        out, ass, job_dir / "output_cap.mp4",
                        fonts_dir=BACKEND_ROOT / "assets" / "fonts",
                    )
                    out = capped
            except Exception as ce:
                print(f"  [caption burn failed, keeping no-caption output: {str(ce)[:200]}]")

        job["output"] = f"/file/{jid}/{out.name}"
        job.update(status="done", stage="완료", progress=100)
    except Exception as e:
        job.update(status="error", stage="렌더 오류", error=str(e)[:500])


def _probe_dur(path) -> float | None:
    try:
        import subprocess
        from app.config import FFPROBE
        r = subprocess.run(
            [FFPROBE, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True,
        )
        return float(r.stdout.strip())
    except Exception:
        return None


def _source_for_job(jid: str):
    job_dir = WORKDIR / jid
    source = job_dir / "source.mp4"
    if source.exists():
        return source
    candidates = list(job_dir.glob("source.*"))
    if candidates:
        return candidates[0]
    raise FileNotFoundError(f"source video not found for job {jid}")
