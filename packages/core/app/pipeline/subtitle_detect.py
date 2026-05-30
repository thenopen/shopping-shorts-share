"""Detect Chinese subtitle boxes over time."""

from __future__ import annotations

import re
from pathlib import Path

import cv2

CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")


def _has_chinese(text: str) -> bool:
    return bool(CJK.search(text or ""))


def detect_segments(
    video_path: str | Path,
    interval_sec: float = 1.0,
    conf_min: float = 0.0,
    bottom_ratio: float = 0.4,
    y_merge_tol: int = 80,
    time_gap: float = 2.0,
    pad: int = 10,
) -> list[dict]:
    """Return [{start, end, box}] for likely Chinese subtitle regions."""
    from app.pipeline.ocr import get_reader
    reader = get_reader()   # GPU 자동 + 캐싱
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video for OCR: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration = total / fps
    y_off = int(height * bottom_ratio)

    hits: list[tuple[float, float, float, float, float]] = []
    sec = 0.0
    while sec < duration:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(sec * fps))
        ok, frame = cap.read()
        if ok:
            crop = frame[y_off:, :]
            for bbox, text, conf in reader.readtext(crop):
                # 자막제거는 글자 위치만 필요(텍스트 정확도 불필요). easyocr이 흰자막에
                # conf≈0을 주므로 conf 필터하면 자막 다 놓침 → conf_min=0, 중국어 글자 유무로만 판정.
                if conf < conf_min or not _has_chinese(text):
                    continue
                xs = [p[0] for p in bbox]
                ys = [p[1] + y_off for p in bbox]
                hits.append((sec, min(xs), min(ys), max(xs), max(ys)))
        sec += interval_sec
    cap.release()

    if not hits:
        return []

    hits.sort(key=lambda h: ((h[2] + h[4]) / 2, h[0]))
    clusters: list[list[tuple[float, float, float, float, float]]] = []
    for hit in hits:
        yc = (hit[2] + hit[4]) / 2
        for cluster in clusters:
            cyc = sum((h[2] + h[4]) / 2 for h in cluster) / len(cluster)
            if abs(yc - cyc) <= y_merge_tol:
                cluster.append(hit)
                break
        else:
            clusters.append([hit])

    segments: list[dict] = []
    for cluster in clusters:
        cluster.sort(key=lambda h: h[0])
        run = [cluster[0]]
        for hit in cluster[1:]:
            if hit[0] - run[-1][0] <= time_gap + interval_sec:
                run.append(hit)
            else:
                segments.append(_box_from_run(run, width, height, pad, interval_sec))
                run = [hit]
        segments.append(_box_from_run(run, width, height, pad, interval_sec))

    segments.sort(key=lambda s: s["start"])
    return segments


def _box_from_run(run, width: int, height: int, pad: int, interval: float) -> dict:
    x0 = max(1, int(min(h[1] for h in run)) - pad)
    y0 = max(1, int(min(h[2] for h in run)) - pad)
    x1 = min(width - 1, int(max(h[3] for h in run)) + pad)
    y1 = min(height - 1, int(max(h[4] for h in run)) + pad)
    return {
        "start": round(max(0.0, run[0][0] - interval), 2),
        "end": round(run[-1][0] + interval, 2),
        "box": (x0, y0, x1 - x0, y1 - y0),
    }
