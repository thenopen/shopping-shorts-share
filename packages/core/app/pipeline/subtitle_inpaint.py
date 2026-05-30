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


def _seg_at(segments, t):
    return [s["box"] for s in segments if s["start"] <= t <= s["end"]]


def inpaint_subtitles(video_path, out_path, segments):
    video_path, out_path = Path(video_path), Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if not segments:
        import shutil
        shutil.copy(str(video_path), str(out_path))
        return out_path

    from PIL import Image

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    work = out_path.parent / "_inpaint_frames"
    work.mkdir(exist_ok=True)
    model = _get_model()

    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = idx / fps
        boxes = _seg_at(segments, t)
        if boxes:
            mask = np.zeros((H, W), dtype=np.uint8)
            for (x, y, w, h) in boxes:
                mask[y:y + h, x:x + w] = 255
            img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            msk = Image.fromarray(mask).convert("L")
            res = model(img, msk)
            frame = cv2.cvtColor(np.array(res), cv2.COLOR_RGB2BGR)
        cv2.imwrite(str(work / ("f_%06d.png" % idx)), frame)
        idx += 1
    cap.release()

    cmd = [FFMPEG, "-y", "-framerate", str(fps),
           "-i", str(work / "f_%06d.png"), "-i", str(video_path),
           "-map", "0:v:0", "-map", "1:a:0?",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
           "-c:a", "copy", "-shortest", str(out_path)]
    subprocess.run(cmd, check=True, capture_output=True)

    import shutil
    shutil.rmtree(work, ignore_errors=True)
    return out_path
