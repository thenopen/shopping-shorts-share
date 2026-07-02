# web TODO (미뤄둔 개선)

## 라이트 모드 폴리시
- [ ] **라이트 모드에서 일부 버튼 가독성 저하** — 다크 전제로 하드코딩된 유틸(`text-slate-*`, `bg-white/*`, `text-[var(--text-strong)]` 등)이 라이트에서 대비 부족.
  - 의심 대상: 상단 스테이지 칩 비활성, `.btn-ghost` 텍스트, pink-tint 토글(`bg-pink-500/15 text-pink-400`)의 라이트 대비, 프리셋/템플릿 카드 보조텍스트, `text-slate-500/600`.
  - 조치: globals.css 라이트 오버라이드 블록(html[data-theme="light"]) 확장 or 컴포넌트를 시맨틱 토큰(`--text`/`--text-mut`/`--brand`)으로 이관. 라이트에서 스크린샷 훑고 대비 4.5:1 미달 버튼 리스트업 후 일괄.

## 감사(5-렌즈) 잔여 P0/P1 (개선 트랙)
- [ ] `alert()`/`window.prompt` 25+개 → 인라인 토스트/모달 (productErr 패턴 재사용)
- [ ] 전역 focus-visible는 됨. placeholder solid 토큰(≥4.5:1)은 다크에선 OK, 라이트 재확인
- [ ] 터치타깃 44px(모바일) — CTA +/×·보이스play·Switch hit-area
- [ ] 실버그 2개: analyze checkUrl(target), CaptionTimeline/CaptionStage stable-id(현 CaptionStage는 key={i} 유지 중)

## 리팩터 잔여(동작보존)
- [ ] CaptionStage `React.memo`(genCaptions script를 ref로)
- [ ] Home useReducer(job/render·caption) — 선택
