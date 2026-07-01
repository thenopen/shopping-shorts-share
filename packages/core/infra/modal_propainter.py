"""ProPainter 비디오 자막 제거 — Modal(클라우드 GPU) 실행.

왜 Modal인가: 로컬 RTX 3070 8GB는 ProPainter OOM(1080x1920 native ~17GB). SaaS는
영상 처리를 서버측에서 하므로 GPU 단계만 클라우드로 오프로드한다. Modal은 scale-to-zero
(영상 없을 땐 과금 0) + Python 데코레이터 배포라 측정→프로덕션을 하나로 통일한다.

설계(역할 분리):
- 로컬(CPU): 프레임 추출 + 자막 마스크 생성 + 최종 합성/재인코딩 (app.pipeline 재사용)
- Modal(GPU): vendored ProPainter inference_propainter.py 실행만 — 프레임+마스크 tar를
  받아 복원 프레임 tar로 반환. 처리시간·GPU·peak VRAM 로깅.

사용:
  cd packages/core && (.venv 활성)
  modal run infra/modal_propainter.py --video <샘플.mp4>            # 풀해상도 측정
  PP_GPU=A100 modal run infra/modal_propainter.py --video <샘플.mp4> --resize-ratio 1.0
런북: infra/README.md
"""
from __future__ import annotations

import io
import os
import tarfile
import time

import modal

# GPU 타입은 배포/실행 시 env로 결정(데코레이터가 import 시점에 읽음).
# 단가 대략치($/hr, 확정 전 직접 확인): L4 0.80 / A10G 1.10 / A100 2.50 / H100 4.50
PP_GPU = os.environ.get("PP_GPU", "A10G")
_PRICE_PER_HR = {"T4": 0.59, "L4": 0.80, "A10G": 1.10, "A100": 2.50, "H100": 4.50}

_REPO = "https://github.com/sczhou/ProPainter"
_PP_DIR = "/opt/ProPainter"
_WEIGHTS_BASE = "https://github.com/sczhou/ProPainter/releases/download/v0.1.0"

# 신버전 imageio/PyAV는 mimwrite(quality=) 미지원 → 크래시. 빌드 시 멱등 패치.
# (--save_frames로 PNG를 읽으므로 mp4 쓰기 실패만 무력화하면 됨. propainter_inpaint와 동일.)
# run_commands에 멀티라인 python -c를 넣으면 Dockerfile 파서가 깨지므로 run_function으로 적용.
def _patch_propainter():
    import pathlib
    inf = pathlib.Path("/opt/ProPainter/inference_propainter.py")
    t = inf.read_text(encoding="utf-8")
    t = t.replace(
        "imageio.mimwrite(os.path.join(save_root, 'masked_in.mp4'), masked_frame_for_save, fps=fps, quality=7)",
        "")
    t = t.replace(
        "imageio.mimwrite(os.path.join(save_root, 'inpaint_out.mp4'), comp_frames, fps=fps, quality=7)",
        "try:\n        imageio.mimwrite(os.path.join(save_root, 'inpaint_out.mp4'), comp_frames, fps=fps)\n    except Exception: pass")
    inf.write_text(t, encoding="utf-8")
    print("[patch] inference_propainter.py done")


image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "ffmpeg", "libgl1", "libglib2.0-0", "wget")
    # GPU torch(cu128) — 로컬과 동일 계열. torchvision은 같은 인덱스에서 호환버전 자동선택.
    .pip_install("torch==2.11.0", "torchvision",
                 index_url="https://download.pytorch.org/whl/cu128")
    .pip_install(
        "av", "addict", "einops", "future", "numpy", "scipy",
        "opencv-python-headless", "matplotlib", "scikit-image",
        "imageio", "imageio-ffmpeg", "pyyaml", "requests", "timm", "yapf",
    )
    .run_commands(
        f"git clone --depth 1 {_REPO} {_PP_DIR}",
        # 가중치 사전 다운로드(콜드스타트 시 매번 받는 것 방지). GPU 불필요.
        f"mkdir -p {_PP_DIR}/weights",
        f"wget -q {_WEIGHTS_BASE}/ProPainter.pth -O {_PP_DIR}/weights/ProPainter.pth",
        f"wget -q {_WEIGHTS_BASE}/raft-things.pth -O {_PP_DIR}/weights/raft-things.pth",
        f"wget -q {_WEIGHTS_BASE}/recurrent_flow_completion.pth -O {_PP_DIR}/weights/recurrent_flow_completion.pth",
    )
    .run_function(_patch_propainter)
)

app = modal.App("shorts-propainter", image=image)


def _tar_dir(path: str) -> bytes:
    """디렉토리의 *.png를 tar(gz 없이) 바이트로 묶음."""
    import pathlib
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        for p in sorted(pathlib.Path(path).glob("*.png")):
            tar.add(str(p), arcname=p.name)
    return buf.getvalue()


