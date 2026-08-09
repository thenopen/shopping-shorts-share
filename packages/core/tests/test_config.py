"""config.py 단위 테스트 — 경로·폰트 크로스플랫폼 정합성.

DEFAULT_FONT 가 번들 폰트를 가리키고 실제 존재하는지 검증(macOS 대응 회귀 방지).
FFMPEG/FFPROBE 해석이 bare 이름이라도 문자열을 반환하는지(환경 의존 최소).
"""
from pathlib import Path

from app.config import BACKEND_ROOT, DEFAULT_FONT, FFMPEG, FFPROBE, TARGET_H, TARGET_W, WORKDIR


def test_default_font_is_bundled_pretendard():
    """DEFAULT_FONT는 BACKEND_ROOT/assets/fonts/Pretendard.ttf (Windows 하드코딩 제거 검증)."""
    p = Path(DEFAULT_FONT)
    assert p.name == "Pretendard.ttf"
    # BACKEND_ROOT 하위인지(탈출 방지)
    try:
        p.resolve().relative_to(BACKEND_ROOT.resolve())
    except ValueError:
        assert False, f"DEFAULT_FONT({p})가 BACKEND_ROOT({BACKEND_ROOT}) 밖을 가리킴"
    # macOS에서 "C:/Windows/..." 경로가 아님(과거 하드코딩 회귀 감지)
    assert "C:" not in DEFAULT_FONT and "Windows" not in DEFAULT_FONT


def test_default_font_exists():
    """번들 폰트가 실제 존재하는지(레포 누락/이동 감지)."""
    assert Path(DEFAULT_FONT).exists(), f"폰트 파일 없음: {DEFAULT_FONT}"


def test_ffmpeg_resolved_to_string():
    """FFMPEG/FFPROBE는 항상 문자열(PATH 또는 WinGet 폴백 또는 bare 이름)."""
    assert isinstance(FFMPEG, str) and FFMPEG
    assert isinstance(FFPROBE, str) and FFPROBE


def test_target_resolution_is_9_16():
    """출력 해상도 1080x1920(9:16 세로 쇼츠)."""
    assert TARGET_W == 1080
    assert TARGET_H == 1920
    assert TARGET_W * 16 == TARGET_H * 9   # 9:16 비율


def test_workdir_under_backend_root():
    """WORKDIR는 BACKEND_ROOT/workdir (스키마·토큰·job 파일 위치)."""
    assert WORKDIR == BACKEND_ROOT / "workdir"
    assert WORKDIR.exists()
