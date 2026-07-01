"""Gemini and Antigravity script refinement."""

from __future__ import annotations

import os
from pathlib import Path

from app.config import BACKEND_ROOT

GEMINI_KEY_PATH = BACKEND_ROOT / "auth" / "gemini_key.txt"
MODEL = os.environ.get("GEMINI_REFINE_MODEL", "gemini-2.5-flash-lite")

REFINE_PROMPT = """다음은 중국 쇼핑 영상의 한국어 1차 번역 대본입니다.
쇼핑 숏츠에 어울리게 자연스러운 한국어 구어체 대본으로 다듬어 주세요.

규칙:
- 어색한 번역투만 고치고 원래 의미를 최대한 유지
- 원문에 없는 제품 속성, 색감, 효능, 가격, 할인, 수량, 성능 추가 금지
- "무조건 사야 한다", "꼭 사야 한다" 같은 강압/과장 표현 금지
- 짧고 말하기 좋은 문장으로 정리
- 결과 대본만 출력

원본 대본:
{script}
"""


def _api_key() -> str | None:
    if os.environ.get("GEMINI_API_KEY"):
        return os.environ["GEMINI_API_KEY"].strip()
    if GEMINI_KEY_PATH.exists():
        return GEMINI_KEY_PATH.read_text(encoding="utf-8").strip()
    return None


def available() -> bool:
    return bool(_api_key())


def _retry_seconds(e: Exception) -> float | None:
    """429 RESOURCE_EXHAUSTED면 재시도까지 초, 아니면 None."""
    s = str(e)
    if "RESOURCE_EXHAUSTED" not in s and "429" not in s:
        return None
    import re
    m = re.search(r"retry.?delay\D*(\d+)", s, re.I)
    return float(m.group(1)) if m else 30.0


_TRANSIENT = ("503", "UNAVAILABLE", "overloaded", "500", "INTERNAL",
              "429", "RESOURCE_EXHAUSTED", "deadline", "timeout")


def _call_gemini(prompt: str, retries: int = 3) -> str:
    """Gemini 호출 + 사용량 집계. 일시오류(503 과부하·429·타임아웃)는 지수백오프 재시도.

    끝까지 실패하면 예외(호출측이 원문 폴백). 429면 usage에 쿨다운 기록.
    """
    import time

    from google import genai

    from app import usage

    key = _api_key()
    if not key:
        raise RuntimeError("no gemini key")
    client = genai.Client(api_key=key)
    last = None
    for i in range(max(1, retries)):
        try:
            res = client.models.generate_content(model=MODEL, contents=prompt)
            try:
                usage.record_gemini(MODEL, getattr(res, "usage_metadata", None))
            except Exception:
                pass
            return (res.text or "").strip()
        except Exception as e:
            last = e
            secs = _retry_seconds(e)
            if secs is not None:               # 429 → 쿨다운 기록
                usage.record_gemini_429(secs)
            transient = any(c in str(e) for c in _TRANSIENT)
            if transient and i < retries - 1:
                time.sleep(1.5 * (i + 1))       # 1.5s, 3s, …
                continue
            raise
    raise last if last else RuntimeError("gemini call failed")


def refine_script(script: str) -> str:
    script = (script or "").strip()
    if not script:
        return ""
    try:
        out = _call_gemini(REFINE_PROMPT.format(script=script))
        return _safe_refined_output(script, out) or script
    except Exception as e:
        print(f"  [Gemini refine failed, keeping original: {str(e)[:120]}]")
        return script


PRODUCT_SCRIPT_PROMPT = """너는 한국 쇼핑 숏츠 대본 작가다.
아래 (A)영상에서 추출한 내용과 (B)제품 상세페이지 소구포인트를 결합해
자연스러운 한국어 쇼츠 내레이션 대본을 작성해라.

규칙:
- 영상의 흐름·장면에 소구포인트를 자연스럽게 녹여라(나열 금지).
- 제품 브랜드명·상품명을 직접 말하지 마라. "이 제품", "요거" 같은 지시어로 가리켜라.
- 소구포인트에 있는 사실만 사용. 없는 효능·가격·할인·수량·성능을 지어내지 마라.
- "무조건 사라", "꼭 사야 한다" 같은 강압·과장 금지.
- 짧고 말하기 좋은 구어체. 20~45초 분량.
- 도입 1문장으로 관심을 끌어라.
- **오직 입으로 읽을 내레이션 문장만** 출력해라. 장면 지시(괄호 콘티), 마크다운 기호(**, [영상 끝] 등), 머리말·설명은 절대 넣지 마라. 문장만 줄바꿈으로 구분.

(A) 영상 내용:
{video}

(B) 제품 소구포인트:
{points}
"""


