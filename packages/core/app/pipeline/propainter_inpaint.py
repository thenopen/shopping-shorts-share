"""ProPainter 기반 비디오 자막 제거 — 시간축 복원(도장툴식).

LaMa(프레임 독립)는 큰 흰 자막을 채울 때 주변을 뭉개 얼룩('운다'). ProPainter는
광학흐름으로 '다른 프레임의 같은 위치(자막 없을 때)' 픽셀을 끌어와 복원 → 자연스럽다.

전략(메모리/버그 회피):
- 프레임 추출 → segment 박스 기반 프레임별 마스크 PNG 폴더 생성
- vendored ProPainter inference_propainter.py를 subprocess로 호출(--fp16 --resize_ratio --save_frames)
  (CLI만 있고 깨끗한 Python API 없음. green-frame 영상쓰기 버그는 --save_frames PNG로 우회)
- 복원된 프레임을 원본에 마스크 영역만 합성 후 ffmpeg로 오디오 보존 재조립
- 17GB VRAM은 1080x1920 native OOM → resize_ratio로 다운스케일 필수

실패(가중치 다운로드/OOM/CLI 오류) 시 호출측에서 LaMa(inpaint_subtitles)로 폴백한다.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

from app.config import FFMPEG
from app.pipeline.subtitle_inpaint import _stroke_mask_in_box, _to_xywh

_PP_DIR = Path(__file__).resolve().parent / "ProPainter"


def ensure_propainter() -> bool:
    """ProPainter vendored repo 확인. 없으면 clone + 신버전 imageio 호환 패치.

    repo는 .gitignore(303MB) → 새 환경에선 1회 자동 셋업. 가중치는 첫 추론 시 자동 다운로드.
    """
    inf = _PP_DIR / "inference_propainter.py"
    if not inf.exists():
        try:
            subprocess.run(["git", "clone", "--depth", "1",
                            "https://github.com/sczhou/ProPainter", str(_PP_DIR)],
                           check=True, capture_output=True, text=True, timeout=600)
        except Exception as e:
            print(f"  [ProPainter clone 실패: {str(e)[:120]}]")
            return False
    # 신버전 imageio/PyAV는 mimwrite(quality=) 미지원 → 크래시. 패치(멱등).
    if inf.exists():
        txt = inf.read_text(encoding="utf-8")
        if "fps=fps, quality=7" in txt:
            txt = txt.replace(
                "imageio.mimwrite(os.path.join(save_root, 'masked_in.mp4'), masked_frame_for_save, fps=fps, quality=7)",
                "")
            txt = txt.replace(
                "imageio.mimwrite(os.path.join(save_root, 'inpaint_out.mp4'), comp_frames, fps=fps, quality=7)",
                "try:\n        imageio.mimwrite(os.path.join(save_root, 'inpaint_out.mp4'), comp_frames, fps=fps)\n    except Exception: pass")
            inf.write_text(txt, encoding="utf-8")
    return inf.exists()


def _extract_frames(video_path: Path, frames_dir: Path) -> tuple[int, int, float]:
    """영상 → 프레임 PNG. (W, H, fps) 반환.

    ffmpeg 단일 커맨드로 추출 — cv2 프레임루프 대비 ~5배 빠름(디코딩·IO 멀티스레드).
    프레임수·순서는 동일(0-베이스 이름). ffmpeg 실패 시 cv2 폴백.
    """
    frames_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-i", str(video_path),
         "-vsync", "0", "-start_number", "0", str(frames_dir / "%05d.png")],
        capture_output=True, text=True)

    if not any(frames_dir.glob("*.png")):
        cap = cv2.VideoCapture(str(video_path))
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            cv2.imwrite(str(frames_dir / f"{i:05d}.png"), frame)
            i += 1
        cap.release()
    return W, H, fps


def _union_bbox(masks_dir, W, H, pad=24):
    """모든 마스크 프레임의 전경(255) 합집합 bbox(+pad, 짝수 스냅). 없으면 None."""
    x0, y0, x1, y1 = W, H, 0, 0
    found = False
    for mp_ in sorted(Path(masks_dir).glob("*.png")):
        m = cv2.imread(str(mp_), cv2.IMREAD_GRAYSCALE)
        ys, xs = np.where(m > 0)
        if xs.size == 0:
            continue
        found = True
        x0, x1 = min(x0, int(xs.min())), max(x1, int(xs.max()) + 1)
        y0, y1 = min(y0, int(ys.min())), max(y1, int(ys.max()) + 1)
    if not found:
        return None
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(W, x1 + pad), min(H, y1 + pad)
    if (x1 - x0) % 2:
        x1 = x1 + 1 if x1 < W else x1 - 1
    if (y1 - y0) % 2:
        y1 = y1 + 1 if y1 < H else y1 - 1
    return (x0, y0, x1, y1)


def _run_propainter_local(frames_dir, masks_dir, result_dir, resize_ratio,
                          subvideo_length, neighbor_length, mask_dilation):
    """로컬 GPU(개발용): vendored ProPainter subprocess. 결과 프레임 경로 리스트 반환."""
    if not ensure_propainter():
        raise RuntimeError("ProPainter 셋업 실패(clone/패치)")
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    cmd = [
        sys.executable, "inference_propainter.py",
        "-i", str(Path(frames_dir).resolve()),
        "-m", str(Path(masks_dir).resolve()),
        "-o", str(Path(result_dir).resolve()),
        "--fp16",
        "--resize_ratio", str(resize_ratio),
        "--subvideo_length", str(subvideo_length),
        "--neighbor_length", str(neighbor_length),
        "--save_frames",
        "--mask_dilation", str(mask_dilation),
    ]
    r = subprocess.run(cmd, cwd=str(_PP_DIR), env=env, capture_output=True,
                       text=True, encoding="utf-8", errors="replace", timeout=3600)
    if r.returncode != 0:
        raise RuntimeError(f"ProPainter 실패(code {r.returncode}): {(r.stderr or '')[-800:]}")
    frames = _find_result_frames(Path(result_dir))
    if not frames:
        raise RuntimeError("ProPainter 출력 프레임을 찾지 못함")
    return frames


def _run_propainter_modal(frames_dir, masks_dir, result_dir, resize_ratio,
                          subvideo_length, neighbor_length, mask_dilation):
    """클라우드 GPU(SaaS): 배포된 Modal run_propainter 호출. 결과 프레임 경로 리스트 반환.

    사전에 `modal deploy infra/modal_propainter.py` 필요(배포된 함수 lookup).
    """
    import io
    import tarfile
    import shutil
    try:
        import modal  # noqa: F401  (설치 확인용)
    except ImportError as e:
        raise RuntimeError("PROPAINTER_BACKEND=modal 인데 modal 미설치 (pip install modal)") from e

    from app import modal_pool

    frame_files = sorted(Path(frames_dir).glob("*.png"))
    mask_files = sorted(Path(masks_dir).glob("*.png"))
    n = len(frame_files)
    chunk = int(os.environ.get("PROPAINTER_CHUNK", "200"))
    overlap = int(os.environ.get("PROPAINTER_OVERLAP", "12"))

    def _tar_files(files):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w") as t:
            for p in files:
                t.add(str(p), arcname=p.name)
        return buf.getvalue()

    # 청크 경계(오버랩). 각 청크를 별 GPU에 동시 분산 → 긴 영상도 빠르게.
    if n <= chunk:
        spans = [(0, n)]
    else:
        step = max(1, chunk - overlap)
        spans = []
        for s in range(0, n, step):
            e = min(s + chunk, n)
            spans.append((s, e))
            if e >= n:
                break

    common = dict(resize_ratio=resize_ratio, subvideo_length=subvideo_length,
                  neighbor_length=neighbor_length, mask_dilation=mask_dilation)
    payloads = [{"frames": _tar_files(frame_files[s:e]),
                 "masks": _tar_files(mask_files[s:e]), **common} for (s, e) in spans]

    results = modal_pool.run_propainter_parallel(payloads)   # 동시 실행, 입력 순서 유지

    # 스티치: 각 청크 결과에서 채택구간(오버랩 절반씩 이웃과 분담)만 이름순 배치.
    Path(result_dir).mkdir(parents=True, exist_ok=True)
    for ci, ((s, e), res) in enumerate(zip(spans, results)):
        cdir = Path(result_dir).parent / f"_ppchunk{ci}"
        if cdir.exists():
            shutil.rmtree(cdir, ignore_errors=True)
        cdir.mkdir(parents=True, exist_ok=True)
        with tarfile.open(fileobj=io.BytesIO(res["result_tar"]), mode="r:*") as t:
            t.extractall(str(cdir))
        outs = sorted(cdir.glob("*.png"))
        keep_s = s if ci == 0 else s + overlap // 2
        keep_e = e if e >= n else e - (overlap - overlap // 2)
        for j in range(keep_s, keep_e):
            oi = j - s
            if 0 <= oi < len(outs):
                shutil.copy(str(outs[oi]), str(Path(result_dir) / f"{j:05d}.png"))
        shutil.rmtree(cdir, ignore_errors=True)

    return sorted(Path(result_dir).glob("*.png"))


def inpaint_with_propainter(video_path, out_path, segments, fps: float = 30.0,
                            resize_ratio: float = 1.0, subvideo_length: int = 80,
                            neighbor_length: int = 10, mask_mode: str = "stroke",
                            crop: bool = True, mask_dilation: int = 4,
                            backend: str | None = None, progress_cb=None) -> Path:
    """ProPainter로 자막 제거. 성공 시 out_path 반환, 실패 시 예외(호출측 LaMa 폴백).

    백엔드: backend 인자 > 환경변수 PROPAINTER_BACKEND > "local"(개발용 로컬 GPU).
            "modal"이면 클라우드 GPU(SaaS). crop=True면 자막 영역만 잘라 처리 →
            VRAM↓(로컬 8GB도 가능)·속도↑·참조↑로 품질↑.
    """
    backend = (backend or os.environ.get("PROPAINTER_BACKEND") or "local").lower()
    # 코드 수정 없이 튜닝(로컬 8GB OOM 대응 / 프로덕션 조정): 환경변수 오버라이드.
    resize_ratio = float(os.environ.get("PROPAINTER_RESIZE", resize_ratio))
    subvideo_length = int(os.environ.get("PROPAINTER_SUBVIDEO", subvideo_length))
    neighbor_length = int(os.environ.get("PROPAINTER_NEIGHBOR", neighbor_length))
    video_path, out_path = Path(video_path), Path(out_path)
    # ProPainter(vendored) 내부 cv2.imread는 한글/유니코드 경로를 못 읽음(Windows).
    # 작업 폴더를 ASCII-only 임시경로에 둬서 우회.
    import tempfile
    work = Path(tempfile.gettempdir()) / f"pp_{abs(hash(str(out_path))) % 10**8}"
    frames_dir = work / "frames"
    masks_dir = work / "masks"
    result_dir = work / "out"
    try:
        if work.exists():
            shutil.rmtree(work, ignore_errors=True)
        W, H, real_fps = _extract_frames(video_path, frames_dir)
        fps = real_fps or fps
        # fps 보정해 마스크 타이밍 정확히
        n = _build_masks_with_fps(frames_dir, masks_dir, segments, W, H, fps,
                                  mask_mode=mask_mode)
        if n == 0:
            raise RuntimeError("자막 마스크가 비어 ProPainter 건너뜀")

        # 크롭: 자막 영역(마스크 합집합+여백)만 ProPainter에 → VRAM/처리량↓, 품질·속도↑.
        send_frames, send_masks, crop_box = frames_dir, masks_dir, None
        if crop:
            crop_box = _union_bbox(masks_dir, W, H, pad=24)
            if crop_box:
                cx0, cy0, cx1, cy1 = crop_box
                cf, cm = work / "cframes", work / "cmasks"
                cf.mkdir(parents=True, exist_ok=True)
                cm.mkdir(parents=True, exist_ok=True)
                for fp in sorted(frames_dir.glob("*.png")):
                    cv2.imwrite(str(cf / fp.name), cv2.imread(str(fp))[cy0:cy1, cx0:cx1])
                for mp_ in sorted(masks_dir.glob("*.png")):
                    g = cv2.imread(str(mp_), cv2.IMREAD_GRAYSCALE)
                    cv2.imwrite(str(cm / mp_.name), g[cy0:cy1, cx0:cx1])
                send_frames, send_masks = cf, cm

        runner = _run_propainter_modal if backend == "modal" else _run_propainter_local
        pp_crop = runner(send_frames, send_masks, result_dir, resize_ratio,
                         subvideo_length, neighbor_length, mask_dilation)

        # 크롭 결과를 원본 전체 프레임에 다시 끼워넣어 풀사이즈 pp 프레임 복원.
        pp_dir = work / "ppfull"
        pp_dir.mkdir(parents=True, exist_ok=True)
        orig_files = sorted(frames_dir.glob("*.png"))
        for i, of in enumerate(orig_files):
            full = cv2.imread(str(of))
            if i < len(pp_crop):
                patch = cv2.imread(str(pp_crop[i]))
                if crop_box:
                    cx0, cy0, cx1, cy1 = crop_box
                    if patch.shape[1] != cx1 - cx0 or patch.shape[0] != cy1 - cy0:
                        patch = cv2.resize(patch, (cx1 - cx0, cy1 - cy0),
                                           interpolation=cv2.INTER_LANCZOS4)
                    full[cy0:cy1, cx0:cx1] = patch
                else:
                    full = patch if patch.shape[:2] == (H, W) else \
                        cv2.resize(patch, (W, H), interpolation=cv2.INTER_LANCZOS4)
            cv2.imwrite(str(pp_dir / of.name), full)

        pp_frames = sorted(pp_dir.glob("*.png"))
        _composite_and_encode(frames_dir, masks_dir, pp_frames, video_path, out_path, fps, W, H)
        return out_path
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _build_masks_with_fps(frames_dir, masks_dir, segments, W, H, fps,
                          mask_mode="stroke", box_pad=6,
                          stroke_dilate=6, bright_thresh=190, dark_thresh=90) -> int:
    """프레임별 자막 마스크 PNG 생성.

    mask_mode="stroke": 박스 안 글자 획만(주변 보존). ProPainter용으로 외곽선을 더
                        잡도록 기본값을 완화(dark≤90/bright≥190, dilate 6).
    mask_mode="box"   : 박스 전체(+box_pad 여백) 채움. 큰 마스크여도 ProPainter는
                        안 뭉개나 움직이는 피사체 위에선 재구성 번짐 가능.
    stroke_dilate/bright_thresh/dark_thresh: stroke 모드 마스크 민감도 튜닝.
    """
    masks_dir.mkdir(parents=True, exist_ok=True)
    frame_files = sorted(frames_dir.glob("*.png"))
    n_with_mask = 0
    for idx, fp in enumerate(frame_files):
        t = idx / fps if fps else 0.0
        frame = cv2.imread(str(fp))
        mask = np.zeros((H, W), dtype=np.uint8)
        any_box = False
        for seg in segments:
            if seg["start"] - 0.3 <= t <= seg["end"] + 0.3:
                x, y, w, h = _to_xywh(seg["box"])
                if mask_mode == "box":
                    x0, y0 = max(0, x - box_pad), max(0, y - box_pad)
                    x1, y1 = min(W, x + w + box_pad), min(H, y + h + box_pad)
                    if x1 > x0 and y1 > y0:
                        mask[y0:y1, x0:x1] = 255
                        any_box = True
                    continue
                res = _stroke_mask_in_box(frame, x, y, w, h, dilate=stroke_dilate,
                                          bright_thresh=bright_thresh, dark_thresh=dark_thresh)
                if res:
                    x0, y0, m = res
                    sub = mask[y0:y0 + m.shape[0], x0:x0 + m.shape[1]]
                    mask[y0:y0 + m.shape[0], x0:x0 + m.shape[1]] = np.maximum(sub, m)
                    any_box = True
        if any_box:
            n_with_mask += 1
        cv2.imwrite(str(masks_dir / f"{idx:05d}.png"), mask)
    return n_with_mask


def _find_result_frames(result_dir: Path):
    """ProPainter 결과(frames PNG) 폴더 탐색."""
    if not result_dir.exists():
        return None
    # results/<videoname>/frames/*.png 패턴
    cands = list(result_dir.rglob("*.png"))
    if not cands:
        return None
    # 가장 많은 png 가진 폴더
    by_dir: dict[Path, list] = {}
    for p in cands:
        by_dir.setdefault(p.parent, []).append(p)
    best = max(by_dir.values(), key=len)
    return sorted(best)


def _composite_and_encode(frames_dir, masks_dir, pp_frames, video_path, out_path, fps, W, H):
    """복원 프레임을 원본에 마스크 영역만 합성 → ffmpeg 재조립(오디오 보존)."""
    comp_dir = Path(frames_dir).parent / "comp"
    comp_dir.mkdir(parents=True, exist_ok=True)
    orig_files = sorted(Path(frames_dir).glob("*.png"))
    mask_files = sorted(Path(masks_dir).glob("*.png"))
    for idx, of in enumerate(orig_files):
        orig = cv2.imread(str(of))
        if idx < len(pp_frames):
            pp = cv2.imread(str(pp_frames[idx]))
            if pp is not None and (pp.shape[1] != W or pp.shape[0] != H):
                pp = cv2.resize(pp, (W, H), interpolation=cv2.INTER_LANCZOS4)
        else:
            pp = None
        if pp is not None and idx < len(mask_files):
            m = cv2.imread(str(mask_files[idx]), cv2.IMREAD_GRAYSCALE)
            m = cv2.GaussianBlur(m, (5, 5), 0)
            a = (m.astype(np.float32) / 255.0)[..., None]
            out = (orig.astype(np.float32) * (1 - a) + pp.astype(np.float32) * a)
            cv2.imwrite(str(comp_dir / f"{idx:05d}.png"), out.astype(np.uint8))
        else:
            cv2.imwrite(str(comp_dir / f"{idx:05d}.png"), orig)

    # ffmpeg: 합성 프레임 → 영상 + 원본 오디오
    work = comp_dir.parent
    cmd = [FFMPEG, "-hide_banner", "-y", "-framerate", str(fps),
           "-i", "comp/%05d.png", "-i", str(Path(video_path).resolve()),
           "-map", "0:v", "-map", "1:a?", "-c:v", "libx264", "-preset", "fast",
           "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-shortest",
           str(Path(out_path).resolve())]
    r = subprocess.run(cmd, cwd=str(work), capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg 재조립 실패: {(r.stderr or '')[-600:]}")
