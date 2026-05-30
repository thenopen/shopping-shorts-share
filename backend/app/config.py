"""전역 설정 / 경로."""
from pathlib import Path

# backend/ 루트
BACKEND_ROOT = Path(__file__).resolve().parent.parent
WORKDIR = BACKEND_ROOT / "workdir"
WORKDIR.mkdir(exist_ok=True)

# 출력 규격
TARGET_W = 1080
TARGET_H = 1920  # 9:16 세로 쇼츠

# 기본 한국어 TTS 보이스 (edge-tts, 무료)
DEFAULT_VOICE = "ko-KR-SunHiNeural"   # 여성
VOICE_MALE = "ko-KR-InJoonNeural"     # 남성

# ffmpeg 실행파일 (PATH에 있으면 그대로)
FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"
