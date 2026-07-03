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
    nickname: str = "소담",
    rate_override: str | None = None,
    speaking_rate: float = 1.0,
) -> tuple[Path, list]:
    # 발음 정규화(숫자·금액·단위·기호 → 읽는 형태). Google/Edge 둘 다 SSML 불가라
    # 합성 전 텍스트 치환이 유일한 발음 교정 레버. 자막 텍스트엔 적용 안 함(화면=대본 원문).
    from app.pipeline.ko_normalize import normalize_ko_reading
    text = normalize_ko_reading(text)
    try:
        from app.pipeline import google_tts

        if google_tts.available():
            out = google_tts.synthesize(text, out_path, nickname=nickname, speaking_rate=speaking_rate)
            return out, []
    except Exception as e:
        print(f"  [Google TTS failed, falling back to edge-tts: {str(e)[:80]}]")

    v = get_voice(nickname)
    return synthesize(text, out_path, voice=v.edge_id, rate=rate_override or v.rate, pitch=v.pitch)


async def list_korean_voices():
    voices = await edge_tts.list_voices()
    return [v for v in voices if v["Locale"].startswith("ko-")]
