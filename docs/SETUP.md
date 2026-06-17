# 개발 환경 세팅 가이드 (SETUP)

> **갱신일자:** 2026-06-17 · **갱신자:** psj066
>
> 이 문서는 **완전히 빈 Windows PC**에서 코어 엔진이 돌 때까지의 전 과정을 담습니다.
> 아래 명령은 2026-06-17 기준 **이 저장소가 올라간 PC에서 실제로 실행해 검증**한 것입니다.
> 전체 그림은 [README.md](../README.md) 참고.

---

## 0. 전제 / 이 PC 기준 사양

| 항목 | 값 | 비고 |
|------|----|----|
| OS | Windows 11 Pro (64bit) | |
| GPU | NVIDIA RTX 3070 (8GB) | CUDA 12.8 동작 확인 |
| 패키지 관리자 | winget | 시스템 도구 설치에 사용 |
| Python | **3.12** | 3.13+ 는 일부 라이브러리 미검증 — 3.12 고정 |

> ⚠️ **GPU VRAM 8GB 주의:** 과거 문서가 가정한 RTX 5070Ti(16GB)보다 작습니다. ProPainter(1080×1920) 자막제거는 OOM 위험이 있어 **LaMa로 자동 폴백**되도록 코드가 설계돼 있습니다. 동작은 하되, 자막제거 품질 검증 시 이 점을 감안하세요.

---

## 1. 시스템 도구 설치 (winget)

> **왜:** Python·ffmpeg가 없으면 엔진이 한 줄도 못 돕니다. `--scope user`로 설치하면 관리자 권한(UAC) 없이 됩니다.

```powershell
# Python 3.12
winget install --id Python.Python.3.12 --scope user --silent --disable-interactivity --accept-package-agreements --accept-source-agreements

# ffmpeg (영상/오디오 처리)
winget install --id Gyan.FFmpeg --scope user --silent --disable-interactivity --accept-package-agreements --accept-source-agreements
```

설치 후 **새 PowerShell 창**을 열어야 PATH가 반영됩니다. 확인:

```powershell
python --version      # Python 3.12.x  (MS Store 스텁이 뜨면 아래 주의 참고)
ffmpeg -version       # ffmpeg 8.x
```

> **주의 — `python`이 MS Store를 열거나 스텁이면:** winget이 설치한 실제 python은 보통
> `C:\Users\<사용자>\AppData\Local\Programs\Python\Python312\python.exe` 입니다.
> 아래 단계에서 `py -3.12` 대신 이 **전체 경로**를 쓰면 됩니다.

---

## 2. 코어 가상환경(venv) + 의존성

> **왜 venv:** 시스템 Python을 더럽히지 않고, GPU torch를 격리해서 깔기 위함입니다.
> **설치 순서가 중요합니다** — torch(GPU)를 **가장 먼저** 깔아야 easyocr/whisper가 CPU torch를 끌어오지 않습니다.

```powershell
cd packages\core

# 2-1. venv 생성  (py 런처가 있으면)
py -3.12 -m venv .venv
#   (py 런처가 없으면) & "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv .venv

# 2-2. pip 업그레이드
.venv\Scripts\python.exe -m pip install --upgrade pip

# 2-3. ★ torch + torchvision (GPU, CUDA 12.8) — 반드시 먼저
.venv\Scripts\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
#   → torch 2.11.0+cu128, torchvision 0.26.0+cu128 설치됨 (약 2.8GB, 수 분 소요)

# 2-4. 나머지 의존성
.venv\Scripts\python.exe -m pip install -r requirements.txt

# 2-5. 자막제거 LaMa (torch 보존 위해 --no-deps)
.venv\Scripts\python.exe -m pip install --no-deps simple-lama-inpainting

# 2-6. Playwright 브라우저 (도우인/제품 크롤용)
.venv\Scripts\python.exe -m playwright install chromium
```

> ⚠️ **torch 재설치 금지:** 다른 패키지가 torch를 바꾸려 하면 항상 `--no-deps`를 붙이세요. cu128 GPU 빌드를 유지해야 합니다.

### requirements.txt에 이미 반영된 누락 의존성
과거엔 빠져 있던 두 패키지가 현재 [requirements.txt](../packages/core/requirements.txt)에 추가돼 있습니다:
- `playwright-stealth>=2.0.0` — 제품 상세페이지 크롤(`product_scrape.py`)의 `Stealth` 클래스 API(2.x)
- `simple-lama-inpainting` — 주석으로 표기(위 2-5처럼 `--no-deps` 별도 설치)

### ProPainter 저장소 (자막제거 고급 엔진 — 선택, 자동 clone)

> **왜 별도 안내:** ProPainter는 requirements의 `timm`/`addict`/`matplotlib`만 pip로 깔리고, **저장소 본체는 코드에 없습니다**(`.gitignore` 대상). 그래서 설치 단계에 안 보이지만 사실상 요구사항입니다.

