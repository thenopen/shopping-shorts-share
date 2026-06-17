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


def _probe_tracks(data: bytes) -> str:
    """바이트를 ffprobe(json)로 검사해 트랙 요약 문자열 반환.
    예: 'video:h264 + audio:aac' / 'audio:aac (영상無)' / '스트림없음/파싱불가'.

    주의: ffprobe의 `-of csv`는 필드를 요청순이 아니라 내부순서(codec_name,codec_type)로
    출력해 위치 파싱이 깨진다. 순서에 무관한 json으로 파싱한다.
    """
    import subprocess, tempfile, os, json
    from app.config import FFPROBE
    tf = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    try:
        tf.write(data)
        tf.close()
        out = subprocess.run(
            [FFPROBE, "-v", "error", "-show_entries", "stream=codec_type,codec_name",
             "-of", "json", tf.name],
            capture_output=True, text=True)
        try:
            streams = (json.loads(out.stdout or "{}") or {}).get("streams", [])
        except Exception:
            streams = []
        if not streams:
            return "스트림없음/파싱불가"
        vids = [s.get("codec_name", "?") for s in streams if s.get("codec_type") == "video"]
        auds = [s.get("codec_name", "?") for s in streams if s.get("codec_type") == "audio"]
        parts = []
        if vids:
            parts.append("video:" + "/".join(vids))
        if auds:
            parts.append("audio:" + "/".join(auds))
        summary = " + ".join(parts) if parts else "스트림없음/파싱불가"
        return summary if vids else summary + " (영상無)"
    finally:
        os.unlink(tf.name)


def _pick_best_video(api, candidates, diag=None):
    """후보 중 video 트랙 있는 가장 큰 mp4의 URL 반환.
    diag(list)가 주어지면 후보별 검사결과를 사람이 읽을 수 있게 append(웹 콘솔 진단용)."""
    # 중복 제거 + 큰 것 우선
    seen, uniq = set(), []
    for u, ct, clen in candidates:
        if u in seen:
            continue
        seen.add(u)
        uniq.append((u, ct, clen))
    uniq.sort(key=lambda x: x[2], reverse=True)

    for u, ct, clen in uniq:
        short = (u[:70] + "…") if len(u) > 70 else u
        if u.startswith("blob:"):
            if diag is not None:
                diag.append(f"[blob] MSE blob URL — 직접 다운로드 불가 · ct={ct} · {short}")
            continue
        try:
            r = api.get(u)
            if not r.ok:
                if diag is not None:
                    diag.append(f"[HTTP {r.status}] ct={ct} len={clen} · {short}")
                continue
            body = r.body()
            tracks = _probe_tracks(body)
            has_v = "video:" in tracks
            has_a = "audio:" in tracks
            tag = "VIDEO✓" if has_v else ("audio" if has_a else "트랙없음(fMP4조각?)")
            if diag is not None:
                diag.append(f"[{tag}] {tracks} · ct={ct} bytes={len(body)} · {short}")
            if has_v:
                return u  # 큰 것부터 순회 → 첫 video 후보가 최선
        except Exception as e:
            if diag is not None:
                diag.append(f"[예외] {str(e)[:60]} · {short}")
            continue
    return None


def download_douyin(share_text: str, job_id: str, timeout_ms: int = 30000,
                    diag: list | None = None) -> Path:
    """공유텍스트/URL → 도우인 영상 mp4 다운로드. 반환: 저장경로.

    diag(list)가 주어지면 캡처된 미디어 후보/트랙 진단을 append한다(웹 F12 콘솔용).
    실패해도 이미 append된 항목은 호출측 job에 남아 콘솔에 표시됨.
    """
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

        src = None
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
            if diag is not None:
                diag.append(f"[페이지 오류] {str(e)[:120]}")

        if diag is not None:
            src_kind = "없음"
            if src:
                src_kind = "blob(MSE)" if str(src).startswith("blob:") else "http"
            diag.append(f"캡처 후보 {len(candidates)}개 · <video>src={src_kind}")

        if not candidates:
            browser.close()
            raise RuntimeError("미디어 URL 캐치 실패 — 로그인/페이지 구조 확인 필요")

        # 후보 중 실제 video 트랙이 있는 가장 큰 mp4 선택
        api = context.request
        best = _pick_best_video(api, candidates, diag=diag)
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
