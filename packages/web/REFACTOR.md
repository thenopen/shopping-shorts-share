# web 리팩터 진행 상황 (2026-07-02)

5-렌즈 UX/UI+리팩터 감사(57 findings, 16 검증, 2 실버그) 후 **동작보존 리팩터** 시작.
원칙: step 1–8 = 순수 동작보존(각 커밋 tsc green + 스크린샷 동일). step 9 = 동작변경(기능/버그/토큰/a11y) → 별도, TODO 주석으로 표시.

## ✅ 완료 (검증됨 — tsc exit 0, 스크린샷 픽셀 동일)

- **step 1 — 폰트 벽 생성화**: `scripts/gen-font-css.mjs`가 `public/fonts/*.woff2`(539개)→`app/fonts.generated.css` 생성. `globals.css`는 `@import "./fonts.generated.css"`만. predev/prebuild에 연결. globals.css 642→103줄. (family==파일명 539개 전수 확인)
- **step 2 — 의존성 없는 모듈 추출**: `lib/api.ts`(apiBase/postJSON/errMsg) · `lib/types.ts`(8 타입) · `lib/format.ts`(fmtK/fmtSec/parsePoints/normLines) · `caption/style.tsx`(CaptionStyle/DEFAULT_STYLE/styleToCss/emphasizeNodes/EMPH_*) · `caption/types.ts`(CaptionLineData) · `data/voices.ts`(VOICES). `fonts.ts`→`data/fonts.ts`. CaptionTimeline은 `CaptionLineData` 재노출로 기존 import 경로 호환.
- **step 4 — 자기완결 컴포넌트 추출** → `app/components/`: HelpDot · StageBadges · QuotaBadge · SettingsPanel · PipelineProgress(+PIPE_STEPS/STATUS_STEP/STEP_NOMINAL). 각자 state/effect/props 그대로 이동(disabled exhaustive-deps 포함 — 동작 동일).
- **step 8a**: 죽은 `subtitleBackend` useState(setter 없음, 항상 "modal") → 모듈 상수.

**결과: page.tsx 1763→1162줄, globals.css 642→103줄.**

## ⏳ 남은 리팩터 (동작보존)

- **step 3 — UI 프리미티브 dedup** → `components/ui/`: `Toggle`(CaptionEditor·CaptionTimeline 2곳 중복, padding만 다름 px-2.5 vs px-3 → `dense` prop로 두 룩 재현), `Row`(CaptionEditor)+`Field`(page.tsx) 통합(`LabeledPanel`), `ColorInput`, `Spinner`/`Switch`(ui.tsx). ⚠ 클래스 픽셀 동일 보존 + 스크린샷 diff 필수.
- **step 5 — 훅 추출** → `app/hooks/`: `useJobPolling`(1200ms/5-fail cutoff·1회 log ref·scriptDirtyRef 게이팅·unmount cleanup), `useScriptHistory`(undo/redo slice(-50)), `useCtas`, `useQuota`, `useProductScript`, `useModalDeploy`. ⚠ closure/ref 의미가 load-bearing — 하나씩 tsc+스모크.
- **step 6 — memo**: `React.memo(CaptionEditor/QuotaBadge/VoicePicker)`. ⚠ `genCaptions`가 `script`를 **ref로** 읽어야 대본 타이핑 중에도 CaptionTimeline memo 유지(useCallback만으론 안 됨 — 검증됨).
- **step 7 — page.tsx → ~150줄 Home 셸** + 결합 플래그 `useReducer`(job/render 머신, caption 스토어). VoicePicker 컴포넌트 분리(voice/playing/loadingVoice/genderFilter/audioRef 훅으로).

## 🚩 개선 트랙(step 9, 동작변경 — 나중에). 감사 상세는 워크플로 산출물 참고.

인라인 TODO 앵커 남김:
- **[실버그] `page.tsx` analyze() 완료 콜백** `checkUrl(url)` → `checkUrl(target)` ('자막제거 다시' 시 엉뚱한 영상으로 미리보기 갱신).
- **[실버그] `CaptionTimeline.tsx` delLine/editingIdx** 위치 기반 → 줄마다 stable id.

주요 개선(감사 P0/P1): 전역 `:focus-visible` 1줄, placeholder solid 토큰(≥4.5:1), `alert()`25개+`prompt`→인라인 토스트/모달, 터치타깃 44px(개별 hit-area), 3층 디자인 토큰(status는 **새 primitive** 필요 — 파스텔 alias 금지), elevation 위계(.glass 1개만), 전역 `1.06em/bold` 규칙 제거+타입스케일(⚠ Paperlogy3 강조폰트 재적용 필요=디자인 변경), primary CTA 뷰당 1개, IA 스테이지 레일+출력 pane, 작업시작 버튼 위치 이동, `prefers-reduced-motion`, emoji→라인아이콘, 539-option select 폭탄, public/fonts.css CDN 중복 제거(⚠ face-swap 위험).
