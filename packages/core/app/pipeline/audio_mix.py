"""[7] BGM + 효과음 믹싱.

요구사항: 더빙된 TTS 음성 위에 배경음악(BGM)과 효과음(SFX)을 깔기.

소스: assets/bgm/, assets/sfx/ 의 무료 음원.

흐름:
  TTS 음성 (메인) + BGM (낮은 볼륨) + SFX (특정 시점) → ffmpeg amix
  - TTS는 또렷하게 (볼륨 100%)
  - BGM은 배경으로 (볼륨 15~25%), 영상길이에 맞춰 루프/페이드
  - SFX는 특정 타이밍에 1회 (선택)

난이도: 중.
"""
from pathlib import Path


def mix_audio(
    voice_path: Path,
    out_path: Path,
    bgm_path: Path | None = None,
    bgm_volume: float = 0.2,
    sfx: list | None = None,        # [(sfx_path, at_sec), ...]
    duration: float | None = None,
) -> Path:
    """TTS 음성 + BGM + 효과음 → 믹싱된 오디오 트랙.

    TODO: ffmpeg amix/adelay/volume 필터 체인.
    TODO: BGM 영상길이 맞춤(loop + atrim + afade).
    """
    raise NotImplementedError("Phase 2에서 구현")
