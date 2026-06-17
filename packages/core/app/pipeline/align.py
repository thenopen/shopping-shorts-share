"""TTS 더빙 음성 → 단어 타임스탬프 재정렬.

Google Cloud TTS는 단어 타임스탬프를 주지 않아(빈 []) 자막이 글자수 균등분할로
어긋난다. 합성된 더빙 mp3를 faster-whisper로 다시 STT해 단어 단위 타이밍을 만든다.
provider(Google/edge) 무관하게 동작. caption.build_lines_from_tts가 그대로 소비하는
[{text, offset, duration}] 구조로 반환한다.

faster-whisper 모델은 transcribe.load_whisper_auto가 캐시한 것을 재사용한다.
GPU 작업은 server_api의 GPU_SEM으로 직렬화되는 것을 전제로 한다.
"""
from __future__ import annotations

from pathlib import Path


def word_timestamps(audio_path, language: str = "ko", model_size: str = "small") -> list:
    """오디오 파일 → [{text, offset, duration}] 단어 타임스탬프.

    실패하거나 단어를 못 뽑으면 [] 반환(호출측은 글자수 균등분할 폴백 유지).
    model_size: 합성 음성은 깨끗해 'small'로 충분·빠름(렌더 지연 최소화).
    """
    audio_path = Path(audio_path)
    if not audio_path.exists():
        return []
    try:
        from app.pipeline.transcribe import load_whisper_auto

        model = load_whisper_auto(model_size)
        segments, _info = model.transcribe(
            str(audio_path),
            language=language,
            beam_size=5,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
        )
        out: list[dict] = []
        for seg in segments:
            for w in (getattr(seg, "words", None) or []):
                txt = (getattr(w, "word", "") or "").strip()
                if not txt:
                    continue
                start = float(getattr(w, "start", 0.0) or 0.0)
                end = float(getattr(w, "end", start) or start)
                out.append({
                    "text": txt,
                    "offset": start,
                    "duration": max(0.0, end - start),
                })
        return out
    except Exception as e:
        print(f"  [whisper word-align 실패, 균등분할 폴백: {str(e)[:120]}]")
        return []
