"""SaaS 백엔드 — FastAPI. 웹앱이 호출. core 엔진을 직접 사용.

엔드포인트:
  POST /analyze         링크 → 다운로드+자막제거+(말있으면)대본 자동생성. job_id 반환
  GET  /jobs/{id}       작업 진행상황/결과 조회
  POST /render          대본+설정 → TTS더빙+자막+합성. 최종 쇼츠
  GET  /file/{id}/{f}   영상 파일 서빙(미리보기/결과)

core 안(core/app/server_api.py)에 두어 app.* 를 그대로 import.
실행: cd packages/core && .venv/Scripts/uvicorn app.server_api:app --port 8000
"""
import uuid
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import WORKDIR              # noqa: E402 (core/app/config.py)
from app.url_extract import extract_url     # noqa: E402

app = FastAPI(title="쇼핑쇼츠 메이커 API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # 개발용. 배포시 도메인 제한.
    allow_methods=["*"],
    allow_headers=["*"],
)

# 작업 상태 (메모리. 추후 SQLite/Redis)
JOBS: dict = {}


def _new_job() -> str:
    jid = uuid.uuid4().hex[:8]
    JOBS[jid] = {"id": jid, "status": "queued", "progress": 0,
                 "stage": "", "script": "", "preview": None,
                 "output": None, "error": None, "has_speech": None}
    return jid


# ---------- 분석 (다운로드 + 자막제거 + 대본생성) ----------
class AnalyzeReq(BaseModel):
    url: str   # 공유텍스트 통째로도 OK


def _analyze_worker(jid: str, raw_url: str):
    j = JOBS[jid]
    try:
        from app.pipeline.download import download_video
        from app.pipeline.douyin_download import download_douyin
        from app.pipeline.audio_strip import strip_audio  # noqa

        url = extract_url(raw_url) or raw_url
        job_dir = WORKDIR / jid
        job_dir.mkdir(parents=True, exist_ok=True)

        j.update(status="downloading", stage="영상 다운로드", progress=10)
        if "douyin" in url:
            src = download_douyin(url, jid)
        else:
            src = download_video(url, jid)

        # 자막 제거 (구간별)
        j.update(status="removing_subtitle", stage="중국어 자막 제거", progress=40)
        from app.pipeline.subtitle_detect import detect_segments
        from app.pipeline.subtitle_remove import remove_subtitle_segments
        segs = detect_segments(str(src), interval_sec=0.5, bottom_ratio=0.3)
        nosub = remove_subtitle_segments(src, job_dir / "nosub.mp4", segs)

        # 미리보기용 = 자막제거 영상 (웹에서 9:16로 보여줄 수 있게 web-friendly 인코딩)
        j["preview"] = f"/file/{jid}/nosub.mp4"

        # 말(음성) 유무 판정 → 있으면 STT 번역대본
        j.update(status="transcribing", stage="음성 분석/대본", progress=70)
        script, has_speech = _auto_script(src)
        j["script"] = script
        j["has_speech"] = has_speech

        j.update(status="analyzed", stage="분석 완료", progress=100)
    except Exception as e:
        j.update(status="error", error=str(e)[:300])


def _auto_script(src: Path) -> tuple[str, bool]:
    """말 있으면 STT→번역 대본, 없으면 빈 문자열.

    간이 판정: STT 돌려서 텍스트 나오면 말 있음.
    """
    try:
        from app.pipeline.transcribe import transcribe_to_korean
        r = transcribe_to_korean(src, model_size="small")
        ko = (r.get("ko_text") or "").strip()
        if len(ko) >= 4:
            return ko, True
        return "", False
    except Exception:
        return "", False


@app.post("/analyze")
def analyze(req: AnalyzeReq):
    jid = _new_job()
    threading.Thread(target=_analyze_worker, args=(jid, req.url), daemon=True).start()
    return {"job_id": jid}


# ---------- 렌더 (대본+설정 → 최종 쇼츠) ----------
class RenderReq(BaseModel):
    job_id: str
    script: str = ""
    voice: str = "소담"
    speaking_rate: float = 1.0
    cta: str = "profile"


def _render_worker(jid: str, req: RenderReq):
    j = JOBS[jid]
    try:
        from app.pipeline.tts import synthesize_by_nickname
        from app.pipeline.compose import compose
        from app.pipeline.audio_strip import strip_audio

        job_dir = WORKDIR / jid
        nosub = job_dir / "nosub.mp4"
        base = nosub if nosub.exists() else (job_dir / "source.mp4")

        dub = None
        if req.script.strip():
            j.update(status="dubbing", stage="TTS 더빙", progress=40)
            base = strip_audio(base, job_dir / "muted.mp4")
            dub, _ = synthesize_by_nickname(req.script, job_dir / "dub.mp3",
                                            nickname=req.voice,
                                            speaking_rate=req.speaking_rate)
        j.update(status="composing", stage="영상 합성", progress=75)
        cta_text = {"comment": "제품 정보는 고정 댓글을 확인해주세요!",
                    "profile": "구매처는 프로필 링크에 있어요!",
                    "link": "자세한 내용은 하단 링크를 클릭하세요!"}.get(req.cta)
        out = compose(base, dub, job_dir / "output.mp4",
                      cta_text=cta_text, replace_audio=bool(dub))
        j["output"] = f"/file/{jid}/output.mp4"
        j.update(status="done", stage="완료", progress=100)
    except Exception as e:
        j.update(status="error", error=str(e)[:300])


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
    return {"ok": True, "service": "쇼핑쇼츠 메이커 API"}
