"""Chinese speech recognition and Korean script generation."""

from __future__ import annotations

import os
from pathlib import Path

from app.pipeline.translate import translate_zh_ko


def transcribe_to_korean(
    media_path: Path,
    model_size: str = "small",
    keep_segments: bool = True,
    provider: str | None = None,
) -> dict:
    provider = (provider or os.environ.get("STT_PROVIDER") or "local").lower()
    if provider == "local":
        return _transcribe_local(media_path, model_size=model_size, keep_segments=keep_segments)
    if provider == "google":
        raise NotImplementedError("Google STT provider is reserved for service rollout. Use STT_PROVIDER=local for now.")
    raise ValueError(f"Unsupported STT_PROVIDER: {provider}")


def _transcribe_local(media_path: Path, model_size: str, keep_segments: bool) -> dict:
    from faster_whisper import WhisperModel

    media_path = Path(media_path)
    if not media_path.exists():
        raise FileNotFoundError(f"Media file not found: {media_path}")

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(str(media_path), language="zh")

    seg_list = []
    zh_parts = []
    for seg in segments:
        zh = (seg.text or "").strip()
        if not zh:
            continue
        zh_parts.append(zh)
        if keep_segments:
            ko = _safe_translate(zh)
            seg_list.append({"start": seg.start, "end": seg.end, "zh": zh, "ko": ko})

    zh_text = " ".join(zh_parts).strip()
    ko_text = _safe_translate(zh_text) if zh_text else ""
    return {"provider": "local", "zh_text": zh_text, "ko_text": ko_text, "segments": seg_list}


def _safe_translate(text: str) -> str:
    try:
        return translate_zh_ko(text)
    except Exception as e:
        print(f"  [translate failed: {str(e)[:100]}]")
        return ""
