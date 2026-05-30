"""Global settings and paths."""

from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
WORKDIR = BACKEND_ROOT / "workdir"
WORKDIR.mkdir(exist_ok=True)

TARGET_W = 1080
TARGET_H = 1920

DEFAULT_VOICE = "ko-KR-SunHiNeural"
VOICE_MALE = "ko-KR-InJoonNeural"

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"

DEFAULT_FONT = "C:/Windows/Fonts/malgun.ttf"
