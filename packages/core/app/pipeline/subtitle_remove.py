"""[3] 중국어 자막 제거.

목표(사용자): 검은박스/블러 X → **자연스럽게** 지우기 (흔적 최소).
방법: ffmpeg delogo 필터 = 지정 사각형을 주변 픽셀로 보간해 자연스럽게 채움.

자막 위치 결정 2가지:
  A. detect_subtitle_region(): easyocr로 중국어 텍스트 박스 자동탐지 (정확, 권장)
  B. 하단 고정영역 (OCR 실패/없을 때 폴백)

delogo는 한 사각형만 처리하므로, OCR로 찾은 자막영역을 하나의 박스로 합쳐 넘긴다.
자막이 프레임마다 움직이면 전체를 포함하는 합집합 박스 사용.
"""
import subprocess
from pathlib import Path

from app.config import FFMPEG


def _delogo_filter(x, y, w, h, enable=None):
    """delogo 필터 문자열. enable=시간조건이면 그 구간만 적용."""
    s = f"delogo=x={x}:y={y}:w={w}:h={h}:show=0"
    if enable:
        s += f":enable='{enable}'"
    return s


def remove_subtitle_segments(video_path: Path, out_path: Path,
                             segments: list) -> Path:
    """시간구간별 자막 박스를 각각 그 시간에만 delogo (정밀제거).

    segments: [{"start","end","box":(x,y,w,h)}, ...]  ← subtitle_detect.detect_segments
    자막 있는 구간/위치만 처리 → 자막없는 구간은 원본 유지(떡짐 방지).
    """
    video_path, out_path = Path(video_path), Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if not segments:
        # 자막 없음 → 그냥 복사
        import shutil
        shutil.copy(str(video_path), str(out_path))
        return out_path

    import cv2
    cap = cv2.VideoCapture(str(video_path))
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    filters = []
    for seg in segments:
        x, y, w, h = _clamp_box(seg["box"], W, H)
        en = f"between(t,{seg['start']},{seg['end']})"
        filters.append(_delogo_filter(x, y, w, h, enable=en))
    vf = ",".join(filters)

    cmd = [FFMPEG, "-y", "-i", str(video_path), "-vf", vf,
           "-c:a", "copy", str(out_path)]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"구간별 delogo 실패:\n{r.stderr[-1000:]}")
    return out_path


def _clamp_box(box, W, H):
    """delogo는 박스가 화면 가장자리에 닿으면 실패. 안쪽으로 1px 이상 클램프."""
    x, y, w, h = box
    x = max(1, min(x, W - 3))
    y = max(1, min(y, H - 3))
    w = max(1, min(w, W - x - 1))
    h = max(1, min(h, H - y - 1))
    return (x, y, w, h)


def remove_subtitle_delogo(video_path: Path, out_path: Path,
                           box: tuple[int, int, int, int]) -> Path:
    """지정 박스(x,y,w,h)를 delogo로 자연스럽게 제거.

    box: 픽셀 좌표. OCR 또는 고정영역에서 결정.
    """
    video_path, out_path = Path(video_path), Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    import cv2
    cap = cv2.VideoCapture(str(video_path))
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    x, y, w, h = _clamp_box(box, W, H)
    vf = _delogo_filter(x, y, w, h)
    cmd = [FFMPEG, "-y", "-i", str(video_path), "-vf", vf,
           "-c:a", "copy", str(out_path)]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"delogo 실패:\n{r.stderr[-1000:]}")
    return out_path


def detect_subtitle_region(video_path: Path, samples: int = 12,
                           bottom_only: bool = True) -> tuple[int, int, int, int] | None:
    """easyocr로 중국어 자막영역 자동탐지 → 합집합 박스 (x,y,w,h).

    여러 프레임 샘플링 → 중국어 텍스트 박스들 → 모두 포함하는 사각형.
    bottom_only=True면 화면 하단 55% 영역의 텍스트만 (제목/UI 텍스트 제외).
    탐지 실패시 None.
    """
    import easyocr
    import cv2

    cap = cv2.VideoCapture(str(video_path))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    reader = easyocr.Reader(["ch_sim", "en"], gpu=False, verbose=False)
    boxes = []
    for i in range(samples):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * (i + 0.5) / samples))
        ok, frame = cap.read()
        if not ok:
            continue
        for (bbox, text, conf) in reader.readtext(frame):
            if conf < 0.2:
                continue
            xs = [p[0] for p in bbox]
            ys = [p[1] for p in bbox]
            x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
            if bottom_only and (y0 + y1) / 2 < H * 0.4:
                continue   # 화면 위쪽 텍스트는 자막 아님(UI/제목)
            boxes.append((x0, y0, x1, y1))
    cap.release()

    if not boxes:
        return None
    # 합집합 박스 + 여유 패딩
    x0 = max(0, int(min(b[0] for b in boxes)) - 8)
    y0 = max(0, int(min(b[1] for b in boxes)) - 8)
    x1 = min(W, int(max(b[2] for b in boxes)) + 8)
    y1 = min(H, int(max(b[3] for b in boxes)) + 8)
    return (x0, y0, x1 - x0, y1 - y0)


def remove_subtitle(video_path: Path, out_path: Path,
                    use_ocr: bool = True,
                    band_height_ratio: float = 0.16) -> Path:
    """중국어 자막 자연제거 (메인 진입점).

    use_ocr=True: OCR로 위치 탐지 후 delogo. 실패시 하단 고정영역 폴백.
    use_ocr=False: 하단 고정영역 delogo.
    """
    video_path, out_path = Path(video_path), Path(out_path)
    import cv2
    cap = cv2.VideoCapture(str(video_path))
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    box = None
    if use_ocr:
        try:
            box = detect_subtitle_region(video_path)
        except Exception as e:
            print(f"  [OCR 탐지 실패, 하단영역 폴백: {str(e)[:80]}]")

    if box is None:
        # 폴백: 하단 band 전체
        bh = int(H * band_height_ratio)
        box = (0, H - bh, W, bh)
        print(f"  [하단 고정영역 제거: {box}]")
    else:
        print(f"  [OCR 자막영역 제거: {box}]")

    return remove_subtitle_delogo(video_path, out_path, box)


# 구버전 호환 (run.py가 부르던 이름)
def remove_subtitle_bottom(video_path, out_path, mode="bar", **kw):
    return remove_subtitle(video_path, out_path, use_ocr=False)
