"""Gemini and Antigravity script refinement."""

from __future__ import annotations

import os

from app import gemini
from app.gemini import api_key as _api_key, available  # noqa: F401 (재export: 다른 모듈이 refine.available 사용)

MODEL = os.environ.get("GEMINI_REFINE_MODEL", "gemini-2.5-flash-lite")

# 쇼츠 공통 문장 규칙 — 대본이 이후 자막 줄(6~12자 호흡)로 분할되는 걸 전제로 작성.
SHORTS_RULES = """- 쇼츠 자막으로 잘리기 좋게: 한 문장 = 한 메시지, 한 호흡(대략 15자 안쪽)으로 짧게.
- 긴 문장은 둘로 쪼개고, 접속사로 길게 잇지 마라.
- 첫 문장은 3초 안에 시선을 잡는 도입(질문·반전·구체 숫자)."""

# 대본 AI 가공 8방향(8각 다이얼) — 프론트 ScriptStage와 키 동일.
SCRIPT_DIRECTIONS = {
    "hook":     "도입부를 첫 3초에 시선을 강탈하는 훅(질문·반전·구체 숫자)으로 다시 써라. 본문 의미는 유지.",
    "impact":   "짧고 강한 문장으로 바꿔라. 군더더기·수식어 제거, 단문 위주 펀치라인.",
    "urgency":  "지금 봐야 할 이유가 느껴지는 긴박한 톤으로 바꿔라. 단, 원문에 없는 할인·한정수량·마감시한을 지어내지 마라.",
    "humor":    "가벼운 위트를 한 스푼 섞어라(과한 드립·유행어 남발 금지). 정보는 그대로.",
    "story":    "직접 써본 사람의 경험담 흐름(궁금→써봄→결과)으로 재구성해라.",
    "friendly": "친한 친구가 알려주는 톤으로 바꿔라(반말 살짝, 과하지 않게).",
    "trust":    "담백하고 신뢰감 있는 정보 전달 톤으로 바꿔라. 감탄사 줄이고 사실·근거 중심.",
    "concise":  "핵심만 남기고 압축해라. 중복·군더더기 제거, 분량 30% 이상 줄이기.",
}

REFINE_PROMPT = """다음은 한국 쇼핑 숏츠용 한국어 대본입니다.
{instruction}

규칙:
- 원래 의미를 최대한 유지
- 원문에 없는 제품 속성, 색감, 효능, 가격, 할인, 수량, 성능 추가 금지
- "무조건 사야 한다", "꼭 사야 한다" 같은 강압/과장 표현 금지
{shorts_rules}
- 결과 대본만 출력(설명·머리말·마크다운 금지)

원본 대본:
{script}
"""

# direction 미지정 시 기본 가공(기존 동작): 번역투 정리 + 자연스러운 구어체.
DEFAULT_INSTRUCTION = "어색한 번역투를 고치고 자연스러운 한국어 구어체 대본으로 다듬어 주세요."


def _call_gemini(prompt: str, retries: int = 3) -> str:
    """Gemini(텍스트) 호출 — 과부하(503) 대비 모델 폴백 체인.

    flash-lite가 자주 503(모델 과부하)나서, 실패 시 flash·2.0-flash로 자동 강등.
    503은 모델별 용량 풀이 달라 다른 모델은 대개 뚫림(429 레이트 한도와는 다름).
    """
    return gemini.generate_fallback(prompt)


def refine_script(script: str, direction: str | None = None) -> str:
    """대본 AI 가공. direction(8방향 키) 지정 시 그 방향으로, 없으면 기본(번역투 정리)."""
    script = (script or "").strip()
    if not script:
        return ""
    instruction = SCRIPT_DIRECTIONS.get(direction or "", DEFAULT_INSTRUCTION)
    try:
        out = _call_gemini(REFINE_PROMPT.format(
            instruction=instruction, shorts_rules=SHORTS_RULES, script=script))
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
{shorts_rules}
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
    from app.debuglog import make_dbg
    _d = make_dbg(debug, "제품대본")

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
            shorts_rules=SHORTS_RULES,
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
