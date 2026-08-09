# 진행 상황 · 이슈 · 로드맵 (STATUS)

> **갱신일자:** 2026-08-09 · **갱신자:** psj066
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
코어 변환 엔진(core)   █████████░  ~85%   E2E 동작 / 자막제거=클라우드(Modal) 확정, BGM 미구현
웹 UI(web)            █████████░  ~90%   홈/편집 분리·자막 엔진·목표길이 UX 완성 / 인증·결제 없음
데스크톱 셸(desktop)   ░░░░░░░░░░    0%    미착수 (Tauri) — 다음 목표
SaaS 백엔드(server)   █░░░░░░░░░    ~5%   빈 스텁 (보류)
```

### 파이프라인 단계별 상태
| # | 단계 | 파일 | 상태 |
|---|------|------|:---:|
| 1 | 다운로드 | download.py / douyin_download.py | ✅ |
| 2 | 사운드 제거 | audio_strip.py | ✅ |
| 3 | 자막·워터마크 AI 제거 | subtitle_detect / propainter(Modal 클라우드 기본) / LaMa 폴백 | ✅ |
| 4 | 한국어 TTS + whisper 싱크 정렬 | tts.py / google_tts.py / align.py | ✅ |
| 5 | 자동 자막(ASS) — 스타일 엔진 | caption.py | ✅ |
| 6 | BGM/효과음 | audio_mix.py | ⬜ 미구현 |
| 7 | CTA 멘트 | compose.py | ✅ |
| 8 | 9:16 합성 (최종 길이=TTS) | compose.py | ✅ |

> 얼굴샷 컷 제거는 **폐기**(2026-07-03, da08468) — 내레이션 우선 정책과 충돌. `face_cut.py` 미사용 잔존.

---

## 3. 최근 완료

- **2026-08-09 (P3~P4) — 기능·UX·영속화 강화 (5개 과제)** (갱신자: psj066)
  - **A1 BGM/효과음 믹싱 구현**: `audio_mix.py` 스텁 → ffmpeg amix 체인(TTS 100% + BGM 루핑+페이드 + SFX adelay).
    `_render_worker`에 TTS 직후·compose 직전 삽입. `RenderReq`에 bgm/bgm_volume 필드 추가.
    `assets/bgm/`(매니페스트+README) 신설 — 음원은 CC0로 사용자 직접 번들. `GET /bgm` 엔드포인트.
    웹 RenderStage에 BGM 드롭다운(음원 available 표시). `tests/test_audio_mix.py`(8케이스).
  - **C1 작업 상태 SQLite 영속화**: `jobs_db.py` 신규(WAL, 스레드 안전 _LOCK, JSON data 컬럼).
    `PersistentJob`의 dict 인터페이스 유지하며 `_save`/`_load`/`_prune`/`_require`/`_new_job`을 DB 기반으로.
    기존 `workdir/jobs/*.json` 자동 마이그레이션. `tests/test_jobs_db.py`(9케이스, 동시 쓰기 검증 포함).
  - **A2 page.tsx 리팩터**: `CaptionStage`를 `memo()`로 래핑 + `genCaptions`/`editCaptions`/`undoCaptionEdit`/`onSelectCap`/`onToggleLock`를
    `useCallback`로 안정화(script/captionLines는 ref 읽기). 대본 타이핑 시 자막 리렌더 깨짐 해결. 죽은 `genderFilter` state 제거.
  - **B1 alert 31건 → Toast/Modal 교체**: `ui/Toast.tsx`(전역 스토어, toast.error/success/info/warn) + `ui/Modal.tsx`(confirmDialog/promptDialog, Promise 기반) 신규.
    globals.css `@keyframes toastIn` 추가. alert 24건→toast.error, 성공 2건→toast.success, confirm 6건→confirmDialog, prompt 1건→promptDialog.
  - **B2 라이트 모드 리맵 확장 + 터치타깃 44px**: globals.css 라이트 블록에 slate-600/700, pink/rose/emerald/amber/sky 상태 색, border-white 추가.
    Switch/ThemeToggle/TopBar/HomeView/VoiceStage play 버튼을 min-h-[44px]로 보정. ScriptStage 제거 × 버튼 확대.

- **2026-08-09 (P2~P3) — 완성도 강화 (스키마 자동화·CI·크로스플랫폼·골든 테스트)** (갱신자: psj066)
  - **스키마 자동 동기화(하이브리드)**: `app/_schema_gen.py` 신규 — Pydantic `model_json_schema()`로 뼈대 자동 생성 +
    enum/description/constraint는 수동 메타로 합치는 하이브리드. `scripts/gen-schema.py`가 실행 진입점.
    `tests/test_schema_sync.py`가 코드-스키마 정합성 검증(회귀 감지). 스키마 "거짓 계약" 문제 근본 해결.
  - **GitHub Actions CI(풀 의존성)**: `.github/workflows/ci.yml` 신규 — 3잡(core-test/web-test/schema-sync).
    torch CPU 버전 사전 설치, pip/npm 캐싱. push/PR 시 자동 검증.
  - **CTA 폰트 macOS 대응**: `DEFAULT_FONT`를 `C:/Windows/Fonts/malgun.ttf` 하드코딩 → 번들 `assets/fonts/Pretendard.ttf`로 통일.
    Windows/macOS/Linux 모두 같은 경로(플랫폼 분기 불필요). caption 기본 폰트와 시각적 통일.
  - **cross-platform 시작 스크립트**: `scripts/start-core.sh`, `start-web.sh`, `start-all.sh` 신규(bash).
    macOS/Linux에서 venv 경로 자동 감지(`.venv/bin` vs `.venv/Scripts`), trap으로 코어 정리.
  - **Tier 2 골든 테스트**: `render_ass_text()` 순수 함수로 분리(I/O 0) → `tests/test_caption_render_golden.py` +
    9개 `fixtures/golden_*.ass`. 과거 "0,," 아티팩트(Format 헤더 필드 수 불일치) 같은 ASS 구조 회귀를 잡는 안전망.
    caption.py coverage 33% → **49%**.
  - **문서**: README §3에 macOS/Linux 실행 안내 추가, CI 배지 추가.

- **2026-08-09 (후반) — 개선 결과물 심층 감사 + 회귀/모순 수정** (갱신자: psj066)
  - **🔴 웹 토큰 게이트 영구 차단 버그 수정**: 잘못된 토큰 입력 → 401 → clearToken 흐름에서
    `authed` state가 갱신 안 돼 오버레이가 다시 안 뜨던 회귀. `onUnauthorized` 전역 리스너 도입,
    게이트 probe(`/library` 1회 호출로 서버 인증 필요 여부 능동 감지) 추가 → 서버가 `ALLOW_NO_AUTH=1`일 때
    자동 해제 + 401 시 오버레이 재표시. probe 중 로딩 표시로 깜빡임 방지.
  - **🟠 Modal 옵트인 정책 모순 해소**: `/modal/accounts/add`가 `multi_account_enabled()` 체크 없이 동작하던 문제.
    이제 add 시 `allow_multi_account=true` 자동 세팅(추가 행위=옵트인 의사), `/deploy`는 멀티 off일 때 400(좀비 계정 방지).
    `set_allow_multi_account()` 헬퍼 추가.
  - **🟠 `/modal/accounts` 정합성**: `multi_enabled` 플래그 추가(이미 전반에 있었으나 이제 add/deploy와 연동).
  - **🟡 `apiDirect()` dead code 제거**: 호출처 0건인 대용량 직접 업로드 헬퍼 제거(주석로 맥락 보존).
  - **테스트 강화**: `tests/test_server_auth_integration.py` 신규 — TestClient 기반 인증 미들웨어 라우팅
    (401/200/`?token`/OPTIONS preflight/라우터 보호), Modal 모순 검증(add→옵트인/deploy 거부), traversal HTTP 레벨.
    **14개 케이스 추가 → 총 98개 green**.
  - **문서**: DEVELOPER.md §4-1 테스트 실행 방법(pytest/tsc 명령) 추가, web `package.json` `test`/`typecheck` 스크립트 추가.

- **2026-08-09 (전반) — 보안·스키마·테스트 기반 강화 (P0~P1)** (갱신자: psj066)
  - **부팅 토큰 인증**(core): `app/auth_token.py` 신규 — 서버 첫 기동 시 랜덤 토큰 생성·영속(`workdir/auth_token.txt`).
    미들웨어가 모든 API에 `Authorization: Bearer` 또는 `?token=` 요구 → 같은 와이파이 임의 접근 차단.
    웹은 첫 진입 시 토큰 입력 오버레이 + `localStorage` 저장. `ALLOW_NO_AUTH=1`로 우회(로컬 개발용).
  - **Path traversal 가드 통일**: `app/security.py` 신규 `safe_path()`. `/file`, `/overlays/asset`, `overlays.resolve_file`
    세 곳의 서로 다른 가드를 하나로. URL 인코딩/심볼릭 링크 탈출 일관 차단.
  - **`job.schema.json` 전면 갱신**: 사장된 voice enum(8개, 코드 불일치) → voices.py 23개 기반으로 재작성.
    engine/speaking_rate/emotion/caption_style/overlays 등 실제 `RenderReq` 반영. status enum에 waiting_gpu 등 추가.
  - **Modal 멀티계정 옵트인**: `effective_accounts()` 기본을 단일 계정으로 변경. 멀티 로테이션은
    `MODAL_MULTI_ACCOUNT=1` 또는 `settings.allow_multi_account=true`일 때만(ToS 멀티어카운팅 리스크 완화).
  - **Tier 1 단위 테스트 도입**(pytest): `packages/core/tests/` — caption/refine/url_extract/voices/security/auth_token/settings_modal.
    **84개 케이스 전부 green, 0.06초**(외부 의존 0). `requirements-dev.txt`, `pytest.ini`, `conftest.py` 포함.
    coverage: url_extract·voices 100%, security 90%, auth_token 87%.

- **2026-07-03 — 자막 엔진·홈/편집·대본 시스템 대개편** (갱신자: psj066)
  - **자막 스타일 엔진**: 쇼핑쇼츠 프리셋 10종 + 등장 효과(fade/pop/rise) + 워드바이워드 애니.
    ASS Format 헤더 버그 수정(모든 번인 영상에 "0,," 아티팩트 찍히던 문제 — 타임라인 편집기 도입 이후 상존).
    애니 자막 verbatim(whisper 발음 표기 노출 제거), 자막 싱크 whisper 정렬(align.py) 도입.
  - **홈/편집 화면 분리**: 프로젝트 목록(9:16 썸네일·이어하기·삭제) 홈 + 편집 워크스페이스. '영상 생성'은 렌더 단계에만.
  - **목표 길이 UX(duration-first)**: 목표 초 칩(20/30/45/영상길이) → 대본 분량 역산, 예상 길이 미터
    (성우별 CPS 실측 EMA 보정), 렌더 예상/실측 길이 표시. 자막 크기 상한 200px.
  - **대본 생성 시스템**: 역설계(타깃→통점→소구 선별) → CO-STAR 프롬프트(쇼핑쇼츠 전환형) →
    best-of-3 + 루브릭 채점. 훅 3후보 택1(/script/hooks), 카테고리 지침 분기, 레퍼런스 뱅크(script_bank.json),
    가공 채택/undo 로깅(workdir/metrics_refine.jsonl). 최초 생성은 상위 모델(gemini-2.5-flash 체인).
    근거 리서치: [script-prompt-good-cases.html](script-prompt-good-cases.html).
  - **렌더 정책**: 얼굴컷 폐기, 최종 영상 길이 = TTS(내레이션) 길이(-stream_loop + -shortest).
- **2026-06-18 — 자막제거 클라우드(Modal) 확정** — 로컬 8GB GPU에 안 묶고 ProPainter는 Modal에서. 품질+영상당 단가 측정.
- **2026-06-17 — 새 PC 환경 부트스트랩 완료** (갱신자: psj066)
  - Python 3.12.10, ffmpeg 8.1.1, venv, **torch 2.11.0+cu128 / RTX 3070 / CUDA 12.8**, 전체 의존성, Playwright chromium 설치.
  - requirements.txt에 누락 의존성(`playwright-stealth`, `simple-lama` 주석) 반영.
  - 코어 서버 기동 → `http://localhost:8000/` `{"ok":true}` 응답 검증.
  - 자세한 절차는 [docs/SETUP.md](SETUP.md)에 정리.

---

## 4. 다음 작업 (우선순위 순, 백엔드 우선)

> 출처: 전면 분석 후 합의된 TODO. 문서화 작업은 제외.

### 0~1단계 — 실행환경·검증 (완료)
- [x] Python/ffmpeg/venv/torch-GPU/의존성/chromium 설치, 코어 서버 기동 검증
- [x] 자격증명 배치 (Google TTS · Gemini · Modal)
- [x] 자막제거 E2E — 클라우드(Modal) ProPainter 기본으로 확정, 전체 파이프라인 실사용 중

### 2단계 — 남은 핵심
- [ ] **BGM/효과음 믹싱** + 무료음원 자산 확보 ([audio_mix.py](../packages/core/app/pipeline/audio_mix.py), `assets/bgm`·`sfx` 폴더 신설)
- [ ] **대본 품질 잔여** — 포맷 6종(언박싱/비포애프터/가격공개/…) 분기, 훅 A/B 성과 추적, script_bank 확충,
      화장품법 금지어 negative constraint ([good-cases 문서 §6](script-prompt-good-cases.html))
- [ ] 라이트 모드 폴리시 ([web/TODO.md](../packages/web/TODO.md))

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
| 🟡 | **박스 둥글기 미반영** — libass 미지원이라 웹 미리보기 전용. (글로우/소프트그림자는 블러 레이어로 반영됨 — 해결) | [caption.py](../packages/core/app/pipeline/caption.py) |
| 🟡 | **배속 누락** — edge-tts 폴백 경로에서 `speaking_rate` 무시됨(google 경로만 적용) | [tts.py](../packages/core/app/pipeline/tts.py) |
| 🟡 | **ProPainter 로컬 OOM** — 8GB에선 OOM → **클라우드(Modal)가 기본**, 로컬은 LaMa 폴백 | `$env:PROPAINTER="0"`로 강제 off 가능 |
| ℹ️ | **CLI(run.py) vs 서버(server_api.py) 분기** — 실사용 경로는 server_api. run.py는 참고용이며 일부 단계 `[SKIP]` | — |
| ✅ | ~~CORS `*` + 인증 없음~~ → 부팅 토큰 인증 미들웨어 도구(`auth_token.py`). CORS `*`는 preflight 허용 목적 유지, 실제 접근은 토큰으로 통제 (2026-08-09). Origin 화이트리스트는 별도 TODO | [server_api.py](../packages/core/app/server_api.py) |
| ✅ | ~~Path traversal 가드 분산~~ → `security.safe_path()` 로 3곳 통일 (2026-08-09) | [security.py](../packages/core/app/security.py) |
| ✅ | ~~작업 상태 비영속~~ → `PersistentJob`이 디스크 원자적 백업, 재시작 시 `_load_jobs` 복원 | [server_api.py](../packages/core/app/server_api.py) |
| ✅ | ~~자막 효과 미반영~~ → 글로우/그림자 ASS 레이어 반영 · ~~자막 싱크 균등분할~~ → whisper 정렬(align.py) · ~~"0,," 아티팩트~~ → Format 헤더 수정 (2026-07-03) | 해결 |

---

## 6. 헷갈리기 쉬운 점 (신임 개발자 함정)

1. **`server` 패키지는 비어 있다.** 실제 API는 `core/app/server_api.py`. `web`은 `core`에 직접 붙는다.
2. **TTS 기본은 Google Cloud TTS**(유료, 키 필요). edge-tts는 폴백(성우 2종). 과거 문서의 "edge-tts 무료" 설명은 낡음.
3. **도우인은 API 키가 아니라 로그인 쿠키.** `python -m app.douyin_auth`.
4. **Windows venv는 프로세스가 2개로 보이고 이미지가 글로벌 Python으로 표시**될 수 있으나 정상(패키지는 venv). [docs/SETUP.md 6장](SETUP.md) 참고.
5. **GPU는 RTX 3070 8GB** (과거 문서의 5070Ti 16GB 아님).
6. **부팅 토큰 인증(2026-08-09~)** — 서버 첫 기동 시 `workdir/auth_token.txt` 에 랜덤 토큰이 생기고,
   콘솔에 배너로 표시됨. 모든 API 요청에 `Authorization: Bearer <토큰>` 또는 `?token=<토큰>` 필요.
   토큰을 잊으면 파일 삭제 후 재기동. 로컬 단독 개발은 `ALLOW_NO_AUTH=1` 로 우회.
7. **Modal 멀티계정은 이제 옵트인(2026-08-09~)** — 기본은 단일 계정(`~/.modal.toml` 대표 프로필).
   멀티 로테이션은 `MODAL_MULTI_ACCOUNT=1` 또는 `settings.allow_multi_account=true` 일 때만.
   기존 풀 데이터는 보존(활성화만 off).
8. **`face_cut.py`는 활용 중**(run.py가 import, web 경로만 미사용) — "얼굴컷 폐기"는 web 경로 한정.

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
