"""app.security.safe_path 단위 테스트 — path traversal 가드.

Phase 2 에서 /file, /overlays/asset, overlays.resolve_file 세 곳을 통일한 가드.
정상 경로는 통과, traversal/비정상 세그먼트는 None 반환을 검증한다.
"""
from pathlib import Path

from app.security import SAFE_SEG, safe_path


def test_safe_seg_allows_korean_and_alnum():
    """한글(성우명 등)·영숫자·언더바는 허용."""
    assert SAFE_SEG.match("abc123")
    assert SAFE_SEG.match("하은")
    assert SAFE_SEG.match("job_a1")
    assert SAFE_SEG.match("preview.mp3")


def test_safe_seg_rejects_path_separators_and_control():
    """슬래시/역슬래시/공백/제어문자는 세그먼트에서 배제(경로 분리 방지)."""
    assert not SAFE_SEG.match("a/b")
    assert not SAFE_SEG.match("a\\b")
    assert not SAFE_SEG.match("a b")
    assert not SAFE_SEG.match("a\tb")
    assert not SAFE_SEG.match("a\x00b")


def test_safe_path_normal(tmp_path: Path):
    """base 하위 정상 파일 → resolved Path 반환."""
    f = tmp_path / "x.mp4"
    f.write_text("x")
    out = safe_path(tmp_path, "x.mp4")
    assert out == f.resolve()
    assert out.exists()


def test_safe_path_nested_segments(tmp_path: Path):
    """다중 세그먼트(overlays/asset 용) 정상 동작."""
    sub = tmp_path / "sub"
    sub.mkdir()
    f = sub / "y.png"
    f.write_text("y")
    out = safe_path(tmp_path, "sub", "y.png")
    assert out == f.resolve()


def test_safe_path_parent_traversal_returns_none(tmp_path: Path):
    """'..' 세그먼트 → None (SAFE_SEG 또는 is_relative_to 가 잡음)."""
    (tmp_path.parent).exists()  # base 밖이 존재하더라도
    assert safe_path(tmp_path, "..", "secret") is None
    # 단일 세그먼트 ".." 자체도 SAFE_SEG 통과하지만 ".." 검사에서 걸림
    assert safe_path(tmp_path, "..") is None


def test_safe_path_absolute_segment_returns_none(tmp_path: Path):
    """절대경로 세그먼트(/etc/passwd) → '/' 가 들어가 SAFE_SEG 거절."""
    assert safe_path(tmp_path, "/etc/passwd") is None


def test_safe_path_nonexistent_must_exist(tmp_path: Path):
    """기본(must_exist=True): 없는 파일 → None."""
    assert safe_path(tmp_path, "nope.mp4") is None


def test_safe_path_nonexistent_allow_missing(tmp_path: Path):
    """must_exist=False: 없어도 resolved 경로 반환(base 안이면)."""
    out = safe_path(tmp_path, "will_be.mp4", must_exist=False)
    assert out is not None
    assert out.is_relative_to(tmp_path.resolve())
    assert not out.exists()


def test_safe_path_none_segment_returns_none(tmp_path: Path):
    assert safe_path(tmp_path, None) is None   # type: ignore[arg-type]


def test_safe_path_resolves_symlink_escape(tmp_path: Path):
    """base 안의 심볼릭 링크가 base 밖을 가리켜도 is_relative_to 가 잡는지(resolve 기반).
    단, resolve() 는 링크를 따라가므로 최종 타깃이 base 밖이면 None 이어야 한다."""
    target = tmp_path.parent / "outside_secret.txt"
    target.write_text("secret")
    try:
        link = tmp_path / "link.txt"
        try:
            link.symlink_to(target)
        except (OSError, NotImplementedError):
            # 심볼릭 링크 생성 불가 환경(권한/Windows)이면 이 케이스는 스킵.
            return
        # 링크의 resolved 타깃이 base 밖 → None.
        assert safe_path(tmp_path, "link.txt") is None
    finally:
        try: target.unlink()
        except FileNotFoundError: pass
