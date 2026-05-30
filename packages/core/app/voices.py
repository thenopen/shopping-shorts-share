"""성우 닉네임 ↔ edge-tts 보이스 매핑.

UI에 보이는 성우 이름(하은/서연/소담/...)을 실제 edge-tts 보이스 ID로 연결.
edge-tts 한국어 보이스는 현재 2종(SunHi=여, InJoon=남)뿐이라,
부족한 닉네임은 같은 보이스에 pitch/rate를 달리해 캐릭터를 만든다.

TODO: 보이스 다양화 — Piper(로컬, 한국어 모델 여러개) 도입 검토.
      edge-tts만으로는 8가지 뚜렷한 목소리 한계.
"""
from dataclasses import dataclass


@dataclass
class Voice:
    nickname: str       # UI 표시명
    edge_id: str        # edge-tts 보이스 ID
    pitch: str = "+0Hz"
    rate: str = "+0%"
    gender: str = "F"


# 스크린샷의 성우 8종. 현재는 2개 실보이스 + pitch 변형으로 흉내.
VOICES = {
    "하은": Voice("하은", "ko-KR-SunHiNeural", pitch="+15Hz", gender="F"),
    "서연": Voice("서연", "ko-KR-SunHiNeural", pitch="+5Hz", gender="F"),
    "소담": Voice("소담", "ko-KR-SunHiNeural", pitch="+0Hz", gender="F"),
    "제니": Voice("제니", "ko-KR-SunHiNeural", pitch="-5Hz", rate="+5%", gender="F"),
    "안나": Voice("안나", "ko-KR-SunHiNeural", pitch="+10Hz", rate="-5%", gender="F"),
    "지연": Voice("지연", "ko-KR-SunHiNeural", pitch="-10Hz", gender="F"),
    "태형": Voice("태형", "ko-KR-InJoonNeural", pitch="+0Hz", gender="M"),
    "상호": Voice("상호", "ko-KR-InJoonNeural", pitch="-8Hz", rate="-3%", gender="M"),
}


def get_voice(nickname: str) -> Voice:
    return VOICES.get(nickname, VOICES["소담"])
