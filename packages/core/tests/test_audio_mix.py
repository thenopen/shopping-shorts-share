"""audio_mix.py 단위 테스트 — build_mix_args 인자 빌드 로직 검증.

실제 ffmpeg 실행은 안 함(브라우저/CI 환경 의존). 대신 build_mix_args() 가
BGM/SFX 유무에 따라 올바른 ffmpeg 인자를 조립하는지, no-op 조건이 정확한지 검증.
믹싱 품질(실제 오디오)은 수동/통합 테스트 범위.
"""
from pathlib import Path

import pytest

from app.pipeline.audio_mix import build_mix_args, mix_audio


def test_no_bgm_no_sfx_returns_none(tmp_path: Path):
    """BGM/SFX 둘 다 없으면 None(믹싱 불필요)."""
    voice = tmp_path / "v.mp3"
    voice.write_text("x")
    assert build_mix_args(voice, tmp_path / "out.mp3") is None


def test_bgm_nonexistent_returns_none(tmp_path: Path):
    """BGM 경로가 있지만 파일이 없으면 None."""
    voice = tmp_path / "v.mp3"
    voice.write_text("x")
    assert build_mix_args(voice, tmp_path / "out.mp3", bgm_path=tmp_path / "nope.mp3") is None


def test_bgm_present_builds_amix_args(tmp_path: Path):
    """BGM 파일이 있으면 ffmpeg 인자에 -stream_loop + filter_complex amix 포함."""
    voice = tmp_path / "v.mp3"
    bgm = tmp_path / "b.mp3"
    voice.write_text("v"); bgm.write_text("b")
    args = build_mix_args(voice, tmp_path / "out.mp3", bgm_path=bgm, bgm_volume=0.25, duration=10.0)
    assert args is not None
    args_str = " ".join(args)
    assert "-stream_loop" in args and "-1" in args
    assert "filter_complex" in args_str
    assert "amix=inputs=2" in args_str
    assert "volume=0.25" in args_str
    assert "afade=t=in:st=0:d=0.5" in args_str
    # duration 있으면 아웃트로 페이드도
    assert "afade=t=out" in args_str
    assert "libmp3lame" in args_str


def test_bgm_volume_clamped(tmp_path: Path):
    """볼륨이 0~1 범위 벗어나면 클램프."""
    voice = tmp_path / "v.mp3"; bgm = tmp_path / "b.mp3"
    voice.write_text("v"); bgm.write_text("b")
    args = build_mix_args(voice, tmp_path / "o.mp3", bgm_path=bgm, bgm_volume=1.5)
    assert "volume=1.00" in " ".join(args)
    args2 = build_mix_args(voice, tmp_path / "o.mp3", bgm_path=bgm, bgm_volume=-0.5)
    assert "volume=0.00" in " ".join(args2)


def test_sfx_adds_adelay_inputs(tmp_path: Path):
    """SFX 리스트가 있으면 adelay + amix inputs=3(voice+bgm+sfx)."""
    voice = tmp_path / "v.mp3"; bgm = tmp_path / "b.mp3"; sfx1 = tmp_path / "s1.mp3"
    voice.write_text("v"); bgm.write_text("b"); sfx1.write_text("s")
    args = build_mix_args(voice, tmp_path / "o.mp3", bgm_path=bgm,
                          sfx=[(sfx1, 2.5)], duration=10.0)
    assert args is not None
    s = " ".join(args)
    assert "adelay=2500|2500" in s   # 2.5초 = 2500ms
    assert "amix=inputs=3" in s


def test_sfx_nonexistent_filtered(tmp_path: Path):
    """존재하지 않는 SFX 파일은 무시됨."""
    voice = tmp_path / "v.mp3"; voice.write_text("v")
    args = build_mix_args(voice, tmp_path / "o.mp3", sfx=[(tmp_path / "no.mp3", 1.0)])
    # BGM도 없고 유효 SFX도 없으면 None
    assert args is None


def test_mix_audio_noop_copies_voice(tmp_path: Path):
    """믹싱 불필요 시 voice 를 out 으로 복사."""
    voice = tmp_path / "v.mp3"; voice.write_text("voice-content")
    out = tmp_path / "out.mp3"
    result = mix_audio(voice, out)
    assert result == out
    assert out.read_text() == "voice-content"
    assert out.exists()


def test_mix_audio_noop_same_path(tmp_path: Path):
    """voice==out 이면 복사도 안 함(자기 자신)."""
    voice = tmp_path / "v.mp3"; voice.write_text("x")
    result = mix_audio(voice, voice)
    assert result == voice
    assert voice.exists()
