# 쇼핑 쇼츠 메이커 (Shopping Shorts Maker)

![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)
> *배지의 OWNER/REPO 를 실제 저장소로 바꿔주세요.*

> 상품 영상 링크 → **한국어 쇼핑 쇼츠(9:16 세로 영상)** 로 자동 변환하는 도구입니다.
> 영상에서 중국어 자막/워터마크를 AI로 지우고 → 한국어 대본·더빙·자막을 입혀 → 완성 쇼츠를 뽑아냅니다.
>
> **이 문서는 처음 쓰는 분을 위한 설치·설정 가이드입니다.** 각자 본인 PC에 설치하고, 본인 API 키를 넣어서 사용합니다.

---

## ⚠️ 먼저 읽어주세요 (저작권)
남의 영상을 재가공해도 **원저작권은 그대로 살아있습니다.** "재가공하면 저작권 OK"는 사실이 아니에요.
이 도구의 사용에 대한 **법적 책임은 사용자 본인**에게 있습니다. 참고해서 활용하세요.

---

## 📋 목차
1. [준비물](#1-준비물)
2. [설치](#2-설치)
3. [실행](#3-실행)
4. [🔑 API 키 발급 — 여기가 핵심](#4--api-키-발급--여기가-핵심)
5. [어떤 키가 어떤 기능에 필요한가](#5-어떤-키가-어떤-기능에-필요한가)
6. [폰·아이패드에서 접속](#6-폰아이패드에서-접속)
7. [자주 막히는 부분](#7-자주-막히는-부분)

---

## 1. 준비물

Windows PC 기준, 아래 4가지가 필요합니다. (설치 상세는 [docs/SETUP.md](docs/SETUP.md) 참고)

| 프로그램 | 용도 | 받는 곳 |
|---|---|---|
| **Python 3.12** | 영상 처리 엔진 | https://www.python.org/downloads/ (3.12 버전) |
| **Node.js** (LTS) | 웹 화면 | https://nodejs.org/ |
| **FFmpeg** | 영상·오디오 변환 | https://www.gyan.dev/ffmpeg/builds/ 또는 `winget install Gyan.FFmpeg` |
| **Git** | 다운로드·자동설치 | https://git-scm.com/download/win |

> GPU(NVIDIA)가 있으면 더 빠르지만, **자막 제거는 클라우드(Modal)로 돌리므로 GPU가 없어도 됩니다.**

---

## 2. 설치

> 아래는 요약입니다. 처음이라면 [docs/SETUP.md](docs/SETUP.md)를 한 번 그대로 따라 하세요.

> 📦 **폰트 파일은 저장소에 포함되지 않습니다**(총 1.7GB라 GitHub 부적합).
> 자막 burn-in용 한글 폰트는 `packages/core/assets/fonts/` 에 직접 넣어야 합니다.
> 최소한 `Pretendard.ttf`(CTA·자막 기본 폰트)와 자막에 쓸 폰트들을
> [Pretendard GitHub](https://github.com/orioncactus/pretendard) 등에서 받아 넣어주세요.
> 웹 폰트 미리보기용 woff2는 `packages/web/public/fonts/` 에 넣고 `npm run gen:fonts` 로 CSS를 재생성하세요.

```powershell
# 0) 이 저장소 받기
git clone <이 저장소 주소> shopping-shorts-maker
cd shopping-shorts-maker

# 1) 코어(엔진) 설치 — packages/core
cd packages\core
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
# ★ torch 먼저 (GPU 있으면 cu128, 없으면 일반)
.venv\Scripts\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m pip install --no-deps simple-lama-inpainting
.venv\Scripts\python.exe -m playwright install chromium

# 2) 웹 화면 설치 — packages/web
cd ..\web
npm install
```

설치가 끝나면 **API 키만 넣으면** 바로 씁니다 (아래 4번).

---

## 3. 실행

프로젝트 폴더에서 **`scripts\start-all.ps1`**(Windows) 또는 **`scripts/start-all.sh`**(macOS/Linux) 을 실행하면 코어(엔진)와 웹이 함께 켜집니다.
(또는 터미널에서 아래를 각각 실행)

**Windows (PowerShell):**
```powershell
# 코어 엔진 (8000)
powershell -File scripts\start-core.ps1
# 웹 화면 (3000)
powershell -File scripts\start-web.ps1
```

**macOS / Linux (bash):**
```bash
# 코어 엔진 (8000)
bash scripts/start-core.sh
# 웹 화면 (3000)
bash scripts/start-web.sh
```

브라우저에서 **http://localhost:3000** 접속 → 오른쪽 위 **⚙️ 설정**에서 API 키를 넣습니다.

> **🔐 접속 토큰 (2026-08-09~)**: 코어 서버가 처음 켜질 때 **접속 토큰** 1개를 만들어
> 터미널(콘솔)에 큰 글씨로 표시합니다. 같은 PC 웹은 토큰 없이 바로 되지만,
> **폰/다른 기기**에서 접속할 땐 이 토큰이 처음 한 번 필요해요. 토큰을 잊으면
> `packages\core\workdir\auth_token.txt` 를 삭제하고 서버를 다시 켜면 새 토큰이 나와요.
> (혼자 쓰는 PC에서 토큰 입력이 귀찮으면 코어 실행 전 `ALLOW_NO_AUTH=1` 환경변수로 끌 수 있어요 — 단, 폰 접속 등 외부 노출 땐 끄지 마세요.)

---

## 4. 🔑 API 키 발급 — 여기가 핵심

이 앱은 **본인 API 키(BYOK)** 로 동작합니다. 아래에서 필요한 키를 발급받아 **⚙️ 설정** 창에 넣으세요.
키는 **본인 서버(내 PC)에만 저장**되고 화면엔 끝 4자리만 보입니다. 대부분 **무료 등급**으로 시작할 수 있어요.

### ① Gemini (대본 생성) — *필수*
AI가 상품 이미지·영상에서 대본을 만들어 줍니다.
1. https://aistudio.google.com/apikey 접속 (구글 로그인)
2. **"Create API key"** 클릭 → `AQ.…` 또는 `AIza…` 로 시작하는 키 복사
3. ⚙️ 설정 → **Gemini API 키** 칸에 붙여넣기 → 저장
- 무료 등급 있음. Google AI Studio.

### ② Typecast (음성·한국어 감정) — *음성용, 택1*
한국어 감정 표현이 좋은 TTS.
1. https://typecast.ai 가입 → **Developers / API** 메뉴에서 키 발급
2. ⚙️ 설정 → **Typecast API 키** 칸에 붙여넣기
- 무료 **월 3만 자**.

### ③ ElevenLabs (음성·다국어) — *음성용, 택1*
1. https://elevenlabs.io 가입 → 우측 상단 프로필 → **API Keys** (직접: https://elevenlabs.io/app/settings/api-keys)
2. `sk_…` 키 복사 → ⚙️ 설정 → **ElevenLabs API 키** 칸에 붙여넣기

### ④ Google Cloud (음성·간편) — *음성용, 택1*
1. https://console.cloud.google.com 접속 → 프로젝트 만들기
2. **"Cloud Text-to-Speech API"** 검색 → **사용 설정(Enable)**
3. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → API 키** → `AIza…` 복사
4. ⚙️ 설정 → **Google Cloud API 키** 칸에 붙여넣기

> 음성(②③④)은 **하나만 있어도** 됩니다. 셋 다 넣으면 보이스 화면에서 엔진을 골라 쓸 수 있어요.

### ⑤ Modal (자막 제거·클라우드 GPU) — *자막 지우기 쓸 때만*
중국어 자막/워터마크 지우기를 **클라우드 GPU**로 처리합니다. (내 PC에 GPU 없어도 됨)
1. https://modal.com 가입 (GitHub/구글 로그인, 카드 없이 **월 $30 크레딧**)
2. **Settings → Tokens** (직접: https://modal.com/settings/tokens) → **New token**
3. **Token ID(`ak-…`)** 와 **Token Secret(`as-…`)** 두 개 복사 → ⚙️ 설정 → **Modal 토큰** 칸에 각각 붙여넣기
   - ⚠️ Secret은 **그때 한 번만** 보입니다. 창 닫기 전에 복사!
   - 넣으면 자막제거용 GPU 함수가 **본인 Modal 계정에 자동 배포**됩니다(첫 배포는 몇 분 걸림).

---

## 5. 어떤 키가 어떤 기능에 필요한가

| 하고 싶은 것 | 필요한 키 |
|---|---|
| 상품 이미지·영상 → **대본 생성** | Gemini |
| **음성 더빙** (TTS) | Typecast / ElevenLabs / Google 중 **하나** |
| 자막 만들기 · 영상 렌더 | (음성 키만 있으면 됨) |
| **중국어 자막 지우기** | Modal |

> 즉 **대본 + 더빙**만 할 거면 → **Gemini + 음성 1개**면 충분합니다. Modal은 자막 지울 때만.

---

## 6. 폰·아이패드에서 접속

같은 와이파이라면 폰·아이패드에서도 쓸 수 있어요.
1. 코어 서버가 켜진 터미널(콘솔)에 표시된 **접속 토큰**을 확인하세요 (예: `http://<이 PC IP>:3000/?token=XXXXXXXX` 형태의 주소가 콘솔에 같이 나와요).
2. 폰 브라우저에 그 주소(`?token=...` 포함)를 그대로 입력 → 토큰이 폰에 자동 저장돼 다음부턴 토큰 없이 써요.
3. 폰에서 접속이 안 되면 → 방화벽에서 **3000 포트**를 열어주세요 (`scripts\allow-phone-access.ps1` 참고)
4. 주소만 입력하고 토큰을 깜빡했다면 → 열린 화면의 토큰 입력창에 토큰을 붙여넣으면 돼요.

---

## 7. 자주 막히는 부분

- **설치할 때 파란 경고창(“알 수 없는 게시자”)** → 정상입니다. **추가 정보 → 실행**을 누르세요.
- **`python`이 Microsoft Store를 열거나 안 됨** → winget으로 깐 실제 python은 보통
  `C:\Users\<사용자>\AppData\Local\Programs\Python\Python312\python.exe` 입니다. 이 전체 경로를 쓰세요.
- **대본 생성 시 "Internal Server Error"** → ⚙️ 설정에 **Gemini 키**가 없어서예요. 넣으면 됩니다.
- **음성 화면이 "키가 필요해요"** → 그 엔진의 API 키를 설정에 넣으면 목록이 떠요. 위 탭에서 다른 엔진으로 바꿀 수도 있어요.
- **자막 제거가 안 됨** → Modal 토큰이 필요하고, 첫 실행 때 GPU 함수 배포(몇 분)가 끝나야 합니다.
- **폰/다른 기기에서 "인증 필요(401)"** → 접속 토큰이 없거나 틀려서예요. 코어 서버 터미널에 표시된 토큰으로 `?token=...` 주소로 다시 들어가거나, 토큰 입력창에 붙여넣으세요.
- **접속 토큰을 잊음** → `packages\core\workdir\auth_token.txt` 를 삭제하고 코어를 다시 켜면 새 토큰이 나와요.

---

### 더 깊은 내용
- 개발자용 상세 문서: [docs/DEVELOPER.md](docs/DEVELOPER.md)
- 설치 전 과정: [docs/SETUP.md](docs/SETUP.md)
- 진행 상황·이슈: [docs/STATUS.md](docs/STATUS.md)
