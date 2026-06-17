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
    """영상 → 프레임 PNG. (W, H, fps) 반환."""
    frames_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        cv2.imwrite(str(frames_dir / f"{i:05d}.png"), frame)
        i += 1
    cap.release()
    return W, H, fps


def inpaint_with_propainter(video_path, out_path, segments, fps: float = 30.0,
                            resize_ratio: float = 0.5, subvideo_length: int = 40,
                            neighbor_length: int = 10, progress_cb=None) -> Path:
    """ProPainter로 자막 제거. 성공 시 out_path 반환, 실패 시 예외(호출측 LaMa 폴백)."""
    if not ensure_propainter():
        raise RuntimeError("ProPainter 셋업 실패(clone/패치)")
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
        n = _build_masks_with_fps(frames_dir, masks_dir, segments, W, H, fps)
        if n == 0:
            raise RuntimeError("자막 마스크가 비어 ProPainter 건너뜀")

        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        cmd = [
            sys.executable, "inference_propainter.py",
            "-i", str(frames_dir.resolve()),
            "-m", str(masks_dir.resolve()),
            "-o", str(result_dir.resolve()),
            "--fp16",
            "--resize_ratio", str(resize_ratio),
            "--subvideo_length", str(subvideo_length),
            "--neighbor_length", str(neighbor_length),
            "--save_frames",
            "--mask_dilation", "4",
        ]
        r = subprocess.run(cmd, cwd=str(_PP_DIR), env=env, capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=3600)
        if r.returncode != 0:
            raise RuntimeError(f"ProPainter 실패(code {r.returncode}): {(r.stderr or '')[-800:]}")

        # 결과 프레임 폴더 찾기(results/<name>/frames 또는 *_results)
        pp_frames = _find_result_frames(result_dir)
        if not pp_frames:
            raise RuntimeError("ProPainter 출력 프레임을 찾지 못함")

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
