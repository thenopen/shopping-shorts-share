"""Global settings and paths."""

import glob
import os
import shutil
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
WORKDIR = BACKEND_ROOT / "workdir"
WORKDIR.mkdir(exist_ok=True)

TARGET_W = 1080
TARGET_H = 1920

DEFAULT_VOICE = "ko-KR-SunHiNeural"
VOICE_MALE = "ko-KR-InJoonNeural"


def _resolve_ff(name: str) -> str:
    """ffmpeg/ffprobe를 절대경로로 해석.

    서버를 어떤 셸에서 띄우든(=프로세스 PATH에 ffmpeg가 없어도) bare 호출이
    WinError 2로 깨지지 않게: PATH 우선 → winget Gyan.FFmpeg 설치경로 폴백 →
    그래도 없으면 bare 이름(PATH 등록된 다른 머신 대비).
    """
    found = shutil.which(name)
    if found:
        return found
    base = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages")
    hits = glob.glob(os.path.join(base, "Gyan.FFmpeg*", "**", "bin", f"{name}.exe"),
                     recursive=True)
    if hits:
        return hits[0]
    return name


FFMPEG = _resolve_ff("ffmpeg")
FFPROBE = _resolve_ff("ffprobe")

DEFAULT_FONT = "C:/Windows/Fonts/malgun.ttf"
