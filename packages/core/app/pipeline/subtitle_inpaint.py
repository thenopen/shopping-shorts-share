"""Chinese subtitle removal via simple-lama inpainting.

detect boxes -> per-frame mask -> lama inpaint -> reassemble. GPU auto, free.
"""
import subprocess
from pathlib import Path

import cv2
import numpy as np

from app.config import FFMPEG

_model = None


def _get_model():
    global _model
    if _model is None:
        from simple_lama_inpainting import SimpleLama
        _model = SimpleLama()
    return _model


def _resolve_ffmpeg():
    """FFMPEG가 'ffmpeg'(PATH 의존)면 절대경로로 변환.
    한글 cwd/env에서 CreateProcess가 PATH 탐색 실패하는 케이스 회피.
    """
    import shutil
    if FFMPEG and ("/" in FFMPEG or "\\" in FFMPEG):
        return FFMPEG  # 이미 절대/상대 경로
    found = shutil.which(FFMPEG or "ffmpeg")
    return found or FFMPEG or "ffmpeg"


def _short_path(p):
    """Windows 8.3 short path(ASCII)로 변환. 한글경로가 subprocess argv에서
    surrogate로 깨져 ffmpeg가 파일 못 찾는 문제 회피. 비윈도우/실패 시 원본.
    파일이 존재해야 변환됨 → 없으면 부모디렉토리로 변환 후 파일명 결합.
    """
    import os
    if os.name != "nt":
        return str(p)
    import ctypes
    from ctypes import wintypes
    p = os.path.abspath(str(p))
    _GSPN = ctypes.windll.kernel32.GetShortPathNameW
    _GSPN.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD]
    _GSPN.restype = wintypes.DWORD

    def conv(path):
        buf = ctypes.create_unicode_buffer(600)
        n = _GSPN(path, buf, 600)
        return buf.value if n and n < 600 else None

    if os.path.exists(p):
        r = conv(p)
        if r:
            return r
    # 미존재(출력파일): 부모만 변환 후 결합
    parent, name = os.path.split(p)
    if os.path.isdir(parent):
        rp = conv(parent)
        if rp:
            return os.path.join(rp, name)
    return p


def _imwrite_unicode(path, img):
    """cv2.imwrite는 한글(non-ASCII) 경로에 못 씀(Windows) → 조용히 실패.
    imencode로 메모리 인코딩 후 numpy.tofile로 직접 기록(경로 인코딩 무관).
    """
    path = Path(path)
    ok, buf = cv2.imencode(path.suffix, img)
    if not ok:
        raise RuntimeError(f"cv2.imencode 실패: {path.name}")
    buf.tofile(str(path))


def _seg_at(segments, t):
    return [s["box"] for s in segments if s["start"] <= t <= s["end"]]


def _to_xywh(box):
    """seg box는 (x, y, w, h), fixed box도 (x, y, w, h). 통일."""
    x, y, w, h = box
    return int(x), int(y), int(w), int(h)


def _stroke_mask_in_box(frame, x, y, w, h, dilate=4, bright_thresh=200, dark_thresh=55):
    """박스 안에서 '글자 획'만 마스킹(박스 전체 X).

    자막/워터마크 글자는 보통 흰색(밝음)+검은 외곽선. 박스영역을 grayscale로
    보고 매우 밝거나 매우 어두운 픽셀(=글자/외곽선)만 골라 마스크.
    박스 전체를 inpaint하면 LaMa가 큰 영역을 뭉개 뿌옇게 됨 → 획만 좁게 덮어
    주변 원본 디테일 보존(선명).
    bright_thresh/dark_thresh: 밝은 글자(≥bright)·어두운 외곽선(≤dark) 임계.
      기본 200/55는 LaMa용 보수값(밴드 넓히면 LaMa가 뭉갬). ProPainter는 큰
      마스크도 안 뭉개므로 dark를 90~110까지 올려 외곽선 잔선을 더 잡아도 됨.
    반환: (H,W) uint8 마스크의 해당 박스 부분에 255 채워진 것 일부.
    """
    H, W = frame.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return None
    roi = frame[y0:y1, x0:x1]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    bright = gray >= bright_thresh
    dark = gray <= dark_thresh
    m = np.zeros(gray.shape, dtype=np.uint8)
    m[bright | dark] = 255
    # 외곽선 가장자리만 살짝(잔상 제거). dilate 작게 — 과제거 방지.
    if dilate > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate, dilate))
        m = cv2.dilate(m, k, iterations=1)
    return (x0, y0, m)


