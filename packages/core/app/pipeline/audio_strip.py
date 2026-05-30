"""[2] 원본 사운드 제거.

도우인 영상의 중국어 음성/BGM을 제거해 무음 영상으로 만든다.
이후 [5]에서 한국어 TTS를 새로 입힌다.

구현: ffmpeg -an (오디오 트랙 제거).
난이도: 쉬움.
"""
import subprocess
from pathlib import Path

from app.config import FFMPEG


def strip_audio(video_path: Path, out_path: Path) -> Path:
    """영상에서 오디오 트랙 제거 → 무음 mp4."""
    video_path, out_path = Path(video_path), Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        FFMPEG, "-y", "-i", str(video_path),
        "-an",                  # 오디오 제거
        "-c:v", "copy",         # 영상 재인코딩 없이 복사 (빠름)
        str(out_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return out_path
