"""[1] 영상 다운로드 — yt-dlp 래퍼."""
from pathlib import Path
import yt_dlp

from app.config import WORKDIR


def download_video(url: str, job_id: str) -> Path:
    """URL → mp4 파일. 반환: 다운로드된 파일 경로."""
    out_dir = WORKDIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_tmpl = str(out_dir / "source.%(ext)s")

    opts = {
        "format": "mp4/bestvideo+bestaudio/best",
        "outtmpl": out_tmpl,
        "merge_output_format": "mp4",
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        # 실제 저장된 파일 경로 확인
        downloaded = ydl.prepare_filename(info)
        path = Path(downloaded)
        if path.suffix != ".mp4":
            path = path.with_suffix(".mp4")
    if not path.exists():
        # merge 후 확장자 차이 대비
        cand = list(out_dir.glob("source.*"))
        if cand:
            path = cand[0]
    return path
