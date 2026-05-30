"""Remove Chinese subtitles using ffmpeg delogo."""

from __future__ import annotations

import subprocess
from pathlib import Path

import cv2

from app.config import FFMPEG


def remove_subtitle_segments(video_path: Path, out_path: Path, segments: list[dict]) -> Path:
    video_path, out_path = Path(video_path), Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if not segments:
        return remove_subtitle(video_path, out_path, use_ocr=False)

    width, height = _video_size(video_path)
    filters = []
    for seg in segments:
        x, y, w, h = _clamp_box(seg["box"], width, height)
        enable = f"between(t,{float(seg['start'])},{float(seg['end'])})"
        filters.append(_delogo_filter(x, y, w, h, enable=enable))
    return _run_delogo(video_path, out_path, ",".join(filters))


def remove_subtitle(
    video_path: Path,
    out_path: Path,
    use_ocr: bool = True,
    band_height_ratio: float = 0.16,
) -> Path:
    video_path, out_path = Path(video_path), Path(out_path)
    width, height = _video_size(video_path)

    box = None
    if use_ocr:
        try:
            box = detect_subtitle_region(video_path)
        except Exception as e:
            print(f"  [subtitle OCR failed, bottom fallback: {str(e)[:100]}]")

    if box is None:
        band_h = max(24, int(height * band_height_ratio))
        box = (0, height - band_h, width, band_h)
        print(f"  [subtitle fallback box: {box}]")
    else:
        print(f"  [subtitle OCR box: {box}]")

    return remove_subtitle_delogo(video_path, out_path, box)


def remove_subtitle_delogo(video_path: Path, out_path: Path, box: tuple[int, int, int, int]) -> Path:
    width, height = _video_size(video_path)
    x, y, w, h = _clamp_box(box, width, height)
    return _run_delogo(Path(video_path), Path(out_path), _delogo_filter(x, y, w, h))


def detect_subtitle_region(
    video_path: Path,
    samples: int = 12,
    bottom_only: bool = True,
) -> tuple[int, int, int, int] | None:
    from app.pipeline.ocr import get_reader

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video for OCR: {video_path}")

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    reader = get_reader()
    boxes = []
    for i in range(samples):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * (i + 0.5) / samples))
        ok, frame = cap.read()
        if not ok:
            continue
        for bbox, _text, conf in reader.readtext(frame):
            if conf < 0.2:
                continue
            xs = [p[0] for p in bbox]
            ys = [p[1] for p in bbox]
            x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
            if bottom_only and (y0 + y1) / 2 < height * 0.4:
                continue
            boxes.append((x0, y0, x1, y1))
    cap.release()

    if not boxes:
        return None

    x0 = max(0, int(min(b[0] for b in boxes)) - 8)
    y0 = max(0, int(min(b[1] for b in boxes)) - 8)
    x1 = min(width, int(max(b[2] for b in boxes)) + 8)
    y1 = min(height, int(max(b[3] for b in boxes)) + 8)
    return (x0, y0, x1 - x0, y1 - y0)


def remove_subtitle_bottom(video_path, out_path, mode="bar", **_kw):
    return remove_subtitle(video_path, out_path, use_ocr=False)


def _video_size(path: Path) -> tuple[int, int]:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {path}")
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    if width <= 0 or height <= 0:
        raise RuntimeError(f"Cannot read video size: {path}")
    return width, height


def _delogo_filter(x: int, y: int, w: int, h: int, enable: str | None = None) -> str:
    filt = f"delogo=x={x}:y={y}:w={w}:h={h}:show=0"
    if enable:
        filt += f":enable='{enable}'"
    return filt


def _clamp_box(box: tuple[int, int, int, int], width: int, height: int) -> tuple[int, int, int, int]:
    x, y, w, h = [int(v) for v in box]
    x = max(1, min(x, width - 3))
    y = max(1, min(y, height - 3))
    w = max(1, min(w, width - x - 1))
    h = max(1, min(h, height - y - 1))
    return x, y, w, h


def _run_delogo(video_path: Path, out_path: Path, vf: str) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [FFMPEG, "-y", "-i", str(video_path), "-vf", vf, "-c:a", "copy", str(out_path)]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg delogo failed:\n{r.stderr[-1200:]}")
    return out_path