def product_script(video_content: str, selling_points: str, debug: list | None = None) -> str:
    """영상내용 + 제품 소구포인트 → 결합 대본(제품명 직접언급 회피).

    제품 상세페이지 정보를 의도적으로 주입하는 경로라 refine_script의
    '원문에 없는 속성 추가 금지' 안전필터를 적용하지 않는다(소구포인트는
    실제 상세페이지 근거가 있는 사실). debug(list)면 단계 append.
    """
    def _d(m):
        if debug is not None:
            debug.append(m)
        print(f"[제품대본] {m}", flush=True)

    video_content = (video_content or "").strip()
    selling_points = (selling_points or "").strip()
    if not selling_points:
        _d("대본 결합 생략: 소구포인트 없음 → 영상내용 그대로")
        return video_content
    key = _api_key()
    if not key:
        _d("대본 결합 생략: Gemini 키 없음 → 영상내용 그대로")
        return video_content
    _d(f"대본 결합(Gemini {MODEL}): 영상내용 {len(video_content)}자 + 소구포인트 {len(selling_points)}자")
    try:
        prompt = PRODUCT_SCRIPT_PROMPT.format(
            video=video_content or "(영상 내용 없음 — 소구포인트 중심으로 작성)",
            points=selling_points,
        )
        out = _call_gemini(prompt)
        result = _narration_only(out) or video_content
        _d(f"→ 결합 대본 생성 성공: {len(result)}자")
        return result
    except Exception as e:
        _d(f"✗ 대본 생성 실패, 영상내용 유지: {str(e)[:120]}")
        return video_content


CAPTION_DIRECTIONS = {
    "natural": "어색한 번역투를 자연스러운 한국어 구어체로 다듬어라. 원래 의미는 유지.",
    "impact": "짧고 강한 후킹 문장으로 바꿔라. 첫 문장은 강한 관심유도, 군더더기 제거.",
    "friendly": "친근한 구어체 톤으로 바꿔라(과하지 않게, 반말 살짝).",
    "concise": "핵심만 남기고 압축해라. 불필요한 수식어·중복 제거.",
}

CAPTION_REWRITE_PROMPT = """너는 한국 쇼핑 숏츠 자막 편집자다.
아래 자막 텍스트를 다음 방향으로 다시 써라.
방향: {instruction}

규칙:
- 원문에 없는 제품 속성·효능·가격·할인·수량·성능을 지어내지 마라.
- 강압적 구매 표현("무조건 사라" 등) 금지.
- 쇼츠 자막이라 한 줄은 짧게(8자 안팎). 줄바꿈으로 구분.
- 오직 자막 문장만 출력(설명·머리말·마크다운·콘티 금지).

자막:
{text}
"""


def rewrite_caption_text(text: str, direction: str = "natural") -> str:
    """현재 자막 텍스트를 방향(natural/impact/friendly/concise)대로 Gemini 재작성.

    키 없거나 실패 시 원문 그대로 반환(폴백). 결과는 줄바꿈 구분 내레이션.
    """
    text = (text or "").strip()
    if not text:
        return ""
    instr = CAPTION_DIRECTIONS.get(direction, CAPTION_DIRECTIONS["natural"])
    key = _api_key()
    if not key:
        return text
    try:
        prompt = CAPTION_REWRITE_PROMPT.format(instruction=instr, text=text)
        out = _narration_only(_call_gemini(prompt))
        return out or text
    except Exception as e:
        print(f"  [caption rewrite failed, keeping original: {str(e)[:120]}]")
        return text


def _narration_only(text: str) -> str:
    """콘티 지시·마크다운·머리말 제거 → 순수 내레이션 줄만 남김."""
    import re
    keep = []
    for ln in (text or "").splitlines():
        s = ln.strip()
        if not s:
            continue
        # 장면 지시 줄: (…)만 있거나 [영상 끝] 류
        if re.fullmatch(r"[\(\[].*[\)\]]", s):
            continue
        s = s.replace("**", "").replace("##", "")
        # "내레이션:", "나레이션:" 머리말 제거
        s = re.sub(r"^(내레이션|나레이션|대본|narration)\s*[:：]\s*", "", s, flags=re.I)
        # 줄 끝 괄호 콘티 제거: "문장 (장면설명)"
        s = re.sub(r"\s*[\(（][^\)）]*[\)）]\s*$", "", s).strip()
        if s:
            keep.append(s)
    return "\n".join(keep)


def _safe_refined_output(source: str, refined: str) -> str:
    refined = (refined or "").strip()
    if not refined:
        return source
    source_l = source.lower()
    refined_l = refined.lower()
    risky_terms = [
        "예쁘",
        "이쁘",
        "효과",
        "할인",
        "저렴",
        "최고",
        "완벽",
        "필수",
        "꼭 사",
        "무조건",
    ]
    for term in risky_terms:
        if term not in source_l and term in refined_l:
            print(f"  [refine safety fallback: introduced '{term}']")
            return source
    if len(refined) > max(120, len(source) * 3):
        print("  [refine safety fallback: output too long]")
        return source
    return refined
