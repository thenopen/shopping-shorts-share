# AI 쇼핑 쇼츠 메이커 — 기획서

> 도우인/틱톡 인기 상품영상을 재가공해 한국어 쇼츠로 자동 변환하는 도구.
> 강의에서 파는 "AI 쇼핑메이커" 클론. 무료 스택으로 자체 구현.

---

## 0. 리스크 고지 (읽고 시작)

- 남의 영상 재가공해도 **원저작권은 살아있음**. "재가공하면 저작권 문제 없음"은 마케팅 멘트, 사실 아님.
- 도우인 영상 무단 다운로드 = 플랫폼 약관 위반.
- 이 도구는 기술적으로 동작하게 만듦. **사용에 따른 법적 책임은 전적으로 사용자 본인.**
- 안전하게 쓰려면: 본인 촬영영상 / 제휴사 제공 공식소재 / 라이선스 확보분만 입력.

---

## 1. 핵심 파이프라인

```
[영상 URL 입력]  (도우인/틱톡/유튜브 등)
   │
   ▼
[1] 다운로드            yt-dlp
   │
   ▼
[2] 자막/워터마크 제거   OCR로 자막영역 탐지 → ffmpeg delogo / inpaint
   │
   ▼
[3] (선택) 대본 생성     원본 음성 STT → 번역/요약 → 한국어 대본
   │
   ▼
[4] 한국어 TTS 더빙      edge-tts (무료, MS 뉴럴 보이스)
   │
   ▼
[5] 자막 + CTA 오버레이  ffmpeg drawtext / ASS 자막
   │
   ▼
[6] 합성/인코딩          ffmpeg (영상+더빙+자막 머지, 9:16 세로)
   │
   ▼
[완성 쇼츠 mp4]  +  [제휴링크 메타데이터]
```

---

## 2. 기술 스택 (전부 무료)

### 백엔드 — Python 3.12 + FastAPI
| 기능 | 라이브러리 | 비용 |
|------|-----------|------|
| 영상 다운로드 | yt-dlp | 무료 |
| 영상 처리/합성 | ffmpeg (CLI) + ffmpeg-python | 무료 |
| **한국어 TTS** | **edge-tts** | **무료, API키 없음** |
| 자막영역 OCR 탐지 | easyocr 또는 paddleocr | 무료 |
| 자막 inpaint 제거 | OpenCV / ffmpeg delogo | 무료 |
| STT (원음성→텍스트) | faster-whisper (로컬) | 무료 |
| 번역 (중→한) | argos-translate(로컬) 또는 deep-translator | 무료 |
| 작업 큐 | (1차) 동기 처리 → (확장) Celery/RQ | 무료 |
| DB | SQLite (로컬) → 확장시 Postgres | 무료 |

### 프론트엔드 — Next.js (React)
- 웹 우선. 작업 폼 + 진행상황 + 결과 다운로드 + 제휴링크 관리.
- 데스크톱: 추후 **Tauri**로 래핑 (Electron보다 가벼움).
- 모바일: **PWA**로 대응 (별도 앱스토어 배포 불필요).

### TTS 상세 (무료 핵심)
- **edge-tts**: Microsoft Edge 읽어주기 뉴럴 보이스를 공짜로 사용.
- API키 불필요, 한국어 보이스: `ko-KR-SunHiNeural`(여), `ko-KR-InJoonNeural`(남) 등.
- 속도/피치 조절 가능. 품질 높음.
- 폴백: gTTS(구글, 무료), Piper(완전로컬).

---

## 3. 폴더 구조

```
쇼핑쇼츠/                      ← 프로젝트 root (오토워커와 완전 분리)
├── PLAN.md                    ← 이 문서
├── README.md
├── .gitignore
├── backend/                   ← Python FastAPI
│   ├── app/
│   │   ├── main.py            ← FastAPI 엔트리
│   │   ├── config.py          ← 설정/경로
│   │   ├── pipeline/          ← 처리 단계별 모듈
│   │   │   ├── download.py    ← yt-dlp 래퍼
│   │   │   ├── subtitle_remove.py
│   │   │   ├── tts.py         ← edge-tts
│   │   │   ├── overlay.py     ← 자막/CTA
│   │   │   └── compose.py     ← ffmpeg 최종합성
│   │   ├── jobs.py            ← 작업 상태관리
│   │   └── models.py          ← DB 모델 (SQLite)
│   ├── requirements.txt
│   └── workdir/               ← 임시 영상파일 (gitignore)
├── frontend/                  ← Next.js
│   ├── app/
│   ├── package.json
│   └── ...
└── shared/
    └── affiliate/             ← 쿠팡파트너스/올리브영 링크 관리 설정
```

---

## 4. 단계별 개발 로드맵

### Phase 0 — 셋업 ✅ (지금)
- [ ] 폴더 구조 생성
- [ ] backend venv + requirements
- [ ] frontend Next.js 초기화
- [ ] .gitignore, README

### Phase 1 — 코어 파이프라인 (CLI로 먼저)
- [ ] download.py: URL → mp4
- [ ] tts.py: 텍스트 → 한국어 음성 (edge-tts)
- [ ] compose.py: 영상+더빙+자막 → 9:16 쇼츠
- [ ] CLI 한방 테스트: `python -m app.pipeline.run <url>`

### Phase 2 — 자막제거 + STT
- [ ] subtitle_remove.py: 하단 중국어자막 영역 제거
- [ ] STT→번역→대본 자동생성 (선택 기능)

### Phase 3 — 웹 UI
- [ ] FastAPI 엔드포인트 (작업생성/상태/결과)
- [ ] Next.js 폼 + 진행바 + 결과 다운로드
- [ ] TTS 보이스/폰트/CTA 설정 UI

### Phase 4 — 제휴링크 관리
- [ ] 상품별 쿠팡파트너스/올리브영 링크 저장/관리
- [ ] 영상-링크 매핑, 업로드 캡션 자동생성

### Phase 5 — 데스크톱/모바일
- [ ] Tauri 데스크톱 래핑
- [ ] PWA 설정

---

## 5. 1차 목표 (MVP 정의)

**입력**: 영상 URL 1개 + 한국어 대본(직접 입력 or 자동)
**출력**: 한국어 더빙 + 자막 + CTA 박힌 9:16 mp4 1개

이게 되면 나머진 살 붙이기.
