# web TODO (미뤄둔 개선)

## 라이트 모드 폴리시
- [x] **라이트 모드 대비 개선(1차)** — globals.css 라이트 오버라이드 블록에 slate-600/700, pink/rose/emerald/amber/sky 상태 색, border-white 리맵 추가(2026-08-09). 상위 집중 파일의 Tailwind 하드코딩을 시맨틱 토큰(`var(--text-mut)` 등)으로 본격 이관은 다음 라운드(400+건 수작업).
- [ ] **터치타깃 44px 잔여** — Switch/ThemeToggle/TopBar/HomeView/VoiceStage play/ScriptStage 제거× 는 보정 완료(2026-08-09). p-1 제거버튼(RenderStage/CaptionStage/PreviewPane)은 다음.

## 감사(5-렌즈) 잔여 P0/P1 (개선 트랙)
- [x] ~~`alert()`/`window.prompt` 25+개 → 인라인 토스트/모달~~ **완료(2026-08-09)**: `ui/Toast.tsx` + `ui/Modal.tsx` 신규, alert 24→toast.error, 성공 2→toast.success, confirm 6→confirmDialog, prompt 1→promptDialog.
- [x] ~~실버그 2개~~ **완료(2026-07-03)**: analyze `checkUrl(target)` 수정 · CaptionTimeline은 미사용 죽은 파일이라 삭제 ·
      CaptionStage의 동종 버그(줄 삭제 시 selectedCap 인덱스 시프트)는 delLine 보정으로 해결. key={i}는 유지(현 위험 낮음).

## 리팩터 잔여(동작보존)
- [x] ~~CaptionStage `React.memo`~~ **완료(2026-08-09)**: genCaptions/editCaptions/undoCaptionEdit/onSelectCap/onToggleLock useCallback 안정화 + script/captionLines ref 읽기 + memo 래핑.
- [ ] `useProject` 훅 분리(gatherState/loadProject/doSave 이관) — 다음 라운드. CaptionStage memo가 먼저(완료).
- [ ] Home useReducer(job/render·caption) — 선택
