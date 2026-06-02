"""Chinese speech recognition and Korean script generation."""

from __future__ import annotations

import os
from pathlib import Path

from app.pipeline.translate import translate_zh_ko


def transcribe_to_korean(
    media_path: Path,
    model_size: str = "large-v3",
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

    # GPU 있으면 cuda+float16(정확·빠름), 없으면 cpu+int8 폴백.
    try:
        import torch
        use_cuda = torch.cuda.is_available()
    except Exception:
        use_cuda = False
    if use_cuda:
        try:
            model = WhisperModel(model_size, device="cuda", compute_type="float16")
        except Exception as e:
            print(f"  [whisper cuda init 실패, cpu 폴백: {str(e)[:100]}]")
            model = WhisperModel("small", device="cpu", compute_type="int8")
    else:
        model = WhisperModel("small", device="cpu", compute_type="int8")
    # beam_size↑·vad_filter로 무음구간 환청('0,,입자' 류) 억제 → 정확도 개선.
    segments, _info = model.transcribe(
        str(media_path), language="zh", beam_size=5,
        vad_filter=True, vad_parameters={"min_silence_duration_ms": 500},
    )

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
