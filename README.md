# 쇼핑쇼츠 메이커

도우인(중국 틱톡) 상품영상 링크 → 자동으로 **한국어 쇼핑 쇼츠**로 변환.
웹앱 + 데스크톱앱, 구독형 유료 SaaS가 목표.

> 👀 **처음 보는 사람(동생)은 [ARCHITECTURE.md](ARCHITECTURE.md) 부터 읽으세요.** 전체 그림이 거기 있음.
>
> ⚠️ 저작권: 남의 영상 재가공해도 원저작권 살아있음. 사용 책임은 사용자 본인. → [PLAN.md](PLAN.md)

## 모노레포 구조

```
packages/
├── core/      ← 영상처리 엔진 (Python). 심장. 로컬·서버 공용.   [일부 동작]
├── server/    ← SaaS 백엔드 (FastAPI). 인증·결제·작업큐.        [구조만]
├── web/       ← 웹앱 (Next.js).                                [구조만]
└── desktop/   ← 데스크톱앱 (Tauri).                            [구조만]
shared/        ← 공통 스키마/타입
```

각 패키지 폴더에 README 있음. 역할은 거기 참고.

## 지금 동작하는 것 (core 엔진)

요구사항: Python 3.12, ffmpeg(PATH).

```powershell
cd packages\core
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt

# 무료 TTS 동작 확인 (제일 쉬운 검증)
.venv\Scripts\python.exe -m app.pipeline.tts

# 전체 파이프라인 (구현된 단계 실행, Phase2는 [SKIP] 로그)
.venv\Scripts\python.exe -m app.pipeline.run "<도우인URL>" --script "한국어 대본" --voice 소담 --cta profile
```

VSCode 인터프리터: `Ctrl+Shift+P` → "Python: Select Interpreter" → `packages\core\.venv`.

## 파이프라인 9단계 진행상황

| # | 단계 | 파일 | 상태 |
|---|------|------|------|
| 1 | 다운로드+분석 | `pipeline/download.py` | ✅ |
| 2 | 사운드 제거 | `pipeline/audio_strip.py` | ✅ |
| 3 | 중국어 자막 제거 | `pipeline/subtitle_remove.py` | ✅ 하단고정 / ⬜ OCR |
| 4 | 얼굴샷 컷 제거 | `pipeline/face_cut.py` | ⬜ Phase 2 |
| 5 | 한국어 TTS 더빙 | `pipeline/tts.py` | ✅ (성우/배속/타임스탬프) |
| 6 | 자동 자막(ASS) | `pipeline/caption.py` | ⬜ Phase 2 |
| 7 | BGM/효과음 | `pipeline/audio_mix.py` | ⬜ Phase 2 |
| 8 | CTA 멘트 | `pipeline/compose.py` | △ 일부 |
| 9 | 9:16 합성 | `pipeline/compose.py` | ✅ |

## 로드맵
- [x] Phase 0 셋업, 무료 TTS 검증
- [~] Phase 1 코어 파이프라인 CLI (자막제거/얼굴컷/ASS자막 마저)
- [ ] Phase 2 고급처리 (face_cut, caption, audio_mix, 템플릿)
- [ ] Phase 3 Tauri 데스크톱 + Next.js 웹 UI
- [ ] Phase 4 SaaS(인증/구독결제) + 배포(인스톨러)

전체 로드맵: [PLAN.md](PLAN.md) · 시스템 구조: [ARCHITECTURE.md](ARCHITECTURE.md)
