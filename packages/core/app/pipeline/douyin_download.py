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


def download_douyin(share_text: str, job_id: str, timeout_ms: int = 30000) -> Path:
    """공유텍스트/URL → 도우인 영상 mp4 다운로드. 반환: 저장경로."""
    from playwright.sync_api import sync_playwright

    url = extract_url(share_text) or share_text
    out_dir = WORKDIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "source.mp4"

    captured = {"url": None}

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
            if captured["url"]:
                return
            if "video/mp4" in ct or (VIDEO_URL_RE.search(u) and "image" not in ct):
                # 큰 미디어만 (썸네일/조각 제외 위해 길이 체크 가능)
                captured["url"] = u

        page.on("response", on_response)

        try:
            page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            # 영상 로드 트리거: play 시도 + 잠깐 대기
            page.wait_for_timeout(5000)
            # <video src> 직접 시도
            if not captured["url"]:
                src = page.evaluate(
                    "() => { const v=document.querySelector('video'); "
                    "return v ? (v.src || (v.querySelector('source')||{}).src) : null; }"
                )
                if src:
                    captured["url"] = src
            # 더 기다려보기
            if not captured["url"]:
                page.wait_for_timeout(5000)
        except Exception as e:
            print(f"[douyin_dl] page error: {str(e)[:120]}")

        vurl = captured["url"]
        if not vurl:
            browser.close()
            raise RuntimeError("영상 URL 캐치 실패 — 로그인/페이지 구조 확인 필요")

        # 같은 컨텍스트(쿠키 유지)로 영상 바이트 받기
        print(f"[douyin_dl] video url 캐치: {vurl[:90]}...")
        api = context.request
        r = api.get(vurl)
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
