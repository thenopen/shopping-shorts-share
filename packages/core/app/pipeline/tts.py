import asyncio
from pathlib import Path

import edge_tts

from app.config import DEFAULT_VOICE
from app.voices import get_voice


async def _synth(text: str, out_path: Path, voice: str, rate: str, pitch: str):
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, boundary="WordBoundary")
    timestamps = []
    with open(out_path, "wb") as f:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                timestamps.append(
                    {
                        "text": chunk["text"],
                        "offset": chunk["offset"] / 1e7,
                        "duration": chunk["duration"] / 1e7,
                    }
                )
    return timestamps


def synthesize(
    text: str,
    out_path: Path,
    voice: str = DEFAULT_VOICE,
    rate: str = "+0%",
    pitch: str = "+0Hz",
) -> tuple[Path, list]:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    timestamps = asyncio.run(_synth(text, out_path, voice, rate, pitch))
    return out_path, timestamps


def synthesize_by_nickname(
    text: str,
    out_path: Path,
    nickname: str = "",
    rate_override: str | None = None,
    speaking_rate: float = 1.0,
    emotion: str = "smart",
    emotion_intensity: float = 1.3,
) -> tuple[Path, list]:
    """대본 → Typecast TTS(감정 + 네이티브 단어 타임스탬프). 반환 (Path, stamps).

    nickname = Typecast voice_id(tc_/uc_). 발음 정규화는 오디오 입력에만(자막은 대본 원문).
    Typecast 전용 — 키 없으면 명확히 에러(폴백 없음, 사용자 결정).
    """
    from app.pipeline.ko_normalize import normalize_ko_reading
    text = normalize_ko_reading(text)
    from app.pipeline import typecast_tts
    if not typecast_tts.available():
        raise RuntimeError("Typecast API 키가 필요합니다. 설정에서 키를 입력하세요.")
    return typecast_tts.synthesize(
        text, out_path, voice_id=(nickname or None),
        emotion=emotion, intensity=emotion_intensity, tempo=speaking_rate,
    )


async def list_korean_voices():
    voices = await edge_tts.list_voices()
    return [v for v in voices if v["Locale"].startswith("ko-")]
