"""번역 — 중국어 → 한국어 (무료 구글번역).

OCR 자막번역[2], STT 대본생성[3] 양쪽에서 쓰는 공용 번역기.
deep-translator의 GoogleTranslator 사용 (API키 없음, 무료).

긴 텍스트는 5000자 제한 있어 문장단위로 나눠 번역.
"""
from deep_translator import GoogleTranslator


def translate_zh_ko(text: str) -> str:
    """중국어 → 한국어. 빈 문자열이면 그대로 반환."""
    text = (text or "").strip()
    if not text:
        return ""
    return GoogleTranslator(source="zh-CN", target="ko").translate(text)


def translate_batch(texts: list[str]) -> list[str]:
    """여러 문장 일괄 번역. 빈 항목은 빈 문자열 유지."""
    out = []
    for t in texts:
        try:
            out.append(translate_zh_ko(t))
        except Exception:
            out.append("")   # 한 문장 실패해도 전체 안 죽게
    return out


if __name__ == "__main__":
    print(translate_zh_ko("春夏纯欲水光肌这不是手拿把掐了"))
