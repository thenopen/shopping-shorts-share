"""Gemini and Antigravity script refinement."""

from __future__ import annotations

import os
from pathlib import Path

from app.config import BACKEND_ROOT

GEMINI_KEY_PATH = BACKEND_ROOT / "auth" / "gemini_key.txt"
MODEL = os.environ.get("GEMINI_REFINE_MODEL", "gemini-2.5-flash-lite")
ANTIGRAVITY_AGENT = os.environ.get("ANTIGRAVITY_AGENT", "antigravity-preview-05-2026")

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

AGENT_PROMPT = """너는 한국 쇼핑 숏츠 대본 편집자다.
아래 한국어 대본을 검수하고, 자연스러운 숏츠 내레이션으로 다시 작성해라.

목표:
- 중국어 번역투 제거
- 도입 1문장에 관심 유도
- 제품 장점은 담백하게 유지
- 원문에 없는 제품 속성, 효능, 가격, 할인, 수량, 성능 추가 금지
- 강압적 구매 표현 금지
- 20~45초 내레이션 길이에 맞게 압축

출력 형식:
1) 최종대본:
<대본>
2) notes:
<짧은 수정 요약>

대본:
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


def refine_script(script: str) -> str:
    script = (script or "").strip()
    if not script:
        return ""
    try:
        from google import genai

        client = genai.Client(api_key=_api_key())
        res = client.models.generate_content(model=MODEL, contents=REFINE_PROMPT.format(script=script))
        out = (res.text or "").strip()
        return _safe_refined_output(script, out) or script
    except Exception as e:
        print(f"  [Gemini refine failed, keeping original: {str(e)[:120]}]")
        return script


def antigravity_refine(script: str, mode: str = "shopping_shorts") -> dict:
    script = (script or "").strip()
    if not script:
        return {"script": "", "notes": ""}
    key = _api_key()
    if not key:
        raise RuntimeError("Gemini API key not found")

    try:
        from google import genai

        client = genai.Client(api_key=key)
        interaction = client.interactions.create(
            agent=ANTIGRAVITY_AGENT,
            input=AGENT_PROMPT.format(script=script),
            environment="remote",
        )
        text = (interaction.output_text or "").strip()
        refined, notes = _parse_agent_output(text)
        return {"script": _safe_refined_output(script, refined or text or script), "notes": notes}
    except Exception as e:
        raise RuntimeError(f"Antigravity refine failed: {str(e)[:240]}") from e


def _parse_agent_output(text: str) -> tuple[str, str]:
    if "최종대본:" not in text:
        return text.strip(), ""
    body = text.split("최종대본:", 1)[1].strip()
    if "notes:" in body:
        script, notes = body.split("notes:", 1)
        return script.strip(), notes.strip()
    if "2)" in body:
        script, notes = body.split("2)", 1)
        return script.strip(), notes.strip()
    return body.strip(), ""


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
