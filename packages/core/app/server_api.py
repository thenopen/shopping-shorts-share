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
    cta_on: bool = True              # CTA 자막 넣기/빼기(체크박스)
    cta_size: int = 56               # CTA 글자 크기(px)
    cta_pos: float = 0.88            # CTA 세로 위치(0=위~1=아래)
    captions: bool = True            # TTS 대본 자동자막 on/off
    caption_style: dict | None = None  # 웹 CaptionStyle (font/size/color/...) — 기본 스타일
    caption_lines: list | None = None  # 타임라인 편집기서 수정한 줄들(있으면 자동생성 대신 이걸 burn)


class CaptionPreviewReq(BaseModel):
    job_id: str
    script: str = ""
    voice: str = "소담"
    speaking_rate: float = 1.0
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

    try:
        sp = extract_selling_points(
            url=req.product_url or None,
            images=images or None,
            manual=req.manual_points or None,
        )
    except Exception as e:
        raise HTTPException(500, f"소구포인트 추출 실패: {str(e)[:300]}") from e

    points = sp.get("points", "")
    if not points and sp.get("error"):
        # 크롤 차단 등 — 포인트 못 뽑음. 사유 그대로 전달(웹이 폴백 안내).
        return {"selling_points": "", "script": "", "source": sp.get("source", ""),
                "site": sp.get("site", ""), "error": sp["error"]}

    script = ""
    if req.combine:
        script = product_script(req.video_content, points)
    return {"selling_points": points, "script": script,
            "source": sp.get("source", ""), "site": sp.get("site", ""), "error": ""}


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
        # 화면 전체 OCR로 자막+워터마크 글자 모두 탐지(언어 무관, 하단제한 해제).
        # require_center=True: 가로로 긴 중앙정렬 자막 형태만 → 상품 패키지/배경 글자 과제거 방지.
        # interval 0.25s: 짧게 뜨는 자막·라벨도 놓치지 않게.
        try:
            segments = detect_segments(source, interval_sec=0.25, full_frame=True,
                                       require_center=True, pad=14)
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
            nosub = None
            engine = None          # 실제 자막제거에 쓴 엔진 (웹 콘솔 기록용)
            engine_note = ""       # 폴백 사유 등
            # 1순위: ProPainter(시간축 복원, 자연스러움). OCR 박스가 있을 때만 시도.
            # OVERLAY_FIXED_UI/PROPAINTER=0 로 끔. 실패(OOM·가중치·CLI오류)면 LaMa 폴백.
            if segments and os.environ.get("PROPAINTER", "1") != "0":
                try:
                    from app.pipeline.propainter_inpaint import inpaint_with_propainter
                    job.update(stage="자막 제거 (AI 배경복원)", progress=45)
                    nosub = inpaint_with_propainter(
                        source, job_dir / "nosub.mp4", segments, progress_cb=_ip_prog)
                    engine = "propainter"
                    print("  [ProPainter 자막제거 성공]")
                except Exception as pe:
                    engine_note = str(pe)[:200]
                    print(f"  [ProPainter 실패, LaMa 폴백: {engine_note}]")
                    nosub = None
            if nosub is None:
                nosub = inpaint_subtitles(source, job_dir / "nosub.mp4", segments,
                                          fixed_boxes=fixed_boxes, progress_cb=_ip_prog)
                engine = "lama_fallback" if engine_note else "lama"
            job["subtitle_engine"] = engine
            if engine_note:
                job["subtitle_engine_note"] = engine_note
        else:
            nosub = remove_subtitle(source, job_dir / "nosub.mp4", use_ocr=False)
            job["subtitle_engine"] = "none"

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