def inpaint_subtitles(video_path, out_path, segments, fixed_boxes=None,
                      progress_cb=None, stroke_only=True):
    """자막(시간구간별 segments) + 고정 UI오버레이(fixed_boxes, 전 프레임) inpaint.

    segments: [{start, end, box(x,y,w,h)}] — 해당 시간에만 덮음
    fixed_boxes: [(x,y,w,h)] — 모든 프레임에 항상 덮음(도우인 고정 UI). None이면 자막만.
    progress_cb: callable(frac 0~1) — 프레임 처리 진행률 콜백(웹 진행바용).
    stroke_only: True면 박스 안 '글자 획'만 마스킹(주변 보존, 선명). False면 박스 전체
                 inpaint(큰 영역 뭉개져 뿌예짐 — 옛 동작).
    """
    video_path, out_path = Path(video_path), Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fixed_boxes = fixed_boxes or []
    if not segments and not fixed_boxes:
        import shutil
        shutil.copy(str(video_path), str(out_path))
        return out_path

    from PIL import Image

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0

    work = out_path.parent / "_inpaint_frames"
    work.mkdir(exist_ok=True)
    model = _get_model()

    import os
    import shutil
    try:
        idx = 0
        last_report = -1
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            t = idx / fps
            boxes = [_to_xywh(b) for b in _seg_at(segments, t)]
            boxes += [_to_xywh(b) for b in fixed_boxes]  # 고정 UI는 전 프레임
            if boxes:
                mask = np.zeros((H, W), dtype=np.uint8)
                for (x, y, w, h) in boxes:
                    if stroke_only:
                        sm = _stroke_mask_in_box(frame, x, y, w, h)
                        if sm is not None:
                            ox, oy, m = sm
                            mh, mw = m.shape
                            # 획이 충분히 잡혔으면 획만, 거의 없으면(빈 박스) 전체 폴백
                            if int(m.sum()) > 255 * 8:
                                mask[oy:oy + mh, ox:ox + mw] = np.maximum(
                                    mask[oy:oy + mh, ox:ox + mw], m)
                            else:
                                mask[y:y + h, x:x + w] = 255
                    else:
                        mask[y:y + h, x:x + w] = 255
                # 마스크에 칠해진 게 있을 때만 LaMa 호출(빈 박스면 원본 그대로 = 선명).
                if int(mask.sum()) > 0:
                    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                    msk = Image.fromarray(mask).convert("L")
                    res = model(img, msk)
                    frame = cv2.cvtColor(np.array(res), cv2.COLOR_RGB2BGR)
            _imwrite_unicode(work / ("f_%06d.png" % idx), frame)
            idx += 1
            if progress_cb and total > 0:
                pct = int(idx * 100 / total)
                if pct != last_report:
                    last_report = pct
                    progress_cb(idx / total)
        cap.release()

        if idx == 0:
            raise RuntimeError(
                f"인페인팅 프레임 추출 실패 — OpenCV가 {video_path} 에서 프레임을 0개 읽음"
            )

        fps_safe = fps if fps and fps > 0 else 30
        ffmpeg_exe = _resolve_ffmpeg()
        # 한글 경로가 subprocess argv에서 surrogate로 깨져 ffmpeg가 파일 못찾는 문제.
        # 8.3 short path는 짧은 한글이름엔 안 먹음 → cwd=work + 상대경로로 한글 부모를
        # argv에서 완전 제거. frame=현재폴더, source/out=상위폴더(../).
        work_abs = work.resolve()
        frames_pat = "f_%06d.png"                       # cwd 기준
        src_rel = os.path.relpath(video_path.resolve(), work_abs)   # ../source.mp4
        out_rel = os.path.relpath(out_path.resolve(), work_abs)     # ../nosub.mp4
        # 오디오: HE-AACv2 등 copy 실패 대비 aac 재인코딩(호환성↑). 음질 손실 미미.
        cmd = [ffmpeg_exe, "-hide_banner", "-y", "-framerate", str(fps_safe),
               "-i", frames_pat, "-i", src_rel,
               "-map", "0:v:0", "-map", "1:a:0?",
               "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
               "-c:a", "aac", "-b:a", "128k", "-shortest", out_rel]
        frame_files = sorted(work_abs.glob("f_*.png"))
        proc = subprocess.run(cmd, cwd=str(work_abs), capture_output=True,
                              text=True, errors="replace")
        if proc.returncode != 0:
            err = (proc.stderr or "")
            raise RuntimeError(
                f"ffmpeg 재조립 실패(code {proc.returncode})\n"
                f"CWD: {work_abs}\nFRAMES: {len(frame_files)} (first={frame_files[0].name if frame_files else 'NONE'})\n"
                f"CMD: {' '.join(cmd)}\n"
                f"STDERR(full):\n{err}"
            )
        return out_path
    finally:
        # 성공/실패 무관하게 임시 프레임 폴더·캡처 정리(디스크 누수 방지).
        try:
            cap.release()
        except Exception:
            pass
        shutil.rmtree(work, ignore_errors=True)
