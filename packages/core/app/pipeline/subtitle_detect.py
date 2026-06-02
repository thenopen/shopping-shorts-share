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
    full_frame: bool = False,
    require_center: bool = False,
) -> list[dict]:
    """Return [{start, end, box}] for likely Chinese subtitle/overlay text regions.

    full_frame=True  : 하단제한 풀고 화면 전체 OCR(워터마크 아이디·상단 텍스트 등 모든 중국어).
    require_center   : 가로 중앙정렬 + 글자높이 필터로 상품패키지/배경 한자 오검출 줄임(자막 한정).
    """
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
    y_off = 0 if full_frame else int(height * bottom_ratio)

    hits: list[tuple[float, float, float, float, float]] = []
    sec = 0.0
    while sec < duration:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(sec * fps))
        ok, frame = cap.read()
        if ok:
            crop = frame if full_frame else frame[y_off:, :]
            # 자막제거는 글자 '위치'만 필요(내용 무관) → recall 우선 파라미터.
            # text_threshold/low_text 낮춰 흰색·저대비 글자도 검출, mag_ratio로 작은 라벨 업스케일.
            ocr_results = reader.readtext(
                crop, detail=1, paragraph=False,
                text_threshold=0.4, low_text=0.3, link_threshold=0.3,
                mag_ratio=1.5, min_size=8,
            )
            for bbox, text, conf in ocr_results:
                # 중국어뿐 아니라 화면에 박힌 모든 자막을 제거 대상으로(언어 무관).
                # easyocr이 흰자막에 conf≈0 주므로 conf 필터는 안 함. 텍스트 박스가 잡히면 후보.
                # 과제거(상품 패키지/배경 글자)는 아래 지오메트리(require_center)·시간지속으로 거른다.
                txt = (text or "").strip()
                if not txt:
                    continue
                xs = [p[0] for p in bbox]
                ys = [p[1] + y_off for p in bbox]
                x0, x1 = min(xs), max(xs)
                y0, y1 = min(ys), max(ys)
                if require_center:
                    cx = (x0 + x1) / 2
                    bh = y1 - y0
                    bw = x1 - x0
                    # 가로 중앙 ±35%, 글자높이 화면 1.8~12%, 가로로 긴 모양만 = 자막 특징
                    if not (0.15 * width <= cx <= 0.85 * width):
                        continue
                    if not (0.018 * height <= bh <= 0.12 * height):
                        continue
                    if bw < bh * 0.8:
                        continue
                hits.append((sec, x0, y0, x1, y1))
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
