# 작업지시서: 중국어 자막 AI 인페인팅 제거

## 배경
- 프로젝트: `c:/Users/user/Desktop/쇼핑쇼츠/` (도우인 영상 → 한국어 쇼츠 변환 SaaS)
- 코어: `packages/core/` (Python venv: `packages/core/.venv`)
- 현재 자막제거 = `ffmpeg delogo` 방식 → **번지고 안 지워짐. 실패.**
- 목표: 숏핏메이커처럼 **AI 인페인팅으로 자막 감쪽같이 제거**
- 환경: Windows, GPU = RTX 5070 Ti 16GB, torch 2.11.0+cu128 (CUDA 동작 확인됨)

## 문제 (왜 막혔나)
1. `iopaint` 설치 실패:
   - `WinError 5 액세스 거부: cv2.pyd` — uvicorn 서버가 opencv 점유 中 설치 시도
   - iopaint 의존성이 opencv/torch 버전 강제 변경 → cu128 torch와 충돌 위험
2. `simple-lama-inpainting` 설치 미확인 (중단됨)

## 해야 할 일

### 1단계: 서버 중지 (cv2 잠금 해제)
PowerShell:
```powershell
Get-CimInstance Win32_Process -Filter "name='python.exe'" |
  Where-Object { $_.CommandLine -like '*uvicorn*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```
모든 Python 잠금 풀려야 pip 설치 가능.

### 2단계: 인페인팅 라이브러리 설치
**simple-lama-inpainting 우선** (가볍고 의존성 적음):
```powershell
cd c:\Users\user\Desktop\쇼핑쇼츠\packages\core
.venv\Scripts\python.exe -m pip install simple-lama-inpainting
.venv\Scripts\python.exe -c "from simple_lama_inpainting import SimpleLama; print('OK')"
```
- 설치 실패 시: `--no-deps` 로 설치 후, 필요한 의존성(`torch`는 이미 있음)만 개별 설치
- torch는 **절대 재설치/다운그레이드 금지** (cu128 GPU판 유지). pip이 torch 바꾸려 하면 `--no-deps` 사용

### 3단계: 자막 인페인팅 모듈 수정
파일: `packages/core/app/pipeline/subtitle_inpaint.py` (이미 존재, iopaint API로 작성됨 → simple-lama API로 교체)

simple-lama API:
```python
from simple_lama_inpainting import SimpleLama
from PIL import Image
import numpy as np

simple_lama = SimpleLama()  # 첫 호출시 모델 자동 다운로드, GPU 자동
# image: PIL RGB, mask: PIL L(흰=지울영역)
result = simple_lama(image, mask)  # PIL RGB 반환
```

`subtitle_inpaint.py` 의 `inpaint_subtitles()` 함수를 위 API로 수정:
- 입력: `video_path`, `out_path`, `segments` (= `subtitle_detect.detect_segments()` 결과, `[{start,end,box:(x,y,w,h)}]`)
- 처리: 프레임별로 segments에서 해당 시각 활성 박스 → PIL 흰 마스크 → SimpleLama 인페인팅
- 자막 없는 프레임은 원본 그대로
- ffmpeg로 프레임+원본오디오 재조립 (libx264, yuv420p, crf 18, `-c:a copy`)
- segments 비면 원본 복사

### 4단계: 파이프라인 연결
파일: `packages/core/app/server_api.py` 의 `_analyze_worker()`
- 현재 `remove_subtitle_segments` (delogo) 호출 → `inpaint_subtitles` 로 교체
- 위치: `from app.pipeline.subtitle_remove import remove_subtitle_segments` 부근

### 5단계: 테스트
```powershell
cd c:\Users\user\Desktop\쇼핑쇼츠\packages\core
$env:PYTHONIOENCODING="utf-8"; $env:PYTHONUTF8="1"
.venv\Scripts\python.exe -c "from app.pipeline.subtitle_detect import detect_segments; from app.pipeline.subtitle_inpaint import inpaint_subtitles; s=detect_segments('workdir/67801cdd/source.mp4', interval_sec=0.5, bottom_ratio=0.3); print(len(s),'구간'); inpaint_subtitles('workdir/67801cdd/source.mp4','workdir/67801cdd/inp.mp4',s); print('done')"
```
- 결과 `workdir/67801cdd/inp.mp4` 의 8초 프레임 추출해서 중국어 자막(`这个纯欲水光肌啊`) 사라졌나 육안 확인:
```powershell
ffmpeg -y -ss 8 -i workdir\67801cdd\inp.mp4 -frames:v 1 workdir\67801cdd\inp8.png
```

### 6단계: 서버 재시작
```powershell
cd c:\Users\user\Desktop\쇼핑쇼츠\packages\core
.venv\Scripts\python.exe -m uvicorn app.server_api:app --host 127.0.0.1 --port 8000
```

## 성공 기준
- `workdir/67801cdd/inp.mp4` 에서 중국어 자막이 **번짐 없이 깨끗하게** 사라짐
- 웹(localhost:3000)에서 분석 → 미리보기에 자막 제거된 영상

## 참고 (이미 동작하는 것 — 건드리지 말 것)
- `subtitle_detect.detect_segments()` = GPU OCR로 자막 위치/시간 탐지 (47초 영상 15초, 정확)
- `app/pipeline/ocr.py` = GPU 자동감지 easyocr reader 캐싱
- 다운로드/TTS/번역/Gemini/웹 모두 동작
