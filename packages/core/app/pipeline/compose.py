"""[6] 최종 합성 — ffmpeg로 영상+더빙+자막+CTA를 9:16 쇼츠로 머지."""
import subprocess
from pathlib import Path

from app.config import FFMPEG, FFPROBE, TARGET_W, TARGET_H, DEFAULT_FONT


def _ff_path(p: str) -> str:
    """ffmpeg 필터 인자용 경로 이스케이프 (윈도우 콜론 문제)."""
    return p.replace("\\", "/").replace(":", "\\:")


def _probe_duration(path: Path) -> float:
    """미디어 길이(초)."""
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def _escape_drawtext(s: str) -> str:
    """ffmpeg drawtext용 이스케이프."""
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’")


def compose(
    video_path: Path,
    audio_path: Path | None,
    out_path: Path,
    cta_text: str | None = None,
    replace_audio: bool = True,
) -> Path:
    """영상 + (선택)더빙오디오 + (선택)CTA자막 → 9:16 mp4.

    replace_audio=True: 원본 음성을 더빙으로 교체.
    cta_text: 화면 하단 고정 CTA 문구.
    """
    video_path, out_path = Path(video_path), Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # 9:16 변환: 가운데 크롭 후 스케일. 비율 안 맞으면 패딩.
    vf = (
        f"scale={TARGET_W}:{TARGET_H}:force_original_aspect_ratio=increase,"
        f"crop={TARGET_W}:{TARGET_H}"
    )
    if cta_text:
        txt = _escape_drawtext(cta_text)
        font = _ff_path(DEFAULT_FONT)
        vf += (
            f",drawtext=fontfile='{font}':text='{txt}':fontcolor=white:fontsize=56:"
            f"borderw=4:bordercolor=black:x=(w-text_w)/2:y=h-220"
        )

    cmd = [FFMPEG, "-y", "-i", str(video_path)]
    if audio_path:
        cmd += ["-i", str(audio_path)]

    cmd += ["-vf", vf]

    if audio_path and replace_audio:
        # 더빙 오디오로 교체, 영상길이에 맞춤
        cmd += ["-map", "0:v:0", "-map", "1:a:0", "-shortest"]
    elif audio_path and not replace_audio:
        cmd += ["-map", "0:v:0", "-map", "1:a:0"]

    cmd += [
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-pix_fmt", "yuv420p",
        str(out_path),
    ]

    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg compose 실패 (code {r.returncode}):\n{r.stderr[-1500:]}")
    return out_path
