"""성우 닉네임 ↔ TTS 보이스 매핑.

기본 엔진 = Google Cloud TTS (Chirp3-HD = 가장 자연스러움).
Google 키 없으면 edge-tts로 폴백.

Google 한국어 보이스 41개 중 자연스러운 Chirp3-HD 위주로 한국 닉네임 부여.
각 닉네임 = (google_voice, edge_id, gender). edge_id는 폴백용.
"""
from dataclasses import dataclass


@dataclass
class Voice:
    nickname: str
    google: str          # Google 보이스명
    edge_id: str         # edge-tts 폴백 보이스
    gender: str          # "F" | "M"
    pitch: str = "+0Hz"  # edge 폴백용
    rate: str = "+0%"


_EDGE_F = "ko-KR-SunHiNeural"
_EDGE_M = "ko-KR-InJoonNeural"

# 여성 보이스 (Chirp3-HD)
_FEMALE = [
    ("소담", "ko-KR-Chirp3-HD-Leda"),
    ("서연", "ko-KR-Chirp3-HD-Kore"),
    ("하은", "ko-KR-Chirp3-HD-Aoede"),
    ("제니", "ko-KR-Chirp3-HD-Zephyr"),
    ("지우", "ko-KR-Chirp3-HD-Autonoe"),
    ("수아", "ko-KR-Chirp3-HD-Callirrhoe"),
    ("나윤", "ko-KR-Chirp3-HD-Despina"),
    ("예린", "ko-KR-Chirp3-HD-Erinome"),
    ("가은", "ko-KR-Chirp3-HD-Gacrux"),
    ("리아", "ko-KR-Chirp3-HD-Laomedeia"),
    ("채원", "ko-KR-Chirp3-HD-Pulcherrima"),
    ("유나", "ko-KR-Chirp3-HD-Sulafat"),
    ("민서", "ko-KR-Chirp3-HD-Vindemiatrix"),
    ("아인", "ko-KR-Neural2-A"),
]

# 남성 보이스 (Chirp3-HD)
_MALE = [
    ("태형", "ko-KR-Chirp3-HD-Puck"),
    ("준호", "ko-KR-Chirp3-HD-Charon"),
    ("도윤", "ko-KR-Chirp3-HD-Fenrir"),
    ("시우", "ko-KR-Chirp3-HD-Orus"),
    ("재민", "ko-KR-Chirp3-HD-Achird"),
    ("우진", "ko-KR-Chirp3-HD-Algenib"),
    ("성호", "ko-KR-Chirp3-HD-Alnilam"),
    ("건우", "ko-KR-Chirp3-HD-Enceladus"),
    ("현우", "ko-KR-Chirp3-HD-Iapetus"),
    ("지훈", "ko-KR-Chirp3-HD-Rasalgethi"),
    ("동현", "ko-KR-Chirp3-HD-Schedar"),
    ("민준", "ko-KR-Chirp3-HD-Umbriel"),
    ("상호", "ko-KR-Neural2-C"),
]

VOICES: dict[str, Voice] = {}
for nick, g in _FEMALE:
    VOICES[nick] = Voice(nick, g, _EDGE_F, "F")
for nick, g in _MALE:
    VOICES[nick] = Voice(nick, g, _EDGE_M, "M")


def get_voice(nickname: str) -> Voice:
    return VOICES.get(nickname, VOICES["소담"])


def all_voices() -> list[Voice]:
    return list(VOICES.values())
