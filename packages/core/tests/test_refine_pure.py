"""refine.py 순수 함수 단위 테스트 — Gemini 호출 없이 정규화·분량 계산 검증.

_normalize_script(이모지/공백 정규화), _length_hint(목표 초수→글자수),
_script_chars, _nums_with_units(가격·용량 추출) 가 핵심 회귀 대상.
"""
from app.pipeline.refine import (
    _EMOJI_RE,
    _length_hint,
    _narration_only,
    _normalize_script,
    _nums_with_units,
    _script_chars,
)


# ── _normalize_script ─────────────────────────────────────────────────────
def test_normalize_removes_emoji():
    assert _normalize_script("좋아요 ✨🤦 정말") == "좋아요 정말"
    assert _normalize_script("최고 🎉") == "최고"


def test_normalize_collapses_repeated_spaces_and_tabs():
    assert _normalize_script("안녕   잘가\t또봐") == "안녕 잘가 또봐"


def test_normalize_drops_empty_lines():
    assert _normalize_script("첫째\n\n둘째\n   \n셋째") == "첫째\n둘째\n셋째"


def test_normalize_preserves_sentence_punctuation():
    assert _normalize_script("안녕! 반가워?") == "안녕! 반가워?"


def test_normalize_empty_string():
    assert _normalize_script("") == ""
    assert _normalize_script("   \n\n  ") == ""


def test_emoji_re_matches_common_pictographs():
    """_EMOJI_RE 가 이모지 범위를 실제로 잡는지."""
    assert _EMOJI_RE.search("✨")
    assert _EMOJI_RE.search("🤦")
    assert _EMOJI_RE.search("🎉")
    assert _EMOJI_RE.search("❤️")
    # 일반 한국어/영문은 안 잡아야 함
    assert not _EMOJI_RE.search("안녕")
    assert not _EMOJI_RE.search("1000원")


# ── _length_hint ──────────────────────────────────────────────────────────
def test_length_hint_none_or_short_returns_default():
    assert _length_hint(None) == "20~45초 분량."
    assert _length_hint(0) == "20~45초 분량."
    assert _length_hint(2) == "20~45초 분량."   # <3


def test_length_hint_includes_target_seconds_and_char_range():
    out = _length_hint(30)
    assert "30초" in out
    # 30 * 5.5 * 1.08 ≈ 178 → lo ≈ 160, hi ≈ 196
    assert "160" in out or "161" in out or "159" in out
    # 글자수 1순위 제약 문구가 있어야 함(프롬프트 튜닝 핵심)
    assert "글자수가 1순위" in out


def test_length_hint_grows_with_seconds():
    a = _length_hint(20)
    b = _length_hint(60)
    # 더 긴 목표가 더 큰 글자수 범위를 제시해야 함
    assert a != b


# ── _script_chars ─────────────────────────────────────────────────────────
def test_script_chars_excludes_whitespace():
    assert _script_chars("안녕 하세요") == 5
    assert _script_chars("  \n\t ") == 0
    assert _script_chars("") == 0
    # caption._vis_len 과 동일语义(공백 제외)
    assert _script_chars("가 나 다") == 3


# ── _nums_with_units ──────────────────────────────────────────────────────
def test_nums_with_units_catches_price():
    s = _nums_with_units("이거 9,900원이요, 50% 할인")
    assert any("9900원" == x for x in s)        # 콤마 제거 정규화
    assert any("50%" in x for x in s)


def test_nums_with_units_catches_capacity():
    s = _nums_with_units("500ml 들어있어요 2개입")
    assert any("500ml" in x.lower() for x in s)
    assert any("2개입" in x for x in s)


def test_nums_with_units_ignores_bare_numbers():
    """단위 없는 숫자는 매칭하지 않는다(과잉 채택 방지)."""
    s = _nums_with_units("번호 3번으로")
    # '3' 단독은 없어야 함
    assert "3" not in s


def test_nums_with_units_normalizes_case_and_commas():
    """콤마 제거 + 단위 소문자화. 단, 단위 정규식이 소문자(g)만 매칭 — 대문자 G는 안 잡힘(실제 동작)."""
    s = _nums_with_units("1,000mL")
    assert "1000ml" in s          # mL → ml 정규화
    # 대문자 G 단위는 정규식이 소문자 g 만 매칭하므로 잡히지 않음(현재 동작 문서화)
    assert "750g" not in _nums_with_units("750G")
    assert "750g" in _nums_with_units("750g")


# ── _narration_only ───────────────────────────────────────────────────────
def test_narration_only_strips_markdown_bold():
    """**강조** 마크다운 볼드 기호만 제거 — 괄호/대괄호 내용은 현재 유지(실제 동작)."""
    out = _narration_only("**강조** 대본")
    assert "**" not in out
    assert "강조" in out
    assert "대본" in out


def test_narration_only_preserves_bracketed_text():
    """괄호/대괄호 장면 지시는 제거하지 않음(현재 구현 — 향후 확장 시 이 테스트 갱신)."""
    out = _narration_only("안녕 (웃으며) 잘가")
    assert "안녕" in out and "잘가" in out
    # 현재는 (웃으며) 도 그대로 유지
    assert "(웃으며)" in out
