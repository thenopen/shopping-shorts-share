"""voices.py 단위 테스트 — 닉네임→Voice 매핑, 기본값, 총 개수(스키마 정합성 연관).

app/voices.py 의 23개 voice 는 shared/schema/job.schema.json 의 진실 소스.
새 voice 가 추가/삭제되면 이 테스트와 스키마 definitions 를 함께 갱신해야 한다.
"""
from app.voices import VOICES, Voice, all_voices, get_voice


def test_get_voice_known():
    v = get_voice("소담")
    assert isinstance(v, Voice)
    assert v.nickname == "소담"
    assert v.gender == "F"
    assert v.google.startswith("ko-KR-Chirp3-HD-")


def test_get_voice_unknown_falls_back_to_sodam():
    """존재하지 않는 닉네임 → 기본값(소담). 런타임 폴백이 깨지지 않는지."""
    v = get_voice("존재안함")
    assert v.nickname == "소담"


def test_get_voice_empty_falls_back():
    v = get_voice("")
    assert v.nickname == "소담"


def test_all_voices_count_is_23():
    """스키마 정합성 — voice 총 23개(여 12 + 남 11). 변경 시 스키마도 갱신."""
    all_v = all_voices()
    assert len(all_v) == 23
    assert len(VOICES) == 23


def test_voices_have_google_chirp3hd():
    """모든 voice 가 Chirp3-HD voice_id 에 매핑되어야(스키마 설명과 일치)."""
    for v in all_voices():
        assert "Chirp3-HD" in v.google, f"{v.nickname} 의 google 이 Chirp3-HD 아님: {v.google}"


def test_voice_genders_balanced():
    females = [v for v in all_voices() if v.gender == "F"]
    males = [v for v in all_voices() if v.gender == "M"]
    assert len(females) == 12
    assert len(males) == 11
