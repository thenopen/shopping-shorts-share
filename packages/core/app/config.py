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

# CTA 자막(compose.py drawtext) 기본 폰트.
# 번들된 Pretendard.ttf 를 쓴다 — Windows/macOS/Linux 모두 같은 경로(플랫폼 분기 불필요).
# 과거 "C:/Windows/Fonts/malgun.ttf" 하드코딩은 macOS/Linux에서 폰트를 못 찾아 CTA가 깨졌음.
# caption.py(본문 자막, ASS)의 기본 폰트명("Pretendard")과 동일 파일 → 시각적 통일.
DEFAULT_FONT = str(BACKEND_ROOT / "assets" / "fonts" / "Pretendard.ttf")
