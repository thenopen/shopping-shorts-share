# 진행 상황 · 이슈 · 로드맵 (STATUS)

> **갱신일자:** 2026-06-17 · **갱신자:** psj066
>
> 이 문서는 **자주 바뀌는 living 문서**입니다. 작업을 끝내거나 시작할 때마다 갱신하세요.
> 전체 그림은 [README.md](../README.md), 환경 세팅은 [docs/SETUP.md](SETUP.md).

---

## 1. 전략 결정 (현재 기준)

- **제품 형태 = 데스크톱 우선.** 도우인 다운로드를 사용자 PC에서 처리해 차단·법적 노출·서버비를 피한다.
- **`server`(SaaS 백엔드)·Tailscale·공개 웹배포는 보류.** 공개 웹 서비스로 확장할 때 다룬다.
- **지금 집중:** `core`(엔진) + `web`(UI, 데스크톱이 재사용) → 이후 `desktop`(Tauri 셸).

---

## 2. 완성도 스냅샷

```
코어 변환 엔진(core)   ████████░░  ~75%   메인 흐름 동작 / 얼굴컷·BGM 미구현, ProPainter 불안정
웹 UI(web)            ████████░░  ~80%   제작·자막편집 완성 / 인증·결제·큐 UI 없음
데스크톱 셸(desktop)   ░░░░░░░░░░    0%    미착수 (Tauri) — 다음 목표
SaaS 백엔드(server)   █░░░░░░░░░    ~5%   빈 스텁 (보류)
```

### 파이프라인 단계별 상태
| # | 단계 | 파일 | 상태 |
|---|------|------|:---:|
| 1 | 다운로드 | download.py / douyin_download.py | ✅ |
| 2 | 사운드 제거 | audio_strip.py | ✅ |
| 3 | 자막·워터마크 AI 제거 | subtitle_detect / inpaint / propainter | ✅ (ProPainter는 8GB서 불안정→LaMa 폴백) |
| 4 | 얼굴샷 컷 제거 | face_cut.py | ⬜ 미구현 |
| 5 | 한국어 TTS | tts.py / google_tts.py | ✅ |
| 6 | 자동 자막(ASS) | caption.py | ✅ |
| 7 | BGM/효과음 | audio_mix.py | ⬜ 미구현 |
| 8 | CTA 멘트 | compose.py | ✅ |
| 9 | 9:16 합성 | compose.py | ✅ |

---

## 3. 최근 완료

- **2026-06-17 — 새 PC 환경 부트스트랩 완료** (갱신자: psj066)
  - Python 3.12.10, ffmpeg 8.1.1, venv, **torch 2.11.0+cu128 / RTX 3070 / CUDA 12.8**, 전체 의존성, Playwright chromium 설치.
  - requirements.txt에 누락 의존성(`playwright-stealth`, `simple-lama` 주석) 반영.
  - 코어 서버 기동 → `http://localhost:8000/` `{"ok":true}` 응답 검증.
  - 자세한 절차는 [docs/SETUP.md](SETUP.md)에 정리.

---

## 4. 다음 작업 (우선순위 순, 백엔드 우선)

> 출처: 전면 분석 후 합의된 TODO. 문서화 작업은 제외.

