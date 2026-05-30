"""중국어 자막 시간구간별 탐지.

영상 전체에 한 박스로 delogo = 떡짐(큰영역) + 자막없는 구간도 뭉갬.
→ 시간따라 자막 위치/유무가 바뀌므로, 구간별로 정밀 탐지.

흐름:
  1. interval(기본 1초)마다 프레임 OCR
  2. 중국어 텍스트 박스만 수집 (한자 포함 + 신뢰도)
  3. 인접 시간 + 비슷한 y위치 = 같은 자막구간으로 그룹화
  4. 구간별 (start, end, box) 리스트 반환 → 제거단계가 구간별로 처리

반환 형식:
  [ {"start": 12.0, "end": 16.0, "box": (x,y,w,h)}, ... ]
"""
import re
import cv2

CJK = re.compile(r"[一-鿿]")  # 한자


def _has_chinese(text: str) -> bool:
    return bool(CJK.search(text))


def detect_segments(video_path, interval_sec=1.0, conf_min=0.25,
                    bottom_ratio=0.4, y_merge_tol=80, time_gap=2.0,
                    pad=10):
    """중국어 자막 시간구간별 박스 탐지.

    bottom_ratio: 화면 위 이 비율은 무시(UI/제목). 0.4=상단40% 무시.
    y_merge_tol: y중심 차이가 이 픽셀 이내면 같은 자막위치로 병합.
    time_gap: 자막 사라진 시간 갭이 이보다 작으면 한 구간으로 이음.
    """
    import easyocr
    reader = easyocr.Reader(["ch_sim", "en"], gpu=False, verbose=False)

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    dur = total / fps
    y_off = int(H * bottom_ratio)

    # 시점별 자막 탐지 결과
    hits = []  # (sec, x0,y0,x1,y1)
    sec = 0.0
    while sec < dur:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(sec * fps))
        ok, frame = cap.read()
        if ok:
            crop = frame[y_off:, :]
            for bbox, text, conf in reader.readtext(crop):
                if conf < conf_min or not _has_chinese(text):
                    continue
                xs = [p[0] for p in bbox]
                ys = [p[1] + y_off for p in bbox]
                hits.append((sec, min(xs), min(ys), max(xs), max(ys)))
        sec += interval_sec
    cap.release()

    if not hits:
        return []

    # y위치로 클러스터 → 각 클러스터를 시간으로 구간화
    hits.sort(key=lambda h: ((h[2] + h[4]) / 2, h[0]))
    clusters = []  # 각: list of hits (비슷한 y)
    for h in hits:
        yc = (h[2] + h[4]) / 2
        placed = False
        for c in clusters:
            cyc = sum((g[2] + g[4]) / 2 for g in c) / len(c)
            if abs(yc - cyc) <= y_merge_tol:
                c.append(h)
                placed = True
                break
        if not placed:
            clusters.append([h])

    segments = []
    for c in clusters:
        c.sort(key=lambda h: h[0])
        # 시간 갭으로 분할
        run = [c[0]]
        for h in c[1:]:
            if h[0] - run[-1][0] <= time_gap + interval_sec:
                run.append(h)
            else:
                segments.append(_box_from_run(run, W, H, pad, interval_sec))
                run = [h]
        segments.append(_box_from_run(run, W, H, pad, interval_sec))

    segments.sort(key=lambda s: s["start"])
    return segments


def _box_from_run(run, W, H, pad, interval):
    x0 = max(1, int(min(h[1] for h in run)) - pad)
    y0 = max(1, int(min(h[2] for h in run)) - pad)
    x1 = min(W - 1, int(max(h[3] for h in run)) + pad)
    y1 = min(H - 1, int(max(h[4] for h in run)) + pad)
    start = max(0.0, run[0][0] - interval)      # 약간 앞에서 시작
    end = run[-1][0] + interval                  # 약간 뒤까지
    return {"start": round(start, 2), "end": round(end, 2),
            "box": (x0, y0, x1 - x0, y1 - y0)}


if __name__ == "__main__":
    import sys, json
    segs = detect_segments(sys.argv[1])
    print(json.dumps(segs, ensure_ascii=False, indent=2))
