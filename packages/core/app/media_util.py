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


_RAISE = object()   # probe_duration 실패 시 예외 전파를 뜻하는 센티넬


def probe_duration(path, default=_RAISE) -> float:
    """미디어 길이(초). default=_RAISE(기본)면 실패 시 예외 전파, 아니면 default 반환.

    compose(raise) / face_cut(0.0) / server_api(None) 각각의 원래 실패 동작을 보존.
    """
    try:
        r = subprocess.run(
            [FFPROBE, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, check=(default is _RAISE))
        return float((r.stdout or "").strip())
    except Exception:
        if default is _RAISE:
            raise
        return default


def has_audio(path, default: bool = True) -> bool:
    """오디오 스트림 존재 여부. 실패 시 default 반환(transcribe=True / face_cut=False)."""
    try:
        r = subprocess.run(
            [FFPROBE, "-v", "error", "-select_streams", "a",
             "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True)
        return bool((r.stdout or "").strip())
    except Exception:
        return default
