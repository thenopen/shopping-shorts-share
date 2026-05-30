"""[5] 한국어 TTS 더빙 — edge-tts (무료, API키 없음). ✓동작확인됨

기능:
  - 텍스트 → 한국어 음성 mp3
  - 성우(닉네임) 선택 → voices.py 매핑
  - 배속(rate) / 피치(pitch) 조절
  - 단어 타임스탬프 추출 → [6] 자막 자동싱크에 사용

edge-tts는 MS Edge 뉴럴 보이스를 무료로 씀. 인터넷 연결 필요.
"""
import asyncio
from pathlib import Path
import edge_tts

from app.config import DEFAULT_VOICE
from app.voices import get_voice


async def _synth(text, out_path, voice, rate, pitch):
    """음성 저장 + WordBoundary 타임스탬프 수집."""
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    timestamps = []
    with open(out_path, "wb") as f:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                # offset/duration 단위: 100ns → 초
                timestamps.append({
                    "text": chunk["text"],
                    "offset": chunk["offset"] / 1e7,
                    "duration": chunk["duration"] / 1e7,
                })
    return timestamps


def synthesize(
    text: str,
    out_path: Path,
    voice: str = DEFAULT_VOICE,
    rate: str = "+0%",
    pitch: str = "+0Hz",
) -> tuple[Path, list]:
    """텍스트 → (mp3 경로, 단어 타임스탬프 리스트).

    voice: edge-tts 보이스 ID 직접 지정.
    rate 예: "+10%"(빠르게) / "-10%"(느리게)
    """
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    timestamps = asyncio.run(_synth(text, out_path, voice, rate, pitch))
    return out_path, timestamps


def synthesize_by_nickname(text: str, out_path: Path, nickname: str = "소담",
                           rate_override: str | None = None) -> tuple[Path, list]:
    """성우 닉네임으로 더빙. UI에서 이걸 호출.

    rate_override: 배속 조절 UI값으로 성우 기본 rate를 덮어씀.
    """
    v = get_voice(nickname)
    return synthesize(text, out_path, voice=v.edge_id,
                      rate=rate_override or v.rate, pitch=v.pitch)


async def list_korean_voices():
    voices = await edge_tts.list_voices()
    return [v for v in voices if v["Locale"].startswith("ko-")]


if __name__ == "__main__":
    from app.config import WORKDIR
    out, ts = synthesize("안녕하세요. 이 제품 정말 좋습니다. 지금 바로 확인해보세요.",
                         WORKDIR / "tts_test.mp3")
    print("saved:", out)
    print("timestamps:", ts[:5], "...")
