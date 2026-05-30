"""FastAPI backend for the shopping shorts maker."""

from __future__ import annotations

import threading
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import WORKDIR
from app.url_extract import extract_url

app = FastAPI(title="쇼핏 쇼츠 메이커 API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

JOBS: dict[str, dict] = {}

CTA_TEXT = {
    "comment": "제품 정보는 고정 댓글에서 확인하세요!",
    "profile": "구매처는 프로필 링크에 있어요.",
    "link": "자세한 내용은 하단 링크를 눌러주세요.",
}


def _new_job() -> str:
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
        "meta": {},
    }
    return jid


class AnalyzeReq(BaseModel):
    url: str


class TranscribeReq(BaseModel):
    job_id: str


class RefineReq(BaseModel):
    script: str


class AgentRefineReq(BaseModel):
    script: str
    mode: str = "shopping_shorts"


class RenderReq(BaseModel):
    job_id: str
    script: str = ""
    voice: str = "소담"
    speaking_rate: float = 1.0
    cta: str = "profile"


@app.post("/analyze")
def analyze(req: AnalyzeReq):
    jid = _new_job()
    threading.Thread(target=_analyze_worker, args=(jid, req.url), daemon=True).start()
    return {"job_id": jid}


@app.post("/transcribe")
def transcribe(req: TranscribeReq):
    if req.job_id not in JOBS:
        raise HTTPException(404, "job not found")
    threading.Thread(target=_transcribe_worker, args=(req.job_id,), daemon=True).start()
    return {"job_id": req.job_id}


@app.post("/refine")
def refine(req: RefineReq):
    from app.pipeline.refine import available, refine_script

    if not available():
        raise HTTPException(400, "Gemini key not found. Add auth/gemini_key.txt or GEMINI_API_KEY.")
    return {"script": refine_script(req.script)}


@app.post("/agent/refine")
def agent_refine(req: AgentRefineReq):
    from app.pipeline.refine import available, antigravity_refine

    if not available():
        raise HTTPException(400, "Gemini key not found. Add auth/gemini_key.txt or GEMINI_API_KEY.")
    try:
        return antigravity_refine(req.script, mode=req.mode)
    except RuntimeError as e:
        raise HTTPException(502, str(e)) from e


@app.post("/render")
def render(req: RenderReq):
    if req.job_id not in JOBS:
        raise HTTPException(404, "job not found")
    threading.Thread(target=_render_worker, args=(req.job_id, req), daemon=True).start()
    return {"job_id": req.job_id}


@app.get("/jobs/{jid}")
def get_job(jid: str):
    if jid not in JOBS:
        raise HTTPException(404, "job not found")
    return JOBS[jid]


@app.get("/file/{jid}/{name}")
def get_file(jid: str, name: str):
    f = WORKDIR / jid / name
    if not f.exists():
        raise HTTPException(404, "file not found")
    return FileResponse(str(f))


@app.get("/")
def root():
    return {"ok": True, "service": "쇼핏 쇼츠 메이커 API"}


def _analyze_worker(jid: str, raw_url: str):
    job = JOBS[jid]
    try:
        from app.pipeline.download import download_video
        from app.pipeline.douyin_download import download_douyin
        from app.pipeline.subtitle_detect import detect_segments
        from app.pipeline.subtitle_remove import remove_subtitle
        from app.pipeline.subtitle_inpaint import inpaint_subtitles

        url = extract_url(raw_url) or raw_url
        job_dir = WORKDIR / jid
        job_dir.mkdir(parents=True, exist_ok=True)

        job.update(status="downloading", stage="영상 다운로드", progress=10, error=None)
        if "douyin" in url:
            source = download_douyin(url, jid)
        else:
            source = download_video(url, jid)
        job["meta"]["source"] = str(source)

        job.update(status="removing_subtitle", stage="중국어 자막 제거", progress=40)
        try:
            segments = detect_segments(source, interval_sec=0.5, bottom_ratio=0.4)
        except Exception as e:
            print(f"  [subtitle segment detection failed: {str(e)[:120]}]")
            segments = []

        if segments:
            nosub = inpaint_subtitles(source, job_dir / "nosub.mp4", segments)
        else:
            nosub = remove_subtitle(source, job_dir / "nosub.mp4", use_ocr=False)

        job["preview"] = f"/file/{jid}/nosub.mp4"
        job.update(status="analyzed", stage="분석 완료", progress=100)
    except Exception as e:
        job.update(status="error", stage="오류", error=str(e)[:500])


def _transcribe_worker(jid: str):
    job = JOBS[jid]
    try:
        from app.pipeline.transcribe import transcribe_to_korean

        src = _source_for_job(jid)
        job.update(status="transcribing", stage="중국어 음성 인식/번역", progress=30, error=None)
        result = transcribe_to_korean(src, model_size="small")
        ko = (result.get("ko_text") or "").strip()
        job["script"] = ko
        job["has_speech"] = len(ko) >= 4
        job["meta"]["transcribe"] = {
            "provider": result.get("provider"),
            "zh_text": result.get("zh_text", ""),
            "segments": result.get("segments", []),
        }
        job.update(status="transcribed", stage="대본 생성 완료", progress=100)
    except Exception as e:
        job.update(status="error", stage="대본 생성 오류", error=str(e)[:500])


def _render_worker(jid: str, req: RenderReq):
    job = JOBS[jid]
    try:
        from app.pipeline.audio_strip import strip_audio
        from app.pipeline.compose import compose
        from app.pipeline.tts import synthesize_by_nickname

        job_dir = WORKDIR / jid
        nosub = job_dir / "nosub.mp4"
        base = nosub if nosub.exists() else _source_for_job(jid)

        dub = None
        if req.script.strip():
            job.update(status="dubbing", stage="TTS 더빙", progress=40, error=None)
            base = strip_audio(base, job_dir / "muted.mp4")
            dub, _ = synthesize_by_nickname(
                req.script,
                job_dir / "dub.mp3",
                nickname=req.voice,
                speaking_rate=req.speaking_rate,
            )

        job.update(status="composing", stage="영상 합성", progress=75)
        out = compose(
            video_path=base,
            audio_path=dub,
            out_path=job_dir / "output.mp4",
            cta_text=CTA_TEXT.get(req.cta),
            replace_audio=bool(dub),
        )
        job["output"] = f"/file/{jid}/{out.name}"
        job.update(status="done", stage="완료", progress=100)
    except Exception as e:
        job.update(status="error", stage="렌더 오류", error=str(e)[:500])


def _source_for_job(jid: str):
    job_dir = WORKDIR / jid
    source = job_dir / "source.mp4"
    if source.exists():
        return source
    candidates = list(job_dir.glob("source.*"))
    if candidates:
        return candidates[0]
    raise FileNotFoundError(f"source video not found for job {jid}")
