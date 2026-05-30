"""[3] 중국어 자막 제거. (난이도 최상)

전략 (사용자 결정):
- 작은 글씨  → 가우시안 블러로 뭉갬
- 큰 글씨    → 불투명 자막바(박스)로 덮어버림

도우인 자막은 보통 화면 하단 고정영역에 깔림.
1차 구현 = 하단 고정영역 처리 (빠름, 무료).
2차(옵션) = easyocr로 자막 위치 자동탐지 후 그 영역만 처리 (정확, 느림).

ffmpeg 필터:
- 블러:   boxblur / gblur 를 특정 영역(crop)에만 적용
- 자막바: drawbox 로 불투명 사각형 그리기
"""
import subprocess
from pathlib import Path

from app.config import FFMPEG


def remove_subtitle_bottom(
    video_path: Path,
    out_path: Path,
    mode: str = "bar",          # "bar"(박스 덮기) | "blur"(블러)
    band_height_ratio: float = 0.18,   # 하단 몇 %를 자막영역으로 볼지
    bar_color: str = "black@0.85",     # 자막바 색/투명도
) -> Path:
    """하단 고정영역의 중국어 자막을 가린다.

    mode="bar":  하단에 반투명 박스를 그려 덮음 (큰 글씨용).
    mode="blur": 하단 영역을 블러 처리 (작은 글씨용).

    TODO: easyocr 자동탐지 모드 추가 (위치/크기 동적 결정).
    TODO: 작은글씨/큰글씨 자동 판별 → mode 자동선택.
    """
    video_path, out_path = Path(video_path), Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if mode == "blur":
        # 하단 band 영역만 잘라 블러 후 다시 덮어쓰기
        vf = (
            f"[0:v]crop=iw:ih*{band_height_ratio}:0:ih*(1-{band_height_ratio}),"
            f"gblur=sigma=20[blurred];"
            f"[0:v][blurred]overlay=0:H-h"
        )
        cmd = [FFMPEG, "-y", "-i", str(video_path),
               "-filter_complex", vf, "-c:a", "copy", str(out_path)]
    else:  # bar
        vf = (
            f"drawbox=x=0:y=ih*(1-{band_height_ratio}):w=iw:"
            f"h=ih*{band_height_ratio}:color={bar_color}:t=fill"
        )
        cmd = [FFMPEG, "-y", "-i", str(video_path),
               "-vf", vf, "-c:a", "copy", str(out_path)]

    subprocess.run(cmd, check=True, capture_output=True)
    return out_path


def remove_subtitle_ocr(video_path: Path, out_path: Path) -> Path:
    """[2차 구현 예정] easyocr로 자막위치 자동탐지 후 제거.

    흐름:
      1. 프레임 샘플링 (1초당 1프레임 등)
      2. easyocr로 중국어 텍스트 박스 탐지
      3. 박스 크기로 작은글씨/큰글씨 판별
      4. 작은건 blur, 큰건 박스 덮기
      5. 시간구간별로 다르면 구간 나눠 처리
    """
    raise NotImplementedError("Phase 2에서 구현")
