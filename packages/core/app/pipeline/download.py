"""[1] 영상 다운로드 — yt-dlp 래퍼.

도우인(Douyin)은 봇 차단이 있어 쿠키가 필요할 수 있다.
쿠키 옵션 우선순위:
  1. cookiefile 직접 지정 (Netscape 형식 cookies.txt)
  2. cookies_from_browser=("chrome"|"edge"|"firefox") — 브라우저 로그인쿠키 추출
     ※ Chrome/Edge는 실행중이면 DB 잠김(이슈 7271). Firefox나 브라우저 종료 필요.
유튜브 등 일반 영상은 쿠키 없이 됨.
"""
from pathlib import Path
import yt_dlp

from app.config import WORKDIR


def _with_cookies(opts: dict, cookiefile: str | None,
                  cookies_from_browser: str | None) -> dict:
    """yt-dlp opts에 쿠키 옵션 추가(cookiefile 우선, 없으면 브라우저 쿠키)."""
    if cookiefile:
        opts["cookiefile"] = cookiefile
    elif cookies_from_browser:
        opts["cookiesfrombrowser"] = (cookies_from_browser,)
    return opts


def download_video(
    url: str,
    job_id: str,
    cookiefile: str | None = None,
    cookies_from_browser: str | None = None,
) -> Path:
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
    _with_cookies(opts, cookiefile, cookies_from_browser)

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        downloaded = ydl.prepare_filename(info)
        path = Path(downloaded)
        if path.suffix != ".mp4":
            path = path.with_suffix(".mp4")
    if not path.exists():
        cand = list(out_dir.glob("source.*"))
        if cand:
            path = cand[0]
    return path


def probe_info(url: str, cookiefile: str | None = None,
               cookies_from_browser: str | None = None) -> dict:
    """다운로드 없이 메타데이터만 (해상도/길이/제목). 분석용."""
    opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    _with_cookies(opts, cookiefile, cookies_from_browser)
    with yt_dlp.YoutubeDL(opts) as ydl:
        i = ydl.extract_info(url, download=False)
    return {
        "title": i.get("title"),
        "duration": i.get("duration"),
        "width": i.get("width"),
        "height": i.get("height"),
        "ext": i.get("ext"),
    }


def probe_preview(url: str, cookiefile: str | None = None,
                  cookies_from_browser: str | None = None) -> dict:
    """확인(미리보기)용 — 제목 + 썸네일 URL(원격) + 길이/해상도. 다운로드 안 함."""
    opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    _with_cookies(opts, cookiefile, cookies_from_browser)
    with yt_dlp.YoutubeDL(opts) as ydl:
        # process=False: 포맷 해상(다운로드 준비) 생략 → 구버전 yt-dlp의 포맷추출 실패와
        # 무관하게 제목/썸네일/길이 메타만 안정적으로 가져옴(미리보기 전용).
        i = ydl.extract_info(url, download=False, process=False)
    thumb = i.get("thumbnail")
    if not thumb:
        thumbs = i.get("thumbnails") or []
        thumb = thumbs[-1].get("url") if thumbs else None
    return {
        "title": i.get("title"),
        "duration": i.get("duration"),
        "width": i.get("width"),
        "height": i.get("height"),
        "thumbnail": thumb,
        "uploader": i.get("uploader"),
        "extractor": i.get("extractor_key") or i.get("extractor"),
    }
