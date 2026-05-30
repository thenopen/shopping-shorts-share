"""대본 AI 다듬기 — Gemini.

1차 번역(중→한)은 어색함. Gemini로 자연스러운 한국어 쇼츠 대본으로 다듬는다.

키 우선순위:
  1. Gemini API키 (auth/gemini_key.txt 또는 env GEMINI_API_KEY) — AI Studio 발급, 제일 쉬움
  2. Vertex AI (서비스계정, auth/google_tts_key.json) — 권한+API활성화 필요

키 없으면 입력 그대로 반환(폴백).
"""
import os
import json
from pathlib import Path

from app.config import BACKEND_ROOT

GEMINI_KEY_PATH = BACKEND_ROOT / "auth" / "gemini_key.txt"
SA_KEY_PATH = BACKEND_ROOT / "auth" / "google_tts_key.json"
MODEL = "gemini-2.0-flash"

PROMPT = """다음은 중국어 쇼핑 영상을 한국어로 1차 번역한 대본이다.
틱톡/쇼츠용으로 자연스럽고 매끄러운 구어체 한국어로 다듬어라.
- 어색한 번역투, 문맥 안 맞는 부분 수정
- 제품 홍보 쇼츠 톤 (친근하고 솔깃하게)
- 길이는 비슷하게 유지, 과장/없는 내용 추가 금지
- 결과 대본만 출력 (설명/따옴표 없이)

원본 대본:
{script}"""


def _api_key() -> str | None:
    if os.environ.get("GEMINI_API_KEY"):
        return os.environ["GEMINI_API_KEY"]
    if GEMINI_KEY_PATH.exists():
        return GEMINI_KEY_PATH.read_text(encoding="utf-8").strip()
    return None


def available() -> bool:
    # API키만 신뢰 (Vertex는 권한 필요해 불확실)
    return bool(_api_key())


def refine_script(script: str) -> str:
    """대본을 자연스럽게 다듬어 반환. 실패시 원본 그대로."""
    script = (script or "").strip()
    if not script:
        return ""
    try:
        from google import genai
        key = _api_key()
        if key:
            client = genai.Client(api_key=key)
        else:
            # Vertex 폴백 (권한 있을 때만)
            proj = json.load(open(SA_KEY_PATH))["project_id"]
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(SA_KEY_PATH)
            client = genai.Client(vertexai=True, project=proj, location="us-central1")
        r = client.models.generate_content(model=MODEL, contents=PROMPT.format(script=script))
        out = (r.text or "").strip()
        return out or script
    except Exception as e:
        print(f"  [refine 실패, 원본유지: {str(e)[:100]}]")
        return script
