"""[1-대체] 도우인 직접 다운로드 (Playwright).

yt-dlp가 도우인을 못 뚫음(쿠키 있어도 msToken 요구 → Fresh cookies needed).
대신 우리가 진짜 브라우저(Playwright)로 영상페이지를 열어서
네트워크 트래픽 중 실제 영상파일(.mp4) URL을 가로채 직접 받는다.
저장된 로그인 쿠키(douyin_state.json)를 쓰면 차단 회피.

흐름:
  1. Playwright 컨텍스트(로그인 쿠키 로드)로 영상페이지 goto
  2. 네트워크 응답 감시 → video/mp4 또는 playwright_url 패턴 캐치
  3. 그 URL을 같은 컨텍스트로 받아 저장 (쿠키/헤더 동일해야 통과)
"""
import re
from pathlib import Path

from app.config import WORKDIR
from app.url_extract import extract_url
from app.douyin_auth import STATE_PATH

# 도우인 영상 CDN 호스트 패턴
VIDEO_URL_RE = re.compile(r"(douyinvod\.com|aweme\.snssdk|\.mp4|/video/tos/)", re.I)


def _has_video_track(data: bytes) -> bool:
    """바이트 앞부분으로 video 트랙 유무 확인 (임시파일 ffprobe)."""
    import subprocess, tempfile, os
    from app.config import FFPROBE
    tf = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    try:
        tf.write(data)
        tf.close()
        out = subprocess.run(
            [FFPROBE, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=codec_type", "-of", "csv=p=0", tf.name],
            capture_output=True, text=True)
        return "video" in out.stdout
    finally:
        os.unlink(tf.name)


def _pick_best_video(api, candidates):
    """후보 중 video 트랙 있는 가장 큰 mp4의 URL 반환."""
    # 중복 제거 + 큰 것 우선
    seen, uniq = set(), []
    for u, ct, clen in candidates:
        if u in seen:
            continue
        seen.add(u)
        uniq.append((u, ct, clen))
    uniq.sort(key=lambda x: x[2], reverse=True)

    for u, ct, clen in uniq:
        try:
            r = api.get(u)
            if not r.ok:
                continue
            body = r.body()
            if _has_video_track(body):
                return u
        except Exception:
            continue
    return None


def download_douyin(share_text: str, job_id: str, timeout_ms: int = 30000) -> Path:
    """공유텍스트/URL → 도우인 영상 mp4 다운로드. 반환: 저장경로."""
    from playwright.sync_api import sync_playwright

    url = extract_url(share_text) or share_text
    out_dir = WORKDIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "source.mp4"

    # 미디어 후보 수집 (오디오/조각 섞임 → 나중에 video만 선별)
    candidates = []  # (url, content_type, content_length)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx_args = {}
        if STATE_PATH.exists():
            ctx_args["storage_state"] = str(STATE_PATH)
        context = browser.new_context(**ctx_args)
        page = context.new_page()

        def on_response(resp):
            u = resp.url
            ct = resp.headers.get("content-type", "")
            if "video/mp4" in ct or (VIDEO_URL_RE.search(u) and "image" not in ct):
                try:
                    clen = int(resp.headers.get("content-length", "0"))
                except Exception:
                    clen = 0
                candidates.append((u, ct, clen))

        page.on("response", on_response)

        try:
            page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            page.wait_for_timeout(6000)
            # <video src> 도 후보에 추가 (보통 영상 본체)
            src = page.evaluate(
                "() => { const v=document.querySelector('video'); "
                "return v ? (v.src || (v.querySelector('source')||{}).src) : null; }"
            )
            if src:
                candidates.append((src, "video/mp4", 0))
            page.wait_for_timeout(3000)
        except Exception as e:
            print(f"[douyin_dl] page error: {str(e)[:120]}")

        if not candidates:
            browser.close()
            raise RuntimeError("미디어 URL 캐치 실패 — 로그인/페이지 구조 확인 필요")

        # 후보 중 실제 video 트랙이 있는 가장 큰 mp4 선택
        api = context.request
        best = _pick_best_video(api, candidates)
        if not best:
            browser.close()
            raise RuntimeError("video 트랙 있는 미디어를 못 찾음 (오디오만 잡힘)")

        print(f"[douyin_dl] video url: {best[:90]}...")
        r = api.get(best)
        if not r.ok:
            browser.close()
            raise RuntimeError(f"영상 다운로드 실패: HTTP {r.status}")
        out_path.write_bytes(r.body())
        browser.close()

    print(f"[douyin_dl] 저장: {out_path} ({out_path.stat().st_size} bytes)")
    return out_path


if __name__ == "__main__":
    import sys, uuid
    txt = sys.argv[1] if len(sys.argv) > 1 else "https://v.douyin.com/yNTN8V35B9g/"
    download_douyin(txt, uuid.uuid4().hex[:8])
