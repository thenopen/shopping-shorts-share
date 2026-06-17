# AI 쇼핑 쇼츠 메이커 ("숏핏메이커" 클론)

> 도우인 영상 링크 → 한국어 쇼츠 자동 변환 데스크톱 앱.
> 강의에서 파는 "숏핏메이커"보다 예쁜 UI + 더 강력한 자막 편집기. 무료 스택 자체 구현.

---

## 0. 리스크 고지 (읽고 시작)

- 남의 영상 재가공해도 **원저작권은 살아있음**. "재가공하면 저작권 문제 없음"은 마케팅 멘트, 사실 아님.
- 도우인 영상 무단 다운로드 = 플랫폼 약관 위반.
- 도구는 기술적으로 동작하게 만듦. **사용 법적 책임은 전적으로 사용자 본인.**

---

## 1. 핵심 파이프라인 (확정)

```
[도우인 링크 붙여넣기]
   │
   ▼
[1] 다운로드 + 분석          yt-dlp + ffprobe (해상도/길이/자막유무)
   │
   ▼
[2] 사운드 제거              원본 오디오 트랙 제거
   │
   ▼
[3] 중국어 자막 제거          작은글씨=가우시안 블러 / 큰글씨=자막바 박스로 덮기
   │
   ▼
[4] 얼굴 전체샷 컷 제거        얼굴 크게 잡힌 구간 탐지 → 해당 컷 잘라냄
   │
   ▼
[5] 대본 입력 + TTS          edge-tts 더빙 (성우 선택, 배속 조절)
   │
   ▼
[6] 자동 자막 생성            TTS 타임스탬프 → 화면 자막 (구간별 폰트/사이즈/효과)
   │
   ▼
[7] BGM + 효과음             무료 음원 믹싱
   │
   ▼
[8] CTA 멘트                 고정댓글 / 프로필링크 / 하단링크 중 택1
   │
   ▼
[9] 합성/인코딩              ffmpeg 9:16 세로 mp4
   │
   ▼
[완성 쇼츠]
```

---

## 2. 기능 명세 (스크린샷 + 추가요구 반영)

### 입력/작업관리
- 도우인 링크 붙여넣기, 여러 개 큐로 일괄처리
- 결과 폴더 지정/변경
- 작업 진행률 표시 (단계별 % + 전체 %)

### 자막 제거 (난이도 최상)
- **작은 글씨**: 가우시안 블러 처리
- **큰 글씨**: 불투명 자막바(박스)로 덮기
- 영역 자동탐지(OCR, 옵션) 또는 하단 고정영역(기본)

### 얼굴 컷 제거
- 얼굴이 화면에 크게 잡힌 구간 탐지 → 그 컷 잘라냄 (제품샷 위주로 남김)
- OpenCV/mediapipe 얼굴탐지 → 구간 잘라내고 재연결

### TTS 더빙
- 성우 선택 (한국어 보이스 매핑): 하은/서연/소담/제니/안나/태형/지연/상호
- **배속 조절** (rate)
- 피치 조절

### 자막 생성 (편집기 — 강의 도구보다 강력하게)
- TTS 음성 타임스탬프 기반 자동 싱크
- **구간별 다른 폰트 / 다른 사이즈** 선택
- 폰트: G마켓산스, 프리텐다드, 서울한강체, 페이퍼로지, 티몬체, 머니그라피 (무료폰트 번들)
- **그라데이션 / 테두리(outline) / 그림자(shadow) 효과**
- 자막 기울기(italic) 옵션
- **템플릿 저장/불러오기** (스타일 프리셋)

### BGM / 효과음
- 무료 음원 라이브러리에서 선택, 볼륨조절, 믹싱

### CTA
- 영상 마지막 멘트 3종: "고정댓글 확인" / "프로필 링크" / "하단 링크 클릭"

---

## 3. 기술 스택 (전부 무료)

### 데스크톱 셸 — Tauri (추천 확정)
- React UI(예쁜 디자인) + Rust 셸. 용량 ~10MB, 가벼움.
- 로컬 파일/폴더 접근 쉬움 (결과폴더 기능 필수).
- Python 영상처리를 **사이드카(sidecar) 프로세스**로 호출.

### 영상처리 코어 — Python 3.12
| 기능 | 라이브러리 | 비용 |
|------|-----------|------|
| 다운로드 | yt-dlp | 무료 |
| 영상 합성/인코딩 | ffmpeg (CLI) | 무료 |
| **TTS** | **edge-tts** (타임스탬프 지원) | **무료, API키X** |
| 자막바/블러 | ffmpeg (boxblur, drawbox) | 무료 |
| 얼굴 탐지 | mediapipe 또는 opencv haar | 무료 |
| 자막 렌더 (효과) | ASS 자막 (libass) — 그라데이션/테두리/쉐도우 지원 | 무료 |
| OCR (옵션) | easyocr | 무료 |
| STT (옵션, 자동대본) | faster-whisper | 무료 |
| DB | SQLite | 무료 |

### TTS 상세
- **edge-tts**: MS Edge 뉴럴 보이스 무료. API키 없음. ✓동작확인됨(7.2.8)
- WordBoundary 타임스탬프 추출 → 자막 자동싱크에 사용
- rate(배속)/pitch 조절 지원

