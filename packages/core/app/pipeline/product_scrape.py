"""제품 상세페이지 → 소구포인트(셀링포인트) 추출.

입력 3가지 폴백 경로:
  1. URL    : Playwright로 상세페이지 열어 텍스트+상세영역 스크린샷 → Gemini
              - 스마트스토어/올리브영: stealth 헤드리스로 접근 가능
              - 쿠팡: Akamai 봇차단 → 전용 크롬 프로필(1회 수동로그인)로만 가능
  2. 이미지 : 사용자가 올린 상세페이지 캡처(파일/클립보드) → Gemini 비전
  3. 수동   : 사용자가 직접 적은 소구포인트 텍스트 그대로 사용

크롤 실패/차단 시 위→아래로 자연 폴백. 어떤 경우든 selling points dict 반환.
"""
from __future__ import annotations

import base64
from pathlib import Path

from app.config import BACKEND_ROOT

GEMINI_KEY_PATH = BACKEND_ROOT / "auth" / "gemini_key.txt"
# 쿠팡 전용 크롬 프로필(메인 크롬과 격리). 최초 1회 수동 로그인 필요.
COUPANG_PROFILE = BACKEND_ROOT / "auth" / "coupang_profile"
VISION_MODEL = "gemini-2.5-flash"

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")


def _api_key() -> str | None:
    import os
    if os.environ.get("GEMINI_API_KEY"):
        return os.environ["GEMINI_API_KEY"].strip()
    if GEMINI_KEY_PATH.exists():
        return GEMINI_KEY_PATH.read_text(encoding="utf-8").strip()
    return None


def detect_site(url: str) -> str:
    u = (url or "").lower()
    if "coupang.com" in u:
        return "coupang"
    if "oliveyoung.co.kr" in u:
        return "oliveyoung"
    if "naver.com" in u:  # smartstore.naver.com / brand.naver.com
        return "smartstore"
    return "generic"


# ── 1. URL 크롤 ────────────────────────────────────────────────

def scrape_url(url: str, shot_path: Path | None = None) -> dict:
    """상세페이지 열어 {text, image_bytes, site, ok, error} 반환.

    쿠팡은 전용 프로필(COUPANG_PROFILE)이 있을 때만 시도. 없거나 차단되면
    ok=False로 돌려보내 상위에서 이미지/수동 폴백을 타게 한다.
    """
    from playwright.sync_api import sync_playwright
    from playwright_stealth import Stealth

    site = detect_site(url)
    use_profile = site == "coupang"
    result = {"text": "", "image_bytes": None, "site": site, "ok": False, "error": ""}

    try:
        with Stealth().use_sync(sync_playwright()) as p:
            if use_profile:
                if not COUPANG_PROFILE.exists():
                    result["error"] = (
                        "쿠팡은 봇 차단(Akamai)되어 전용 크롬 프로필이 필요합니다. "
                        "setup_coupang_login()으로 1회 로그인하거나, 상세페이지 캡처 이미지를 올려주세요."
                    )
                    return result
                ctx = p.chromium.launch_persistent_context(
                    user_data_dir=str(COUPANG_PROFILE), headless=True,
                    locale="ko-KR", viewport={"width": 1080, "height": 1400},
                    user_agent=_UA,
                )
                pg = ctx.new_page()
            else:
                b = p.chromium.launch(headless=True,
                                      args=["--disable-blink-features=AutomationControlled"])
                ctx = b.new_context(locale="ko-KR", viewport={"width": 1080, "height": 1400},
                                    user_agent=_UA,
                                    extra_http_headers={"Accept-Language": "ko-KR,ko;q=0.9"})
                pg = ctx.new_page()

            pg.goto(url, wait_until="domcontentloaded", timeout=35000)
            pg.wait_for_timeout(3000)
            body = pg.inner_text("body")
            if "Access Denied" in body or "권한이 없" in body or len(body) < 200:
                result["error"] = f"{site} 페이지 접근 차단 또는 빈 페이지(len={len(body)})"
                ctx.close()
                return result

            result["text"] = _trim_text(body)
            # 상세영역 스크린샷(이미지 상세 커버) — 전체 페이지
            sp = shot_path or (BACKEND_ROOT / "workdir" / f"_prodshot_{site}.png")
            pg.screenshot(path=str(sp), full_page=True)
            result["image_bytes"] = Path(sp).read_bytes()
            result["ok"] = True
            ctx.close()
    except Exception as e:
        result["error"] = f"크롤 실패: {str(e)[:200]}"
    return result


def _trim_text(body: str, limit: int = 6000) -> str:
    """네비/푸터 잡음 줄이고 본문 위주로 자른다."""
    lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
    text = "\n".join(lines)
    return text[:limit]


# ── 2. Gemini 소구포인트 추출 ──────────────────────────────────

