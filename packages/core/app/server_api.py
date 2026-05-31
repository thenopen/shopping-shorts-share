"""FastAPI backend for the shopping shorts maker."""

from __future__ import annotations

import os
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
    captions: bool = True            # TTS 대본 자동자막 on/off
    caption_style: dict | None = None  # 웹 CaptionStyle (font/size/color/...) — 기본 스타일
    caption_lines: list | None = None  # 타임라인 편집기서 수정한 줄들(있으면 자동생성 대신 이걸 burn)


class CaptionPreviewReq(BaseModel):
    job_id: str
    script: str = ""
    voice: str = "소담"
    speaking_rate: float = 1.0
    caption_style: dict | None = None


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


@app.post("/captions/preview")
def captions_preview(req: CaptionPreviewReq):
    """대본 → TTS 돌려 자동자막 줄(타임코드)을 만들어 반환(편집용, 영상렌더 안 함).

    웹 타임라인 편집기가 이 줄들을 받아 start/end·텍스트·줄별 스타일을 수정한 뒤
    /render 의 caption_lines 로 다시 보낸다. dub.mp3는 캐시로 남겨 렌더때 재사용.
    """
    if req.job_id not in JOBS:
        raise HTTPException(404, "job not found")
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
        style = style_from_dict(req.caption_style)
        total = _probe_dur(_dub)
        lines = build_lines_from_tts(stamps, style, total_dur=total, full_text=req.script)
        return {"lines": lines_to_payload(lines, style), "duration": total}
    except Exception as e:
        raise HTTPException(500, f"caption preview failed: {str(e)[:300]}") from e


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
        from app.pipeline.overlay_mask import fixed_overlay_boxes
        import cv2 as _cv2

        url = extract_url(raw_url) or raw_url
        job_dir = WORKDIR / jid
        job_dir.mkdir(parents=True, exist_ok=True)

        job.update(status="downloading", stage="영상 다운로드", progress=10, error=None)
        if "douyin" in url:
            source = download_douyin(url, jid)
        else:
            source = download_video(url, jid)
        job["meta"]["source"] = str(source)

        job.update(status="removing_subtitle", stage="자막·워터마크 제거", progress=40)
        # 화면 전체 OCR로 자막+워터마크 글자 모두 탐지(하단제한 해제)
        try:
            segments = detect_segments(source, interval_sec=0.5, full_frame=True)
        except Exception as e:
            print(f"  [subtitle segment detection failed: {str(e)[:120]}]")
            segments = []

        # 도우인/틱톡 고정 UI영역(우측 버튼열·좌하단 아이디·상단 탭) 항상 inpaint.
        # OVERLAY_FIXED_UI=0 환경변수로 끔(클린 추출본에서 본체 손상 방지용).
        platform = "douyin" if "douyin" in url else ("tiktok" if "tiktok" in url else "")
        ui_enabled = platform != "" and os.environ.get("OVERLAY_FIXED_UI", "1") != "0"
        fixed_boxes = []
        if ui_enabled:
            cap = _cv2.VideoCapture(str(source))
            w = int(cap.get(_cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(_cv2.CAP_PROP_FRAME_HEIGHT))
            cap.release()
            fixed_boxes = fixed_overlay_boxes(w, h, platform=platform, enabled=True)

        if segments or fixed_boxes:
            def _ip_prog(frac):
                # inpaint 40~90% 구간 매핑
                job.update(progress=40 + int(frac * 50),
                           stage=f"자막·워터마크 제거 ({int(frac*100)}%)")
            nosub = inpaint_subtitles(source, job_dir / "nosub.mp4", segments,
                                      fixed_boxes=fixed_boxes, progress_cb=_ip_prog)
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

        dub = None
        stamps: list = []
        if req.script.strip():
            job.update(status="dubbing", stage="TTS 더빙", progress=40, error=None)
            base = strip_audio(base, job_dir / "muted.mp4")
            dub, stamps = synthesize_by_nickname(
                req.script,
                job_dir / "dub.mp3",
                nickname=req.voice,
                speaking_rate=req.speaking_rate,
            )

        job.update(status="composing", stage="영상 합성", progress=70)
        out = compose(
            video_path=base,
            audio_path=dub,
            out_path=job_dir / "output.mp4",
            cta_text=CTA_TEXT.get(req.cta),
            replace_audio=bool(dub),
        )

        # 자막 burn-in: 편집된 줄(caption_lines) 있으면 그걸로, 없으면 TTS 자동생성
        if req.captions and (req.caption_lines or req.script.strip()):
            try:
                from app.pipeline.caption import (
                    build_lines_from_tts, render_ass, burn_captions,
                    lines_from_payload,
                )
                from app.config import TARGET_W, TARGET_H, BACKEND_ROOT
                job.update(status="captioning", stage="자막 입히기", progress=88)
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
