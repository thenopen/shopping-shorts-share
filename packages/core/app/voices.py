from dataclasses import dataclass


@dataclass
class Voice:
    nickname: str
    google: str
    edge_id: str
    gender: str
    pitch: str = "+0Hz"
    rate: str = "+0%"


_EDGE_F = "ko-KR-SunHiNeural"
_EDGE_M = "ko-KR-InJoonNeural"

_FEMALE = [
    ("소담", "ko-KR-Chirp3-HD-Leda"),
    ("서연", "ko-KR-Chirp3-HD-Kore"),
    ("나윤", "ko-KR-Chirp3-HD-Aoede"),
    ("지우", "ko-KR-Chirp3-HD-Autonoe"),
    ("수아", "ko-KR-Chirp3-HD-Callirrhoe"),
    ("하은", "ko-KR-Chirp3-HD-Despina"),
    ("예린", "ko-KR-Chirp3-HD-Erinome"),
    ("가은", "ko-KR-Chirp3-HD-Gacrux"),
    ("리아", "ko-KR-Chirp3-HD-Laomedeia"),
    ("채원", "ko-KR-Chirp3-HD-Pulcherrima"),
    ("유나", "ko-KR-Chirp3-HD-Sulafat"),
    ("민서", "ko-KR-Chirp3-HD-Vindemiatrix"),
]

_MALE = [
    ("태형", "ko-KR-Chirp3-HD-Puck"),
    ("준호", "ko-KR-Chirp3-HD-Charon"),
    ("현우", "ko-KR-Chirp3-HD-Fenrir"),
    ("시우", "ko-KR-Chirp3-HD-Orus"),
    ("도윤", "ko-KR-Chirp3-HD-Achird"),
    ("재민", "ko-KR-Chirp3-HD-Algenib"),
    ("성호", "ko-KR-Chirp3-HD-Alnilam"),
    ("건우", "ko-KR-Chirp3-HD-Enceladus"),
    ("우진", "ko-KR-Chirp3-HD-Iapetus"),
    ("동현", "ko-KR-Chirp3-HD-Schedar"),
    ("민준", "ko-KR-Chirp3-HD-Umbriel"),
]

VOICES: dict[str, Voice] = {}
for nick, google_voice in _FEMALE:
    VOICES[nick] = Voice(nick, google_voice, _EDGE_F, "F")
for nick, google_voice in _MALE:
    VOICES[nick] = Voice(nick, google_voice, _EDGE_M, "M")


def get_voice(nickname: str) -> Voice:
    return VOICES.get(nickname, VOICES["소담"])


def all_voices() -> list[Voice]:
    return list(VOICES.values())
