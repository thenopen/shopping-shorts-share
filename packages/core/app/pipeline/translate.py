"""Chinese to Korean translation helpers."""

from __future__ import annotations

from deep_translator import GoogleTranslator

MAX_CHARS = 4500


def translate_zh_ko(text: str) -> str:
    text = (text or "").strip()
    if not text:
        return ""

    chunks = _split_text(text, MAX_CHARS)
    translated: list[str] = []
    for chunk in chunks:
        translated.append(GoogleTranslator(source="zh-CN", target="ko").translate(chunk))
    return "\n".join(part for part in translated if part).strip()


def translate_batch(texts: list[str]) -> list[str]:
    out = []
    for text in texts:
        try:
            out.append(translate_zh_ko(text))
        except Exception:
            out.append("")
    return out


def _split_text(text: str, limit: int) -> list[str]:
    if len(text) <= limit:
        return [text]

    chunks: list[str] = []
    cur: list[str] = []
    cur_len = 0
    for piece in re_split_keep(text):
        if cur and cur_len + len(piece) > limit:
            chunks.append("".join(cur).strip())
            cur = []
            cur_len = 0
        cur.append(piece)
        cur_len += len(piece)
    if cur:
        chunks.append("".join(cur).strip())
    return [c for c in chunks if c]


def re_split_keep(text: str) -> list[str]:
    import re

    parts = re.split(r"([。！？!?]\s*)", text)
    out = []
    for i in range(0, len(parts), 2):
        sentence = parts[i]
        if i + 1 < len(parts):
            sentence += parts[i + 1]
        if sentence:
            out.append(sentence)
    return out or [text]