def _untar_to(data: bytes, dest: str) -> int:
    import pathlib
    pathlib.Path(dest).mkdir(parents=True, exist_ok=True)
    n = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as tar:
        for m in tar.getmembers():
            if m.isfile():
                tar.extract(m, dest)
                n += 1
    return n


def _union_bbox(masks_dir, W, H, pad=24):
    """모든 마스크 프레임의 전경(255) 합집합 bbox(+pad, 짝수 스냅). 없으면 None."""
    import pathlib
    import cv2
    import numpy as np
    x0, y0, x1, y1 = W, H, 0, 0
    found = False
    for mp_ in sorted(pathlib.Path(masks_dir).glob("*.png")):
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


@app.function(gpu=PP_GPU, timeout=3600)
def run_propainter(frames_tar: bytes, masks_tar: bytes,
                   resize_ratio: float = 1.0, subvideo_length: int = 80,
                   neighbor_length: int = 10, mask_dilation: int = 4,
                   chunk: int = 200, overlap: int = 12) -> dict:
    """프레임+마스크 tar → ProPainter 복원 프레임 tar. peak VRAM/처리시간 함께 반환.

    RAFT 광학흐름 메모리가 클립 길이에 비례 → 긴 영상은 GPU OOM. 프레임을 chunk개씩
    나눠 각각 별 subprocess로 실행(청크마다 GPU 메모리 해제)해 길이 무관하게 처리한다.
    경계 이질감 완화용으로 overlap 프레임을 두고 이웃 청크와 절반씩 나눠 채택.
    """
    import subprocess
    import sys
    import threading
    import glob
    import shutil

    work = "/tmp/pp_work"
    frames_dir, masks_dir, out_dir = f"{work}/frames", f"{work}/masks", f"{work}/out"
    subprocess.run(["rm", "-rf", work], check=False)
    nf = _untar_to(frames_tar, frames_dir)
    _untar_to(masks_tar, masks_dir)

    gpu_name = ""
    try:
        gpu_name = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True).stdout.strip().splitlines()[0]
    except Exception:
        pass

    # 백그라운드로 nvidia-smi 폴링해 peak VRAM 측정(서브프로세스라 torch 메모리로는 못 봄).
    peak = {"mb": 0.0}
    stop = threading.Event()

    def _sampler():
        while not stop.is_set():
            try:
                r = subprocess.run(
                    ["nvidia-smi", "--query-gpu=memory.used",
                     "--format=csv,noheader,nounits"],
                    capture_output=True, text=True)
                used = float(r.stdout.strip().splitlines()[0])
                peak["mb"] = max(peak["mb"], used)
            except Exception:
                pass
            stop.wait(0.4)

    th = threading.Thread(target=_sampler, daemon=True)
    th.start()

    env = dict(os.environ)
    # 메모리 단편화 완화(공식 권장).
    env["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

    def _run_one(fdir, mdir, odir):
        cmd = [
            sys.executable, "inference_propainter.py",
            "-i", fdir, "-m", mdir, "-o", odir,
            "--fp16",
            "--resize_ratio", str(resize_ratio),
            "--subvideo_length", str(subvideo_length),
            "--neighbor_length", str(neighbor_length),
            "--mask_dilation", str(mask_dilation),
            "--save_frames",
        ]
        r = subprocess.run(cmd, cwd=_PP_DIR, capture_output=True, text=True,
                           errors="replace", env=env)
        if r.returncode != 0:
            raise RuntimeError(f"ProPainter 실패(code {r.returncode}): {(r.stderr or '')[-1500:]}")
        pngs = glob.glob(f"{odir}/**/*.png", recursive=True)
        if not pngs:
            raise RuntimeError("ProPainter 출력 프레임 없음")
        bydir: dict = {}
        for p in pngs:
            bydir.setdefault(os.path.dirname(p), []).append(p)
        return sorted(max(bydir.values(), key=len))

    frame_files = sorted(glob.glob(f"{frames_dir}/*.png"))
    mask_files = sorted(glob.glob(f"{masks_dir}/*.png"))
    n = len(frame_files)
    result_dir = f"{work}/result"
    os.makedirs(result_dir, exist_ok=True)

    t0 = time.monotonic()
    n_chunks = 1
    if n <= chunk:
        outs = _run_one(frames_dir, masks_dir, out_dir)
        for i in range(min(n, len(outs))):
            shutil.copy(outs[i], f"{result_dir}/{i:05d}.png")
    else:
        # 청크(오버랩) — 각 청크를 별 subprocess로 실행 → 청크마다 GPU 해제(OOM 회피).
        step = max(1, chunk - overlap)
        starts = list(range(0, n, step))
        n_chunks = len(starts)
        for ci, s in enumerate(starts):
            e = min(s + chunk, n)
            cf, cm, co = f"{work}/cf", f"{work}/cm", f"{work}/co"
            for d in (cf, cm, co):
                subprocess.run(["rm", "-rf", d], check=False)
            os.makedirs(cf, exist_ok=True)
            os.makedirs(cm, exist_ok=True)
            for j in range(s, e):
                shutil.copy(frame_files[j], f"{cf}/{j:05d}.png")
                shutil.copy(mask_files[j], f"{cm}/{j:05d}.png")
            outs = _run_one(cf, cm, co)              # 정렬됨, 길이 e-s
            # 오버랩 경계는 이웃과 절반씩 나눠 채택(첫/끝 청크는 끝까지).
            keep_s = s if ci == 0 else s + overlap // 2
            keep_e = e if e >= n else e - (overlap - overlap // 2)
            for j in range(keep_s, keep_e):
                oi = j - s
                if 0 <= oi < len(outs):
                    shutil.copy(outs[oi], f"{result_dir}/{j:05d}.png")
            if e >= n:
                break
    secs = time.monotonic() - t0
    stop.set()
    th.join(timeout=2)

    res_png = sorted(glob.glob(f"{result_dir}/*.png"))
    if not res_png:
        raise RuntimeError("ProPainter 출력 프레임 없음")

    return {
        "result_tar": _tar_dir(result_dir),
        "seconds": round(secs, 2),
        "gpu": gpu_name,
        "peak_vram_mb": round(peak["mb"], 1),
        "n_frames": nf,
        "chunks": n_chunks,
    }


@app.function(gpu=PP_GPU, timeout=3600)
def run_chunk(payload: dict) -> dict:
    """청크 1개(프레임+마스크 tar) → ProPainter 복원 tar. 병렬 fan-out(run_chunk.map)용.

    청크당 별 컨테이너/GPU라 여러 청크가 동시에 돈다(계정 동시성 한도까지). 각 청크는
    짧아(≤chunk 프레임) OOM 없이 맞는다.
    """
    import subprocess
    import sys
    import glob
    import threading

    frames_tar = payload["frames"]
    masks_tar = payload["masks"]
    resize_ratio = payload.get("resize_ratio", 1.0)
    subvideo_length = payload.get("subvideo_length", 80)
    neighbor_length = payload.get("neighbor_length", 10)
    mask_dilation = payload.get("mask_dilation", 4)

    work = "/tmp/pp_chunk"
    frames_dir, masks_dir, out_dir = f"{work}/frames", f"{work}/masks", f"{work}/out"
    subprocess.run(["rm", "-rf", work], check=False)
    nf = _untar_to(frames_tar, frames_dir)
    _untar_to(masks_tar, masks_dir)

    gpu_name = ""
    try:
        gpu_name = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True).stdout.strip().splitlines()[0]
    except Exception:
        pass

    peak = {"mb": 0.0}
    stop = threading.Event()

    def _sampler():
        while not stop.is_set():
            try:
                r = subprocess.run(
                    ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                    capture_output=True, text=True)
                peak["mb"] = max(peak["mb"], float(r.stdout.strip().splitlines()[0]))
            except Exception:
                pass
            stop.wait(0.4)

    th = threading.Thread(target=_sampler, daemon=True)
    th.start()

    env = dict(os.environ)
    env["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
    cmd = [
        sys.executable, "inference_propainter.py",
        "-i", frames_dir, "-m", masks_dir, "-o", out_dir,
        "--fp16",
        "--resize_ratio", str(resize_ratio),
        "--subvideo_length", str(subvideo_length),
        "--neighbor_length", str(neighbor_length),
        "--mask_dilation", str(mask_dilation),
        "--save_frames",
    ]
    t0 = time.monotonic()
    r = subprocess.run(cmd, cwd=_PP_DIR, capture_output=True, text=True,
                       errors="replace", env=env)
    secs = time.monotonic() - t0
    stop.set()
    th.join(timeout=2)

    if r.returncode != 0:
        raise RuntimeError(f"ProPainter 실패(code {r.returncode}): {(r.stderr or '')[-1500:]}")
    all_png = glob.glob(f"{out_dir}/**/*.png", recursive=True)
    if not all_png:
        raise RuntimeError("ProPainter 출력 프레임 없음")
    by_dir: dict = {}
    for p in all_png:
        by_dir.setdefault(os.path.dirname(p), []).append(p)
    best = max(by_dir, key=lambda d: len(by_dir[d]))
    return {
        "result_tar": _tar_dir(best),
        "seconds": round(secs, 2),
        "gpu": gpu_name,
        "peak_vram_mb": round(peak["mb"], 1),
        "n_frames": nf,
    }


@app.local_entrypoint()
def measure(video: str, out: str = "", segments: str = "",
            resize_ratio: float = 1.0, subvideo_length: int = 80,
            neighbor_length: int = 10, mask_dilation: int = 4,
            full_frame: bool = False, mask_mode: str = "stroke",
            stroke_dilate: int = 6, bright_thresh: int = 190, dark_thresh: int = 90,
            crop: bool = True):
    """로컬에서 프레임/마스크 준비 → Modal GPU로 ProPainter → 합성 + 측정 리포트.

    --segments 미지정 시 로컬에서 자막 탐지(easyocr, GPU 자동/CPU 폴백).
    """
    import json
    import shutil
    import sys
    import tempfile
    from pathlib import Path

    # packages/core 를 import 경로에 추가 (이 파일은 packages/core/infra/ 에 위치)
    core_root = str(Path(__file__).resolve().parent.parent)
    if core_root not in sys.path:
        sys.path.insert(0, core_root)
    from app.pipeline.propainter_inpaint import (
        _extract_frames, _build_masks_with_fps, _composite_and_encode)
    from app.pipeline.subtitle_detect import detect_segments

    video_p = Path(video).resolve()
    if not video_p.exists():
        raise SystemExit(f"입력 영상 없음: {video_p}")
    out_p = Path(out).resolve() if out else video_p.with_name(video_p.stem + "_nosub.mp4")

    if segments:
        segs = json.loads(Path(segments).read_text(encoding="utf-8"))
    else:
        print("[1/5] 자막 탐지(detect_segments) — 로컬…")
        segs = detect_segments(video_p, full_frame=full_frame)
    print(f"      세그먼트 {len(segs)}개")

    work = Path(tempfile.gettempdir()) / f"ppm_{abs(hash(str(out_p))) % 10**8}"
    frames_dir, masks_dir, res_dir = work / "frames", work / "masks", work / "res"
    if work.exists():
        shutil.rmtree(work, ignore_errors=True)
    try:
        print("[2/5] 프레임 추출 + 마스크 생성 — 로컬…")
        W, H, fps = _extract_frames(video_p, frames_dir)
        n = _build_masks_with_fps(frames_dir, masks_dir, segs, W, H, fps,
                                  mask_mode=mask_mode, stroke_dilate=stroke_dilate,
                                  bright_thresh=bright_thresh, dark_thresh=dark_thresh)
        if n == 0:
            raise SystemExit("마스크가 비었음(자막 미검출). --segments 확인")
        print(f"      {W}x{H} @ {fps:.1f}fps, 마스크 프레임 {n}개")

        import cv2

        # 크롭: 자막 영역(모든 마스크 합집합+여백)만 ProPainter에 보냄 → 처리량/VRAM↓,
        # 속도↑, 남는 VRAM으로 subvideo/neighbor 키워 참조↑(물방울 채움 품질↑).
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
                pct = (cx1 - cx0) * (cy1 - cy0) / (W * H) * 100
                print(f"      크롭 {cx1 - cx0}x{cy1 - cy0} (원본 대비 {pct:.0f}%)")

        print(f"[3/5] Modal GPU({PP_GPU})로 ProPainter 실행 — 업로드 중…")
        res = run_propainter.remote(
            _tar_dir(str(send_frames)), _tar_dir(str(send_masks)),
            resize_ratio=resize_ratio, subvideo_length=subvideo_length,
            neighbor_length=neighbor_length, mask_dilation=mask_dilation)

        print("[4/5] 복원 프레임 수신 + 합성/재인코딩 — 로컬…")
        _untar_to(res["result_tar"], str(res_dir))
        pp_crop = sorted(res_dir.glob("*.png"))

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
        _composite_and_encode(frames_dir, masks_dir, pp_frames, video_p, out_p, fps, W, H)

        # ----- 측정 리포트 -----
        secs = res["seconds"]
        price = _PRICE_PER_HR.get(PP_GPU, 0.0)
        cost = secs / 3600 * price
        print("\n========== ProPainter 측정 리포트 ==========")
        print(f" 출력          : {out_p}")
        print(f" GPU           : {res['gpu']} (PP_GPU={PP_GPU})")
        print(f" 해상도/프레임 : {W}x{H}, {res['n_frames']}프레임, resize_ratio={resize_ratio}")
        print(f" GPU 처리시간  : {secs:.1f}s")
        print(f" peak VRAM     : {res['peak_vram_mb']:.0f} MB")
        print(f" 영상당 GPU 원가: ${cost:.4f}  (≈ ${price}/hr 기준)")
        print(" * 단가는 대략치 — provider 콘솔에서 실제 요금 확인 필요")
        print("============================================\n")
        print("[5/5] 완료. 출력 영상 품질을 LaMa 결과와 눈으로 비교하세요.")
    finally:
        shutil.rmtree(work, ignore_errors=True)
