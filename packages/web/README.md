# web — 웹앱 (Next.js)

브라우저에서 쓰는 쇼핑쇼츠 메이커. 영상처리는 `packages/server`를 호출(서버처리).

## 역할
- 링크 입력 → 설정(성우/폰트/CTA/템플릿) → 작업요청
- 진행률 표시, 결과 다운로드
- 로그인 / 구독 관리 화면
- 자막 편집기 (구간별 폰트/사이즈/그라데이션/테두리/쉐도우 — 미리보기)

## 디자인
스크린샷의 강의 도구보다 **훨씬 예쁘게**. 모던 UI.
(컴포넌트: shadcn/ui 또는 Tailwind 기반 예정)

## 구조 (예정)
```
web/
├── app/             ← Next.js App Router
│   ├── page.tsx         ← 메인 (링크입력+작업)
│   ├── editor/          ← 자막 편집기
│   ├── billing/         ← 구독
│   └── login/
├── components/
└── package.json
```

## 데스크톱과 공유
UI 컴포넌트를 `packages/desktop`(Tauri)와 최대한 공유.
→ 같은 React 코드로 웹 + 데스크톱.

## 상태: 미착수 (Phase 3). 지금은 구조만.