### 자막 효과 = ASS 자막 (핵심)
- ffmpeg `drawtext`로는 그라데이션/구간별스타일 한계.
- **ASS(Advanced SubStation Alpha)** 포맷 사용 → libass 렌더.
- 폰트/사이즈/색/테두리/그림자/기울기/위치 구간별 자유. 템플릿화 쉬움.

---

## 4. 폴더 구조

```
쇼핑쇼츠/                      ← 프로젝트 root (오토워커와 분리)
├── PLAN.md / README.md
├── core/                      ← Python 영상처리 (구 backend/)
│   ├── app/
│   │   ├── config.py
│   │   ├── pipeline/
│   │   │   ├── download.py        ← yt-dlp + 분석
│   │   │   ├── audio_strip.py     ← 사운드 제거
│   │   │   ├── subtitle_remove.py ← 블러/자막바 덮기
│   │   │   ├── face_cut.py        ← 얼굴샷 컷 제거
│   │   │   ├── tts.py             ← edge-tts (타임스탬프)
│   │   │   ├── caption.py         ← ASS 자막 생성 (효과/구간별)
│   │   │   ├── audio_mix.py       ← BGM/효과음
│   │   │   ├── compose.py         ← ffmpeg 최종합성
│   │   │   └── run.py             ← 오케스트레이터
│   │   ├── voices.py              ← 성우 닉네임↔edge-tts 매핑
│   │   ├── templates.py           ← 자막 템플릿 프리셋
│   │   └── ipc.py                 ← Tauri JSON stdin/stdout 통신
│   ├── assets/
│   │   ├── fonts/                 ← 무료 폰트 6종 ttf
│   │   ├── bgm/                   ← 무료 BGM
│   │   └── sfx/                   ← 무료 효과음
│   └── requirements.txt
├── desktop/                   ← Tauri 앱
│   ├── src/                       ← React UI
│   ├── src-tauri/                 ← Rust 셸 + 사이드카 설정
│   └── package.json
└── shared/
    └── affiliate/             ← 제휴링크 관리
```

---

## 5. 로드맵

### Phase 0 — 셋업 ✅
- [x] 폴더/venv/requirements, edge-tts 무료동작 확인

### Phase 1 — 코어 파이프라인 CLI (현재)
- [x] download / tts / compose 기초
- [ ] audio_strip (사운드 제거)
- [ ] subtitle_remove (블러 + 자막바)
- [ ] caption (ASS 자막 + 효과)
- [ ] run.py 전체 연결, 실영상 E2E

### Phase 2 — 고급 처리
- [ ] face_cut (얼굴샷 컷 제거)
- [ ] audio_mix (BGM/효과음)
- [ ] TTS 타임스탬프 → 자막 자동싱크
- [ ] 템플릿 시스템

### Phase 3 — Tauri 데스크톱 UI
- [ ] React UI (스크린샷보다 예쁘게)
- [ ] Python 사이드카 IPC
- [ ] 진행률/큐/폴더 기능
- [ ] 자막 편집기 (구간별 폰트/효과/미리보기)

### Phase 4 — 마감 + 배포
- [ ] 제휴링크 관리, 업로드 캡션 자동생성
- [ ] PyInstaller로 Python 코어 → 단일 .exe (사이드카)
- [ ] ffmpeg.exe + 폰트/BGM/SFX 에셋 번들
- [ ] Tauri 빌드 → Windows 인스톨러 (.msi / NSIS .exe)
- [ ] (추후) macOS .dmg

## 7. 배포 전략 (중요)

목표: 사용자가 Python/ffmpeg 몰라도 **더블클릭 설치 후 바로 실행**.

```
Tauri 앱 (.msi/.exe 인스톨러)
├── 프론트(React) — Tauri 셸 내장
├── core.exe — Python 코어를 PyInstaller로 단일 실행파일화 (sidecar)
│   └── edge-tts/yt-dlp/opencv 등 전부 내장
├── ffmpeg.exe / ffprobe.exe — 번들 (PATH 의존 제거)
└── assets/ — 폰트6종, BGM, SFX 번들
```

- **사이드카(sidecar)**: Tauri가 `core.exe`를 외부프로세스로 실행, JSON(stdin/stdout)으로 통신.
- **edge-tts는 온라인 필요**(MS 서버 호출) — 인터넷 연결 전제. 완전 오프라인 원하면 Piper(로컬TTS) 폴백 옵션.
- 빌드 명령: `npm run tauri build` → `desktop/src-tauri/target/release/bundle/`에 인스톨러 생성.
- 코드서명 없으면 Windows SmartScreen 경고 뜸(무료배포는 감수, 유료배포시 인증서 구매).

---

## 6. 결정사항 로그
- TTS: **edge-tts** (무료, 검증됨)
- 셸: **Tauri** (가벼움, 로컬파일 접근, 예쁜 React UI)
- 자막: **ASS 포맷** (구간별 스타일/그라데이션/테두리/쉐도우/템플릿)
- 자막제거: 작은글씨 블러 / 큰글씨 자막바 덮기
- 코어: Python (영상처리 라이브러리 풍부)
