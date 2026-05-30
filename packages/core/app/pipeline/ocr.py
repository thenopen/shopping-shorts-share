"""easyocr Reader 공용 — GPU 자동감지 + 캐싱.

reader 로딩이 비싸므로(수초) 1번만 만들어 재사용.
GPU(CUDA) 있으면 자동 사용. 환경변수 OCR_GPU=0 으로 강제 CPU.
"""
import os

_reader = None


def use_gpu() -> bool:
    if os.environ.get("OCR_GPU") == "0":
        return False
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:
        return False


def get_reader():
    global _reader
    if _reader is None:
        import easyocr
        _reader = easyocr.Reader(["ch_sim", "en"], gpu=use_gpu(), verbose=False)
    return _reader
