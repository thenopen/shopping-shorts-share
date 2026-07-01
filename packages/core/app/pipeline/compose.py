"""[6] 최종 합성 — ffmpeg로 영상+더빙+자막+CTA를 9:16 쇼츠로 머지."""
import subprocess
from pathlib import Path

from app.config import FFMPEG, TARGET_W, TARGET_H, DEFAULT_FONT
from app.media_util import probe_duration


def _ff_path(p: str) -> str:
    """ffmpeg 필터 인자용 경로 이스케이프 (윈도우 콜론 문제)."""
    return p.replace("\\", "/").replace(":", "\\:")


def _probe_duration(path: Path) -> float:
    """미디어 길이(초). 실패 시 예외 전파(기존 check=True 동작)."""
    return probe_duration(path)


def _escape_drawtext(s: str) -> str:
    """ffmpeg drawtext용 이스케이프."""
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’")


def compose(
    video_path: Path,
    audio_path: Path | None,
    out_path: Path,
    cta_text: str | None = None,
    replace_audio: bool = True,
    cta_size: int = 56,
    cta_pos: float = 0.88,
) -> Path:
    """영상 + (선택)더빙오디오 + (선택)CTA자막 → 9:16 mp4.

    replace_audio=True: 원본 음성을 더빙으로 교체.
    cta_text: CTA 문구. cta_size: 글자 크기(px). cta_pos: 세로 위치(0=맨위~1=맨아래).
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
        sz = max(12, int(cta_size))
        bw = max(2, sz // 14)
        # cta_pos: 0=맨위~1=맨아래. 글자높이 고려해 화면 안에 들어오게 클램프.
        pos = min(0.98, max(0.02, float(cta_pos)))
        vf += (
            f",drawtext=fontfile='{font}':text='{txt}':fontcolor=white:fontsize={sz}:"
            f"borderw={bw}:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)*{pos}"
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

    if audio_path:
        # 깨끗한 리샘플(48kHz) — 샘플레이트 불일치/지직 방지
        cmd += ["-af", "aresample=async=1:first_pts=0:osr=48000"]

    cmd += [
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-pix_fmt", "yuv420p",
        str(out_path),
    ]

    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg compose 실패 (code {r.returncode}):\n{r.stderr[-1500:]}")
    return out_path
