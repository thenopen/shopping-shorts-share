"""Chinese speech recognition and Korean script generation."""

from __future__ import annotations

import os
from pathlib import Path

from app.pipeline.translate import translate_zh_ko

# (model_size, device, compute_type) → WhisperModel. 매 호출 재로드 방지(로드 수초·VRAM 절약).
# GPU_SEM(server_api)으로 GPU 작업이 직렬화되므로 캐시된 모델 동시접근 경쟁 없음.
_WHISPER_CACHE: dict = {}


def _load_whisper(model_size: str, device: str, compute_type: str):
    key = (model_size, device, compute_type)
    m = _WHISPER_CACHE.get(key)
    if m is None:
        from faster_whisper import WhisperModel
        m = WhisperModel(model_size, device=device, compute_type=compute_type)
        _WHISPER_CACHE[key] = m
    return m


def load_whisper_auto(model_size: str = "large-v3"):
    """GPU 가능하면 cuda+float16, 아니면 cpu+int8. 캐시 재사용. transcribe·align 공용."""
    try:
        import torch
        use_cuda = torch.cuda.is_available()
    except Exception:
        use_cuda = False
    if use_cuda:
        try:
            return _load_whisper(model_size, "cuda", "float16")
        except Exception as e:
            print(f"  [whisper cuda init 실패, cpu 폴백: {str(e)[:100]}]")
            return _load_whisper("small", "cpu", "int8")
    return _load_whisper("small", "cpu", "int8")


def transcribe_to_korean(
    media_path: Path,
    model_size: str = "large-v3",
    keep_segments: bool = True,
    provider: str | None = None,
    progress_cb=None,
) -> dict:
    provider = (provider or os.environ.get("STT_PROVIDER") or "local").lower()
    if provider == "local":
        return _transcribe_local(media_path, model_size=model_size,
                                 keep_segments=keep_segments, progress_cb=progress_cb)
    if provider == "google":
        raise NotImplementedError("Google STT provider is reserved for service rollout. Use STT_PROVIDER=local for now.")
    raise ValueError(f"Unsupported STT_PROVIDER: {provider}")


def _media_has_audio(path: Path) -> bool:
    """ffprobe로 오디오 스트림 존재 확인. 없으면 whisper가 PyAV IndexError로 크래시하므로 사전 차단."""
    import subprocess
    from app.config import FFPROBE
    try:
        r = subprocess.run(
            [FFPROBE, "-v", "error", "-select_streams", "a",
             "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True)
        return bool((r.stdout or "").strip())
    except Exception:
        return True   # 불확실하면 일단 시도


def _transcribe_local(media_path: Path, model_size: str, keep_segments: bool,
                      progress_cb=None) -> dict:
    media_path = Path(media_path)
    if not media_path.exists():
        raise FileNotFoundError(f"Media file not found: {media_path}")

    # 오디오 없는 영상(무음/BGM 제거본 등)은 whisper가 PyAV IndexError로 죽음 → graceful 처리.
    if not _media_has_audio(media_path):
        print("  [transcribe: 오디오 스트림 없음 → 대본 없음(무음 영상)]", flush=True)
        return {"provider": "local", "zh_text": "", "ko_text": "",
                "segments": [], "no_audio": True}

    # GPU 있으면 cuda+float16(정확·빠름), 없으면 cpu+int8 폴백. 모델은 캐시 재사용.
    model = load_whisper_auto(model_size)
    # beam_size↑·vad_filter로 무음구간 환청('0,,입자' 류) 억제 → 정확도 개선.
    # faster-whisper의 segments는 지연 제너레이터 → 순회하며 seg.end/전체길이로 진행률 산출.
    segments, _info = model.transcribe(
        str(media_path), language="zh", beam_size=5,
        vad_filter=True, vad_parameters={"min_silence_duration_ms": 500},
    )
    total_dur = float(getattr(_info, "duration", 0) or 0)

    seg_list = []
    zh_parts = []
    for seg in segments:
        if progress_cb and total_dur:
            try:
                progress_cb(min(float(seg.end) / total_dur, 0.99))
            except Exception:
                pass
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
