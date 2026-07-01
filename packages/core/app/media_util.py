"""ffmpeg/ffprobe 공용 헬퍼 — 여러 모듈이 복붙하던 것 통합.

behavior-preserving: 각 호출부의 원래 실패 동작(예외 raise / 기본값 반환)을
default 파라미터로 그대로 재현한다.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from app.config import FFMPEG, FFPROBE


def grab_frame(inp, out, t=1) -> bool:
    """영상 t초 지점에서 프레임 1장 뽑아 out에 저장(가로 360 스케일). 성공 여부 반환."""
    try:
        subprocess.run(
            [FFMPEG, "-hide_banner", "-y", "-ss", str(t), "-i", str(inp),
             "-frames:v", "1", "-vf", "scale=360:-2", str(out)],
            capture_output=True, text=True, timeout=60)
    except Exception:
        pass
    return Path(out).exists()