- **첫 자막제거 실행 시** `ensure_propainter()`가 GitHub에서 **자동 clone(~303MB) + 가중치(~191MB)** 다운로드 → 첫 분석이 느릴 수 있음
- `.gitignore`라 **프로젝트 clone엔 안 따라옴** → 머신마다 따로 확보됨
- ⚠️ **전제조건: `git`이 서버 PATH에 있어야** 자동 clone이 성공합니다. 없으면 clone 실패 → **LaMa로 폴백**(엔진은 동작하나 ProPainter 품질은 못 씀)
- 아예 끄려면 `$env:PROPAINTER="0"` (항상 LaMa)
- 이미 받았는지 확인: `packages\core\app\pipeline\ProPainter\inference_propainter.py` 존재 여부

---

## 3. 설치 검증

```powershell
# GPU 인식 — True 와 GPU 이름이 나와야 함
.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
#   → 2.11.0+cu128 True NVIDIA GeForce RTX 3070

# 핵심 라이브러리 import — 모두 OK 떠야 함
.venv\Scripts\python.exe -c "import cv2, easyocr, faster_whisper, edge_tts, playwright, deep_translator, fastapi, uvicorn; print('core OK')"
.venv\Scripts\python.exe -c "from playwright_stealth import Stealth; from simple_lama_inpainting import SimpleLama; print('extras OK')"
.venv\Scripts\python.exe -c "from google import genai; from google.cloud import texttospeech; print('google OK')"
```

---

## 4. 자격증명 배치 (선택 — 없으면 해당 기능만 비활성)

> 상세 설명은 [README.md 3-2](../README.md#3-필수-도구-및-접근-권한) 참고. `auth/`는 `.gitignore`로 커밋 안 됨.

```powershell
# auth 폴더는 douyin_auth import 시 자동 생성되지만, 미리 만들어도 됨
New-Item -ItemType Directory -Force packages\core\auth | Out-Null
```

| 파일/변수 | 용도 | 비고 |
|----------|------|------|
| `packages\core\auth\google_tts_key.json` | Google TTS 성우 23종 | 서비스계정 JSON 그대로 배치 |
| `packages\core\auth\gemini_key.txt` 또는 `$env:GEMINI_API_KEY` | AI 대본/제품 소구포인트 | 키 문자열만 |
| 도우인 쿠키 | 도우인 다운로드 | `python -m app.douyin_auth` 실행 → 브라우저 로그인 |

배치 후 인식 확인:
```powershell
.venv\Scripts\python.exe -c "from app.pipeline.google_tts import available as g; from app.pipeline.refine import available as r; print('google_tts:', g(), '/ gemini:', r())"
```

---

## 5. 서버 기동

> **왜 `_run_server.py`인가:** `uvicorn` CLI로 띄우면 워커가 venv가 아닌 글로벌 Python으로 스폰돼 GPU 라이브러리를 못 찾는 버그가 있었습니다. `app/_run_server.py`는 `uvicorn.Server().run()`을 직접 호출하는 **단일 프로세스** 런처로 이 문제를 차단합니다. `scripts\start-core.ps1`이 이걸 venv로 실행합니다.

```powershell
# repo 루트에서
.\scripts\start-core.ps1        # http://localhost:8000 (로그가 이 창에 표시됨)
```

**검증:**
```powershell
# 다른 창에서
Invoke-RestMethod http://127.0.0.1:8000/     # → ok=True
```

웹까지 띄우려면 (Node.js 설치 후):
```powershell
.\scripts\start-all.ps1         # 코어(:8000) + 웹(:3000) 동시
```

> **백엔드 우선 개발이면 `start-core.ps1`만으로 충분**합니다. 웹은 프론트 작업 시작할 때 띄우세요.

---

## 6. 자주 만나는 문제

| 증상 | 원인 / 해결 |
|------|------------|
| `ffmpeg`가 PATH에 없음 | winget 설치 후 **새 셸**을 열어야 반영. 그래도 없으면 `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_*\...\bin` 확인 |
| `python`이 MS Store 열림 | winget이 깐 실제 python(`...\Programs\Python\Python312\python.exe`) 전체 경로 사용 |
| `torch.cuda.is_available()` = False | NVIDIA 드라이버 최신화. cu128은 비교적 최신 드라이버 필요 |
| pip이 torch를 CPU판으로 바꾸려 함 | 해당 설치에 `--no-deps` 추가 |
| ProPainter OOM | 정상(8GB 한계) — 자동으로 LaMa 폴백됨. 끄려면 `$env:PROPAINTER="0"` |
| ProPainter가 안 돌고 항상 LaMa | 저장소 미clone 또는 `git`이 PATH에 없어 자동 clone 실패. `git`을 PATH에 추가하거나 ProPainter 폴더 수동 확보 (위 §2 참고) |
| 서버가 떴는데 분석이 실패 | `:8000` LISTEN 프로세스가 **venv python**인지 확인 (글로벌이면 GPU 라이브러리 못 찾음) |

### 프로세스 종료 시 주의
서버를 죽일 땐 **넓은 패턴(`*python*`, `*uvicorn*`) 금지.** 포트나 스크립트명으로 좁혀서:
```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

> 참고: Windows venv에서는 `python.exe`가 리다이렉터라 작업관리자에 **프로세스가 2개**(런처+실제), 실제 프로세스의 이미지 경로가 **"글로벌 Python"으로 표시**될 수 있습니다. `sys.prefix`는 venv를 가리키므로 **정상**입니다(패키지는 venv에서 로드됨).
