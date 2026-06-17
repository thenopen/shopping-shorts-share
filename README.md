# 쇼핑 쇼츠 메이커 (Shopping Shorts Maker)

> **갱신일자:** 2026-06-17 · **갱신자:** psj066
>
> 신임 개발자는 이 문서를 **위에서 아래로 한 번** 읽으면 프로젝트 전체를 파악할 수 있습니다.
> 더 깊은 내용은 [docs/SETUP.md](docs/SETUP.md)(환경 세팅)와 [docs/STATUS.md](docs/STATUS.md)(진행상황·이슈)로 연결됩니다.

---

## 목차
1. [프로젝트 개요](#1-프로젝트-개요)
2. [핵심 로직 (아키텍처 · 파이프라인)](#2-핵심-로직-아키텍처--파이프라인)
3. [필수 도구 및 접근 권한](#3-필수-도구-및-접근-권한)
4. [개발 환경 세팅](#4-개발-환경-세팅)
5. [현재 진행 상황 및 이슈](#5-현재-진행-상황-및-이슈)
6. [온보딩 체크리스트](#6-온보딩-체크리스트)

---

## 1. 프로젝트 개요

### 무엇인가
**도우인(중국 틱톡) 상품 영상 링크 → 한국어 쇼핑 쇼츠(9:16 세로 mp4)로 자동 변환**하는 도구입니다.
영상을 받아 → 중국어 자막/워터마크를 AI로 지우고 → 한국어로 더빙·자막을 입혀 → 완성된 쇼츠를 뽑아냅니다.

### 왜 존재하는가
완성된 쇼츠를 틱톡/인스타 등에 올리고 **제휴 링크(올리브영 큐레이터, 쿠팡파트너스 등)로 수익화**하는 것이 비즈니스 목표입니다.
핵심 가치는 **"링크 하나 → 완성 쇼츠"의 자동화**와, 강의용 도구보다 **강력한 자막 편집기**입니다.

> ⚠️ **저작권 고지:** 남의 영상을 재가공해도 원저작권은 살아있습니다. "재가공하면 저작권 OK"는 사실이 아닙니다. 도구는 기술적으로 동작하게 만들되, **사용에 대한 법적 책임은 사용자 본인**에게 있다는 포지션으로 설계합니다.

### 제품 형태 — **데스크톱 우선 (확정)**
이 프로젝트는 **데스크톱 앱(사용자 PC에서 로컬 처리)을 1순위**로 개발합니다.

- **왜 데스크톱 우선인가:** 도우인 다운로드는 사용자의 PC·IP·로그인으로 처리해야 차단·법적 노출·서버비 문제를 피할 수 있습니다. 한국의 유사 도구들이 데스크톱 앱인 이유도 이것입니다.
- **지금 신경 쓰지 않는 것:** 공개 웹 SaaS 백엔드(`server` 패키지), 결제·인증, Tailscale 원격접속. → 모두 "나중에 웹 서비스로 확장할 때" 다룹니다.

### 현재 개발 단계
| 영역 | 완성도 | 한 줄 |
|------|:---:|------|
| 코어 변환 엔진 (`core`) | ~75% | 메인 흐름 동작. 얼굴컷·BGM 미구현, ProPainter 불안정 |
| 웹 UI (`web`) | ~80% | 제작·자막편집 흐름 완성. 인증/결제/큐 UI 없음 |
| 데스크톱 셸 (`desktop`) | 0% | 미착수 (Tauri) — **다음 목표** |
| SaaS 백엔드 (`server`) | ~5% | 빈 스텁. 데스크톱 우선이라 보류 |

> 한 줄 요약: **"제작 도구"로는 거의 동작, "배포 가능한 앱"으로는 데스크톱 셸을 씌우는 단계.**
> 상세 진행상황·이슈·로드맵은 → [docs/STATUS.md](docs/STATUS.md)

---

## 2. 핵심 로직 (아키텍처 · 파이프라인)

### 2-1. 모노레포 구조 — 무엇이 실제로 들어있나

```
packages/
├── core/     ← 영상처리 엔진 + FastAPI 서버  [동작]  ★ 지금 개발의 전부
├── web/      ← Next.js UI                    [동작]  ★ 데스크톱 셸이 재사용할 화면
├── server/   ← SaaS 백엔드(인증/결제/큐)      [빈 스텁]  데스크톱 우선이라 보류
└── desktop/  ← Tauri 데스크톱 셸             [미착수]  다음 목표
shared/       ← 패키지 공통 스키마(JSON)
scripts/      ← 서버 실행용 PowerShell 스크립트
```

> **꼭 알아둘 것:** 문서상으론 `core`/`server`가 나뉜 듯 보이지만, **실제로는 `core` 하나에 "엔진 + API 서버"가 다 들어있고, `server`는 비어 있습니다.** `web`은 `server`를 거치지 않고 **`core`에 직접** 붙습니다.
> - `core` = **엔진**(실제 영상처리) — 데스크톱 우선에선 이게 전부
> - `server` = **사업 계층**(로그인·결제·줄세우기) — 공개 웹 SaaS 할 때만 채울 빈칸

### 2-2. 런타임 흐름 — 지금 실제로 도는 모습

```
[사용자 브라우저]
     │  HTTP (분석 / 대본 / TTS / 렌더 요청)
     ▼
[web · Next.js  :3000]      ← scripts/start-web.ps1
     │  fetch → window.location.hostname : 8000   (web이 core에 직접 호출)
     ▼
[core · FastAPI :8000]      ← scripts/start-core.ps1 → app/_run_server.py (단일 프로세스)
     │  요청마다 백그라운드 워커(threading) 실행
     ▼
[pipeline/* 단계별 모듈]
     ▼
workdir/<job_id>/output.mp4  →  GET /file/{job}/{name} 로 서빙 → 브라우저서 재생·다운로드
```

- 현재는 이 전부가 **한 PC에서 로컬로** 돕니다 (웹 프론트 + 로컬 파이썬 백엔드 = 2-tier).
- **데스크톱 앱이 되면:** Tauri 셸이 `web`의 화면을 WebView로 띄우고, `core`를 `core.exe` **사이드카**로 실행 → WebView가 `127.0.0.1:8000`에 붙습니다. **즉 위 흐름에 "껍데기"만 씌우는 것** — IPC를 새로 짤 필요가 없습니다.

### 2-3. 변환 파이프라인 — 핵심 9단계

영상 1개가 거치는 단계입니다. 각 단계 = `packages/core/app/pipeline/` 안의 파일 1개.

```
[도우인/유튜브 링크]
   │
   ▼ [1] 다운로드        download.py(yt-dlp) · douyin_download.py(Playwright)   ✅
   ▼ [2] 사운드 제거     audio_strip.py (ffmpeg -an)                            ✅
   ▼ [3] 자막·워터마크   subtitle_detect(OCR 위치탐지)                          ✅
        AI 제거          → propainter_inpaint(시간축 복원) ─실패→ subtitle_inpaint(LaMa)
   ▼ [4] 얼굴샷 컷 제거  face_cut.py                                            ⬜ 미구현
   ▼ [5] 한국어 TTS      tts.py → google_tts(Chirp3-HD) ─없으면→ edge-tts        ✅
   ▼ [6] 자동 자막(ASS)  caption.py (구간별 폰트/색/테두리/박스/위치)            ✅
   ▼ [7] BGM/효과음      audio_mix.py                                           ⬜ 미구현
   ▼ [8] CTA 멘트        compose.py (drawtext)                                  ✅
   ▼ [9] 9:16 합성       compose.py (ffmpeg 인코딩)                             ✅
   │
   ▼ [완성 쇼츠 mp4]
```

**부가 기능 (메인 9단계 밖):**
- **중국어 음성 → 한국어 대본:** `transcribe.py`(faster-whisper STT) + `translate.py`(Google 번역)
- **AI 대본 가공:** `refine.py` (Gemini 2.5 — 번역투 제거 / Antigravity 검수)
- **제품 상세페이지 → 소구포인트:** `product_scrape.py` (URL/캡처 → Gemini 비전) → 영상 내용과 결합 대본

> 자세한 모듈별 역할은 각 파일 상단 docstring에 한국어로 적혀 있습니다. **`server_api.py`가 실제 오케스트레이터**입니다 (`run.py`는 참고용 CLI로, 실서비스 경로가 아님).

---

## 3. 필수 도구 및 접근 권한

> **원칙:** 각 항목은 "무엇 / **왜 필요한지** / 어떻게 설정하는지"를 함께 적습니다. 설치 명령의 실제 검증된 순서는 [docs/SETUP.md](docs/SETUP.md)에 있습니다.

### 3-1. 코어 동작에 반드시 필요 (없으면 엔진이 안 돔)

| 도구 | 왜 필요한가 | 설정 |
|------|------------|------|
| **Python 3.12** | 파이프라인·서버 전체가 Python | `winget install Python.Python.3.12` |
| **ffmpeg** | 모든 영상/오디오 처리(합성·인코딩·프레임 재조립)가 ffmpeg 호출 | `winget install Gyan.FFmpeg` |
| **NVIDIA GPU + torch (cu128)** | OCR·STT·AI 자막제거가 **GPU 연산**. CPU로는 비현실적으로 느림 | `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128` |
| **simple-lama-inpainting** | 자막 AI 제거(LaMa 폴백) | `pip install --no-deps simple-lama-inpainting` (torch 보존) |
| **Playwright + chromium** | 도우인 다운로드·제품 크롤이 실제 브라우저 사용 | `pip install playwright-stealth` → `python -m playwright install chromium` |

> ⚠️ **torch는 절대 재설치/다운그레이드 금지.** GPU(cu128) 빌드를 유지해야 합니다. 다른 패키지가 torch를 바꾸려 하면 `--no-deps`로 설치하세요.

### 3-2. 기능별 자격증명 (없으면 그 기능만 비활성 — 서버는 뜸)

| 자격증명 | 왜 필요한가 | 없으면 | 설정 |
|---------|------------|--------|------|
| **Google Cloud TTS 키** (서비스계정 JSON) | 한국어 성우 더빙(Chirp3-HD 23종) | edge-tts 폴백 → 성우 **2종**으로 축소 | `packages/core/auth/google_tts_key.json`에 배치 · **[미정 → 서면문의 #2](docs/OPEN_INQUIRIES.md)** |
| **Gemini API 키** | AI 대본가공·Antigravity 검수·제품 소구포인트 추출 | 해당 기능 400 에러 (STT 자동대본은 동작) | `GEMINI_API_KEY` 환경변수 또는 `packages/core/auth/gemini_key.txt` · **[미정 → 서면문의 #3](docs/OPEN_INQUIRIES.md)** |
| **도우인 로그인 쿠키** | 도우인 영상 다운로드 | 도우인만 실패 (유튜브 등은 OK) | **API 키가 아님 — 로그인 세션 쿠키.** `python -m app.douyin_auth` 실행 후 브라우저에서 1회 로그인 · **[미정 → 서면문의 #4](docs/OPEN_INQUIRIES.md)** |

> 🔒 `auth/` 폴더는 `.gitignore`에 등록되어 **커밋되지 않습니다**(민감정보 보호). 키를 넣어도 안전합니다.

### 3-3. 선택 · 상황별

| 도구 | 왜 / 언제 | 비고 |
|------|----------|------|
| **GitHub 저장소 접근** | 소스 클론/푸시 | repo: `ShiningShuri/shopping-shorts-maker` (Private) · **[미정 → 서면문의 #1](docs/OPEN_INQUIRIES.md)** |
| **Node.js** | `web`(Next.js) 개발/빌드 | **프론트엔드 작업 시작할 때** 설치 (`winget install OpenJS.NodeJS`). 백엔드 개발만이면 불필요 |
| **Tailscale** | 로컬 앱을 폰·태블릿에서 **원격 테스트** | **개발/소규모 베타 전용** — 공개 SaaS 배포 수단 아님. 데스크톱 우선이면 현재 불필요 |
| **ProPainter** (자막제거 고급·자동) | 자막제거 품질↑(시간축 복원). 없으면 **LaMa 자동 폴백**(엔진은 동작) | 첫 자막제거 시 **자동 clone(~303MB)+가중치(~191MB)** · `.gitignore`라 머신마다 확보 · ⚠️ **`git`이 PATH에 있어야 clone 성공** · `PROPAINTER=0`으로 off. 상세 → [SETUP §2](docs/SETUP.md) |

---

## 4. 개발 환경 세팅

> 전체 단계별 명령(이 PC에서 실제 검증됨)은 → **[docs/SETUP.md](docs/SETUP.md)**. 아래는 요약입니다.

**전제:** Windows 11, NVIDIA GPU, winget 사용 가능.

```powershell
# 1) 시스템 도구 (winget, user 범위 → 관리자 권한 불필요)
winget install Python.Python.3.12
winget install Gyan.FFmpeg

# 2) 코어 venv + 의존성
cd packages\core
py -3.12 -m venv .venv      # (py 런처 없으면 설치된 python312\python.exe 직접 사용)
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m pip install --no-deps simple-lama-inpainting
.venv\Scripts\python.exe -m playwright install chromium

# 3) GPU 확인 (True가 나와야 함)
.venv\Scripts\python.exe -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"

# 4) 자격증명 배치 (3-2 참고): auth\google_tts_key.json, auth\gemini_key.txt

# 5) 코어 서버 기동 (repo 루트에서)
.\scripts\start-core.ps1     # http://localhost:8000
```

**검증:** 브라우저로 `http://localhost:8000/` → `{"ok":true, ...}` 응답이 오면 성공.

> 프론트엔드(`web`)까지 띄우려면 Node.js 설치 후 `scripts\start-all.ps1` (코어+웹 동시). 지금은 **백엔드 우선이라 `start-core.ps1`만으로 충분**합니다.

---

## 5. 현재 진행 상황 및 이슈

> 이 섹션은 자주 바뀌므로 **요약만** 둡니다. 상시 갱신되는 상세본은 → **[docs/STATUS.md](docs/STATUS.md)**

### 지금 막 끝난 것
- ✅ **새 PC 환경 부트스트랩 완료** (Python 3.12.10 · ffmpeg 8.1.1 · torch 2.11.0+cu128 / RTX 3070 · 전체 의존성 · chromium). 코어 서버 기동·`{"ok":true}` 응답 검증됨.

### 다음 우선순위
1. **1단계 E2E 검증** — 실제 링크로 다운로드→자막제거까지 완주(엔진이 GPU 라이브러리를 in-process로 쓰는지 최종 확인)
2. **자격증명 배치** — Google TTS · Gemini 키
3. **데스크톱(Tauri) 셸 착수** — `core`를 사이드카로, `web` UI를 WebView로

### 알려진 주요 이슈 / 미구현
| 항목 | 내용 |
|------|------|
| ⬜ 얼굴샷 컷 제거 | `face_cut.py` 미구현(NotImplementedError) |
| ⬜ BGM/효과음 | `audio_mix.py` 미구현 + `assets/bgm`·`sfx` 폴더 없음 |
| 🟡 자막 효과 정합 | 편집기의 글로우/그림자색/박스 둥글기가 **미리보기 전용** — 최종 영상(ASS)엔 미반영 |
| 🟡 자막 싱크 저하 | Google TTS는 단어 타임스탬프를 안 줘서 자막이 균등분할로 폴백 |
| 🟡 ProPainter 불안정 | RTX 3070 8GB에선 OOM 위험 → LaMa로 자동 폴백 |
| ⚠️ 작업 상태 비영속 | 서버 인메모리 `JOBS` dict — 재시작 시 소실(DB 미구현) |

---

## 6. 온보딩 체크리스트

신임 개발자가 **첫 주 안에** 완료할 항목입니다.

### Day 1 — 이해 & 접근
- [ ] 이 README를 끝까지 읽는다
- [ ] [docs/STATUS.md](docs/STATUS.md)로 현재 작업/이슈 파악
- [ ] GitHub 저장소 접근 권한 받기 → clone **[미정 → 문의 #1](docs/OPEN_INQUIRIES.md)**
- [ ] "왜 데스크톱 우선인가"를 이해한다 (도우인 다운로드 차단/법적 노출/서버비)

### Day 2 — 환경 구축
- [ ] [docs/SETUP.md](docs/SETUP.md) 따라 코어 환경 구축 (Python/ffmpeg/venv/torch-GPU)
- [ ] `torch.cuda.is_available()` → `True` 확인
- [ ] `scripts\start-core.ps1`로 서버 기동 → `http://localhost:8000/` 응답 확인

### Day 3 — 자격증명 & 첫 변환
- [ ] `auth/`에 Google TTS · Gemini 키 배치 **[미정 → 문의 #2·#3](docs/OPEN_INQUIRIES.md)**
- [ ] (도우인 쓸 경우) `python -m app.douyin_auth`로 로그인 쿠키 확보
- [ ] 유튜브 등 링크로 **분석→자막제거 미리보기**까지 1회 성공 (E2E 감 잡기)

### Day 4~5 — 코드 읽기 & 첫 기여
- [ ] `server_api.py`의 3개 워커(analyze/transcribe/render) 흐름 따라가기
- [ ] `pipeline/` 각 파일 docstring 훑기 (단계별 역할)
- [ ] `web/app/page.tsx` UI ↔ API 호출 매핑 이해
- [ ] 작은 이슈 1개 골라 수정 PR **[미정 → 문의 #6](docs/OPEN_INQUIRIES.md)**

---

## 부록: 문서 지도

| 문서 | 용도 |
|------|------|
| **README.md** (이 문서) | 온보딩 메인 — 전체 그림 |
| [docs/SETUP.md](docs/SETUP.md) | 환경 세팅 상세 (명령 단위) |
| [docs/STATUS.md](docs/STATUS.md) | 진행상황·이슈·로드맵 (상시 갱신) |
| [docs/references/](docs/references/) | 참고 자료 (예: 올리브영 큐레이터 수익구조) |

> 구버전 문서(`ARCHITECTURE.md`, `PLAN.md`, `HANDOFF.md`, `TASK_*.md`)는 내용이 낡아 **[docs/archive/](docs/archive/)로 아카이브** 완료했습니다(삭제 아님 — 서면문의 #5 결정). 정리 내역은 [docs/STATUS.md](docs/STATUS.md) §7.
