"""[4] 한국어 TTS 더빙 — edge-tts (무료, API키 없음)."""
import asyncio
from pathlib import Path
import edge_tts

from app.config import DEFAULT_VOICE


async def _synth(text: str, out_path: Path, voice: str, rate: str, pitch: str):
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    await communicate.save(str(out_path))


def synthesize(
    text: str,
    out_path: Path,
    voice: str = DEFAULT_VOICE,
    rate: str = "+0%",
    pitch: str = "+0Hz",
) -> Path:
    """텍스트 → mp3 음성파일.

    rate 예: "+10%" (빠르게), "-10%" (느리게)
    pitch 예: "+2Hz", "-2Hz"
    """
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    asyncio.run(_synth(text, out_path, voice, rate, pitch))
    return out_path


async def list_korean_voices():
    """사용 가능한 한국어 보이스 목록."""
    voices = await edge_tts.list_voices()
    return [v for v in voices if v["Locale"].startswith("ko-")]


if __name__ == "__main__":
    # 빠른 테스트: python -m app.pipeline.tts
    from app.config import WORKDIR
    out = synthesize("안녕하세요. 이 제품 정말 좋습니다. 지금 바로 확인해보세요.",
                     WORKDIR / "tts_test.mp3")
    print("saved:", out)
