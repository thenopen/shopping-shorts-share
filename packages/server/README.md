# server — SaaS 백엔드 (Python / FastAPI)

웹앱이 쓰는 서버. 영상처리는 `packages/core` 엔진을 호출한다.

## 역할
- 인증 (로그인/회원가입)
- 구독 결제 (토스페이먼츠 / 카카오페이 / Stripe — Phase 4)
- 플랜별 사용량 제한 (무료/베타/유료)
- 작업 큐 (영상변환 요청 → core 실행 → 결과 저장)
- 작업 상태/진행률 API

## 구조 (예정)
```
server/
├── app/
│   ├── main.py        ← FastAPI 엔트리
│   ├── auth.py        ← 인증/JWT
│   ├── billing.py     ← 구독결제 (토스/카카오/Stripe)
│   ├── jobs.py        ← 작업큐 → core 호출
│   ├── quota.py       ← 플랜별 사용량 제한
│   └── models.py      ← User/Subscription/Job (SQLite→Postgres)
└── requirements.txt
```

## 핵심: core 재사용
서버는 영상처리를 직접 구현하지 않는다.
`packages/core`의 `run()`을 호출(또는 core.exe 사이드카 실행)할 뿐.
→ 데스크톱(로컬처리)과 웹(서버처리)이 **같은 엔진** 공유.

## 상태: 미착수 (Phase 3~4). 지금은 구조만.