### 0단계 — 실행환경 (거의 완료)
- [x] Python/ffmpeg/venv/torch-GPU/의존성/chromium 설치
- [x] 코어 서버 기동 검증
- [ ] **자격증명 배치** — Google TTS · Gemini 키 (`auth/`) · **[미정 → 서면문의 #2·#3](OPEN_INQUIRIES.md)**

### 1단계 — 백엔드 안정화/검증
- [ ] **자막제거 E2E 검증** — 실제 링크로 분석→자막제거 미리보기 완주 (GPU 라이브러리 in-process 동작 최종 확인)
- [ ] ProPainter 안정화 — OOM/폴백 동작 점검 ([propainter_inpaint.py](../packages/core/app/pipeline/propainter_inpaint.py))
- [ ] 전체 파이프라인 스모크 테스트 (분석→대본→TTS→자막→합성 1회 완주)

### 2단계 — 백엔드 미구현 핵심
- [ ] **얼굴샷 컷 제거** — mediapipe ([face_cut.py](../packages/core/app/pipeline/face_cut.py))
- [ ] **BGM/효과음 믹싱** + 무료음원 자산 확보 ([audio_mix.py](../packages/core/app/pipeline/audio_mix.py), `assets/bgm`·`sfx` 폴더 신설)
- [ ] FE↔BE 자막효과 정합 (아래 이슈 참고)
- [ ] 자막 싱크 개선 (Google TTS 타임스탬프/정렬)

### 3단계 — 데스크톱 셸 (Tauri)
- [ ] Tauri 골격 + `core`를 `core.exe` 사이드카(PyInstaller)
- [ ] `web` UI를 WebView로 재사용, `127.0.0.1:8000` 연결
- [ ] Playwright chromium 번들 전략 결정 (번들 vs 최초실행 다운로드)
- [ ] "결과 폴더" 등 로컬 파일 기능, Windows 인스톨러

### 보류 (공개 웹 SaaS 갈 때)
- [ ] `server`: 인증·결제·사용량제한·작업큐 · 작업상태 DB 영속화 · CORS 제한

---

## 5. 알려진 이슈 / 기술 부채

| 심각도 | 이슈 | 위치 / 메모 |
|:---:|------|------------|
| 🟡 | **자막 효과 미반영** — 편집기의 글로우/그림자색·흐림/박스 둥글기는 웹 미리보기 전용, 최종 영상(ASS libass)엔 안 들어감 | [caption.py](../packages/core/app/pipeline/caption.py) `style_from_dict` |
| 🟡 | **자막 싱크 저하** — Google TTS는 단어 타임스탬프 `[]` 반환 → 자막이 글자수 균등분할로 폴백 | [tts.py](../packages/core/app/pipeline/tts.py) |
| 🟡 | **배속 누락** — edge-tts 폴백 경로에서 `speaking_rate` 무시됨(google 경로만 적용) | [tts.py](../packages/core/app/pipeline/tts.py) |
| 🟡 | **ProPainter OOM** — RTX 3070 8GB에선 1080×1920 OOM 위험 → LaMa 자동 폴백 | `$env:PROPAINTER="0"`로 강제 off 가능 |
| ⚠️ | **작업 상태 비영속** — 인메모리 `JOBS` dict, 서버 재시작 시 소실 | [server_api.py](../packages/core/app/server_api.py) (DB 미구현) |
| ⚠️ | **CORS `*`** — 개발용. 공개 노출 전 제한 필요 | [server_api.py](../packages/core/app/server_api.py) |
| ℹ️ | **CLI(run.py) vs 서버(server_api.py) 분기** — 실사용 경로는 server_api. run.py는 참고용이며 일부 단계 `[SKIP]` | — |

---

## 6. 헷갈리기 쉬운 점 (신임 개발자 함정)

1. **`server` 패키지는 비어 있다.** 실제 API는 `core/app/server_api.py`. `web`은 `core`에 직접 붙는다.
2. **TTS 기본은 Google Cloud TTS**(유료, 키 필요). edge-tts는 폴백(성우 2종). 과거 문서의 "edge-tts 무료" 설명은 낡음.
3. **도우인은 API 키가 아니라 로그인 쿠키.** `python -m app.douyin_auth`.
4. **Windows venv는 프로세스가 2개로 보이고 이미지가 글로벌 Python으로 표시**될 수 있으나 정상(패키지는 venv). [docs/SETUP.md 6장](SETUP.md) 참고.
5. **GPU는 RTX 3070 8GB** (과거 문서의 5070Ti 16GB 아님).

---

## 7. 구버전 문서 정리 (완료)

> **결정:** 삭제가 아니라 **아카이브** ([서면 문의 #5](OPEN_INQUIRIES.md) — 2026-06-17, psj066).

아래 문서들은 내용이 낡아 **이 문서 세트(README + SETUP + STATUS)로 대체**되었고, `docs/archive/`로 이동했습니다(`git`에 rename(R)으로 이력 보존).

| 구문서 | 대체 문서 | 현재 위치 |
|--------|----------|----------|
| `ARCHITECTURE.md` | README §2 | `docs/archive/` ✅ |
| `PLAN.md` | STATUS §4 | `docs/archive/` ✅ |
| `HANDOFF.md` | STATUS | `docs/archive/` ✅ |
| `TASK_FOR_CODEX.md` · `TASK_자막제거AI.md` | 완료/무효 | `docs/archive/` ✅ |
| `docs/references/올리브영_큐레이터.md` | 고유 자료 | **유지**(이동 안 함) |
| `.codex/claude-handoff.md` | 도구 핸드오프 메모 | 무관 — 유지 |

> 아카이브 안내: [docs/archive/README.md](archive/README.md)
