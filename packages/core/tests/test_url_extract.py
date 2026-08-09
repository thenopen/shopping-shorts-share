"""url_extract.py 단위 테스트 — extract_url/_clean_url.

도우인 단축/긴 URL, 일반 URL, 끝문자 정리, 빈 입력 처리 검증.
"""
from app.url_extract import _clean_url, extract_url


def test_extract_douyin_short():
    url = "https://v.douyin.com/AbCd123/"
    assert extract_url(url) == url


def test_extract_douyin_long():
    url = "https://www.douyin.com/video/7123456789012345678"
    assert extract_url(url) == url


def test_extract_general_url_from_text():
    """텍스트 중간의 URL 도 추출."""
    out = extract_url("이것 좀 봐 https://example.com/v/abc 잘 만들었네")
    assert out is not None
    assert "example.com/v/abc" in out


def test_extract_strips_trailing_punctuation():
    """끝의 마침표/쉼표/괄호/따옴표 등은 잘린다(_clean_url)."""
    out = extract_url("https://example.com/page.")
    assert out == "https://example.com/page"
    out2 = extract_url("(https://example.com/x)")
    assert out2 == "https://example.com/x"


def test_extract_strips_trailing_quote():
    out = extract_url('링크: "https://example.com/a"')
    assert out == "https://example.com/a"


def test_extract_returns_none_for_empty():
    assert extract_url("") is None
    assert extract_url(None) is None   # type: ignore[arg-type]
    assert extract_url("URL 없는 텍스트") is None


def test_clean_url_strips_specified_trailing_chars():
    """rstrip 문자 집합 확인 — .,;!?)]}>'\" """
    assert _clean_url("https://x.com/a.,;,") == "https://x.com/a"
    assert _clean_url("https://x.com/a!?") == "https://x.com/a"


def test_extract_prefers_douyin_over_generic():
    """도우인 URL 과 일반 URL 이 같은 텍스트에 있으면 도우인이 먼저 매칭."""
    text = "보통은 https://example.com 인데 이번엔 https://v.douyin.com/xyz"
    out = extract_url(text)
    assert out is not None
    assert "douyin.com" in out
