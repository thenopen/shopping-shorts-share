"""[4] 얼굴 전체샷 컷 제거.

요구사항: 사람 얼굴이 화면에 크게 잡힌 구간을 잘라내고,
제품샷 위주의 구간만 남겨 재연결한다.
(원본 인물이 그대로 드러나는 걸 피하려는 목적)

전략(구현):
  1. OpenCV Haar cascade로 프레임(샘플) 얼굴 탐지 — mediapipe 미설치 환경에서도 동작(추가 의존성 0).
  2. 가장 큰 얼굴 bbox 높이가 프레임 높이 대비 face_ratio_threshold 이상이면 "전체샷" 판정.
  3. 전체샷이 연속된 시간구간을 "잘라낼 구간"으로 묶음(짧은 깜빡임 제거·가까운 구간 병합).
  4. 남길 구간(=전체-잘라낼구간)만 ffmpeg trim+concat으로 이어붙임.

주의:
- 너무 많이 자르면 영상이 짧아짐 → 남길 길이가 min_output_sec 미만이면 컷 생략(원본 유지).
- 얼굴 미검출/탐지실패 시에도 안전하게 원본을 그대로 통과(파이프라인 안 끊김).
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import cv2

from app.config import FFMPEG
from app.media_util import probe_duration, has_audio
from app.pipeline.subtitle_inpaint import _resolve_ffmpeg

_cascade = None


def _get_cascade():
    """정면 얼굴 Haar cascade(싱글톤). cv2에 기본 동봉."""
    global _cascade
    if _cascade is None:
        path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        _cascade = cv2.CascadeClassifier(path)
    return _cascade


def _probe_duration(path) -> float:
    return probe_duration(path, default=0.0)


def _has_audio(path) -> bool:
    return has_audio(path, default=False)


def detect_face_segments(video_path: Path, face_ratio_threshold: float = 0.25,
                         interval_sec: float = 0.5, min_face_dur: float = 0.8,
                         merge_gap: float = 0.6):
    """얼굴이 크게 잡힌 시간구간 리스트 반환.

    Returns: [(start_sec, end_sec), ...]  ← 잘라낼 구간

    interval_sec 간격으로 프레임을 샘플해 Haar 얼굴탐지. 가장 큰 얼굴의
    (높이/프레임높이) 비율이 face_ratio_threshold 이상이면 '전체샷'으로 표시.
    연속 전체샷을 구간으로 묶고, min_face_dur 미만 깜빡임은 버리며,
    merge_gap 이내로 가까운 구간은 하나로 합친다.
    """
    video_path = Path(video_path)
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if fps <= 0:
        fps = 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1
    duration = (total / fps) if total else 0.0
    cascade = _get_cascade()
    step = max(1, int(round(interval_sec * fps)))
    min_face_px = max(24, int(H * 0.08))

    samples: list[tuple[float, bool]] = []
    idx = 0
    last_t = 0.0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if idx % step == 0:
                t = idx / fps
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                gray = cv2.equalizeHist(gray)
                faces = cascade.detectMultiScale(
                    gray, scaleFactor=1.1, minNeighbors=5,
                    minSize=(min_face_px, min_face_px),
                )
                big = any((fh / H) >= face_ratio_threshold for (_x, _y, _w, fh) in faces)
                samples.append((t, big))
                last_t = t
            idx += 1
    finally:
        cap.release()
    if duration <= 0:
        duration = (idx / fps) if idx else last_t

    # 연속 True(전체샷) 구간 묶기
    segs: list[tuple[float, float]] = []
    seg_start = None
    prev_t = 0.0
    for (t, big) in samples:
        if big and seg_start is None:
            seg_start = t
        elif not big and seg_start is not None:
            segs.append((seg_start, prev_t + interval_sec))
            seg_start = None
        prev_t = t
    if seg_start is not None:
        segs.append((seg_start, duration or (prev_t + interval_sec)))

    # 짧은 구간 제거 → 가까운 구간 병합
    segs = [(s, min(e, duration) if duration else e) for (s, e) in segs
            if (e - s) >= min_face_dur]
    merged: list[tuple[float, float]] = []
    for s, e in segs:
        if merged and s - merged[-1][1] <= merge_gap:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))
    return merged


def cut_face_segments(video_path: Path, out_path: Path,
                      face_ratio_threshold: float = 0.25,
                      min_output_sec: float = 5.0) -> Path:
    """얼굴 전체샷 구간을 제거하고 나머지를 이어붙인다.

    흐름:
      1. detect_face_segments로 잘라낼 구간 파악
      2. '남길 구간' = 전체길이 - 잘라낼구간
      3. ffmpeg trim+concat(filter_complex)으로 재조립(오디오 있으면 함께)
      4. 결과가 min_output_sec보다 짧으면 컷 생략(원본 유지)

    어떤 이유로든(얼굴 미검출·탐지실패·과도한 컷) 컷할 게 없으면 원본을 out_path로 복사해
    파이프라인이 끊기지 않게 한다.
    """
    video_path, out_path = Path(video_path), Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    duration = _probe_duration(video_path)
    cut_segs = []
    try:
        cut_segs = detect_face_segments(video_path, face_ratio_threshold=face_ratio_threshold)
    except Exception as e:
        print(f"  [face_cut 탐지 실패, 원본 유지: {str(e)[:120]}]")
        cut_segs = []

    if not cut_segs or duration <= 0:
        print("  [face_cut] 잘라낼 얼굴 전체샷 없음 → 원본 유지")
        shutil.copy(str(video_path), str(out_path))
        return out_path

    # 남길 구간 = 전체에서 잘라낼 구간 제외
    keep: list[tuple[float, float]] = []
    cur = 0.0
    for s, e in cut_segs:
        s = max(0.0, s)
        e = min(duration, e)
        if s > cur + 0.05:
            keep.append((cur, s))
        cur = max(cur, e)
    if cur < duration - 0.05:
        keep.append((cur, duration))
    keep = [(s, e) for (s, e) in keep if (e - s) >= 0.4]

    keep_total = sum(e - s for s, e in keep)
    if not keep or keep_total < min_output_sec:
        print(f"  [face_cut] 남길 구간이 너무 짧음({keep_total:.1f}s < {min_output_sec}s) → 원본 유지")
        shutil.copy(str(video_path), str(out_path))
        return out_path

    has_audio = _has_audio(video_path)
    parts: list[str] = []
    for i, (s, e) in enumerate(keep):
        parts.append(f"[0:v]trim=start={s:.3f}:end={e:.3f},setpts=PTS-STARTPTS[v{i}]")
        if has_audio:
            parts.append(f"[0:a]atrim=start={s:.3f}:end={e:.3f},asetpts=PTS-STARTPTS[a{i}]")
    concat_in = ""
    for i in range(len(keep)):
        concat_in += f"[v{i}]"
        if has_audio:
            concat_in += f"[a{i}]"
    if has_audio:
        parts.append(f"{concat_in}concat=n={len(keep)}:v=1:a=1[outv][outa]")
    else:
        parts.append(f"{concat_in}concat=n={len(keep)}:v=1:a=0[outv]")
    filtergraph = ";".join(parts)

    ffmpeg_exe = _resolve_ffmpeg()
    cmd = [ffmpeg_exe, "-hide_banner", "-y", "-i", str(video_path.resolve()),
           "-filter_complex", filtergraph, "-map", "[outv]"]
    if has_audio:
        cmd += ["-map", "[outa]", "-c:a", "aac", "-b:a", "128k"]
    cmd += ["-c:v", "libx264", "-preset", "fast", "-crf", "18",
            "-pix_fmt", "yuv420p", str(out_path.resolve())]

    proc = subprocess.run(cmd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        # 컷 실패해도 파이프라인은 살림 — 원본 복사로 폴백.
        print(f"  [face_cut ffmpeg 실패, 원본 유지: {(proc.stderr or '')[-300:]}]")
        shutil.copy(str(video_path), str(out_path))
        return out_path

    print(f"  [face_cut] 얼굴 전체샷 {len(cut_segs)}구간 제거 → {len(keep)}조각 재연결 "
          f"({duration:.1f}s → {keep_total:.1f}s)")
    return out_path