_POINT_PROMPT = (
    "이 제품 상세페이지에서 (1)제품 카테고리 (2)핵심 소구포인트(셀링포인트) 3~6개를 "
    "한국어로 뽑아줘. 제품 브랜드명/상품명은 빼고, 특징·효능·장점·사용감·구성 위주로. "
    "광고 과장 없이 페이지에 실제 있는 내용만. 출력 형식:\n"
    "카테고리: <카테고리>\n소구포인트:\n- <포인트1>\n- <포인트2>\n..."
)


def _gemini_generate(contents, retries: int = 3) -> str:
    """Gemini 호출 + 503/일시오류 재시도(지수 백오프)."""
    import time
    from google import genai
    client = genai.Client(api_key=_api_key())
    last = None
    for i in range(retries):
        try:
            r = client.models.generate_content(model=VISION_MODEL, contents=contents)
            return (r.text or "").strip()
        except Exception as e:
            last = e
            msg = str(e)
            if any(c in msg for c in ("503", "UNAVAILABLE", "overloaded", "429", "RESOURCE_EXHAUSTED")):
                time.sleep(2 * (i + 1))
                continue
            raise
    raise RuntimeError(f"Gemini 호출 실패(재시도 {retries}회): {str(last)[:160]}")


def points_from_image(image_bytes: bytes) -> str:
    return points_from_images([image_bytes])


def points_from_images(images: list[bytes]) -> str:
    """여러 장의 상세페이지 캡처를 한 번에 보고 소구포인트 추출."""
    from google.genai import types
    parts = [types.Part.from_bytes(data=img, mime_type="image/png") for img in images if img]
    if not parts:
        return ""
    return _gemini_generate([*parts, _POINT_PROMPT])


def points_from_text(text: str) -> str:
    return _gemini_generate(f"{_POINT_PROMPT}\n\n상세페이지 텍스트:\n{text}")


# ── 3. 통합 진입점 ─────────────────────────────────────────────

def extract_selling_points(url: str | None = None,
                           image_bytes: bytes | None = None,
                           images: list[bytes] | None = None,
                           manual: str | None = None) -> dict:
    """제품 소구포인트 추출. {points, source, site, error} 반환.

    우선순위: manual(직접입력) > images(업로드 캡처, 여러 장 가능) > url(크롤).
    url 크롤 시 텍스트+스크린샷 둘 다 Gemini에 줘서 이미지 상세까지 반영.
    """
    out = {"points": "", "source": "", "site": "", "error": ""}

    if manual and manual.strip():
        out["points"] = manual.strip()
        out["source"] = "manual"
        return out

    imgs = list(images or [])
    if image_bytes:
        imgs.append(image_bytes)
    imgs = [i for i in imgs if i]
    if imgs:
        try:
            out["points"] = points_from_images(imgs)
            out["source"] = f"image x{len(imgs)}"
            return out
        except Exception as e:
            out["error"] = f"이미지 분석 실패: {str(e)[:160]}"
            return out

    if url and url.strip():
        scraped = scrape_url(url.strip())
        out["site"] = scraped["site"]
        if scraped["ok"]:
            try:
                # 스크린샷(이미지 상세) 우선, 실패 시 텍스트
                if scraped["image_bytes"]:
                    out["points"] = points_from_image(scraped["image_bytes"])
                    out["source"] = "url+vision"
                else:
                    out["points"] = points_from_text(scraped["text"])
                    out["source"] = "url+text"
                return out
            except Exception as e:
                out["error"] = f"소구포인트 추출 실패: {str(e)[:160]}"
                return out
        else:
            out["error"] = scraped["error"]
            return out

    out["error"] = "제품 URL·이미지·수동입력 중 하나가 필요합니다."
    return out


# ── 4. 쿠팡 전용 프로필 1회 로그인 셋업(수동 실행) ─────────────

def setup_coupang_login():
    """쿠팡 전용 크롬 프로필에 1회 수동 로그인.

    실행하면 크롬 창이 열린다. 직접 쿠팡 로그인 후 아무 상품 페이지가
    정상으로 뜨는지 확인하고 창을 닫으면 세션이 COUPANG_PROFILE에 저장된다.
    이후 scrape_url("쿠팡URL")이 그 세션을 재사용해 차단을 통과한다.
    메인 크롬과 격리된 별도 프로필이라 다른 사이트 세션에 영향 없음.
    """
    from playwright.sync_api import sync_playwright
    COUPANG_PROFILE.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(COUPANG_PROFILE), headless=False,
            locale="ko-KR", user_agent=_UA, args=["--start-maximized"],
        )
        pg = ctx.pages[0] if ctx.pages else ctx.new_page()
        pg.goto("https://login.coupang.com/login/login.pang")
        print("크롬 창에서 쿠팡 로그인 후, 상품 페이지가 정상으로 뜨는지 확인하고 창을 닫으세요.")
        try:
            pg.wait_for_event("close", timeout=300000)  # 최대 5분 대기
        except Exception:
            pass
        ctx.close()
    print(f"세션 저장됨: {COUPANG_PROFILE}")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "login":
        setup_coupang_login()
    elif len(sys.argv) > 1:
        import json
        print(json.dumps(extract_selling_points(url=sys.argv[1]),
                         ensure_ascii=False, indent=2))
