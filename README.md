# AI 쇼핑 쇼츠 메이커

영상 URL → 한국어 더빙 + 자막/CTA → 9:16 세로 쇼츠 자동 생성.
무료 스택 (edge-tts, yt-dlp, ffmpeg). API키 불필요.

> ⚠️ 저작권 고지: 남의 영상 재가공 시 원저작권 살아있음. 사용 책임은 본인. 자세히는 [PLAN.md](PLAN.md) 참고.

## 요구사항
- Python 3.12
- Node 24+ (프론트, 추후)
- ffmpeg (PATH 등록) ✓ 설치됨

## 셋업 (backend)
```powershell
cd backend
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

VSCode 인터프리터: `Ctrl+Shift+P` → "Python: Select Interpreter" → `backend\.venv` 선택.

## 사용 (CLI MVP)
```powershell
cd backend
# 대본 직접 입력
.venv\Scripts\python.exe -m app.pipeline.run "<영상URL>" --script "안녕하세요. 이 제품 정말 좋아요." --cta "지금 구매하기"

# 대본 파일
.venv\Scripts\python.exe -m app.pipeline.run "<영상URL>" --script-file script.txt

# 대본 없이 (원본 음성 유지, 9:16 변환만)
.venv\Scripts\python.exe -m app.pipeline.run "<영상URL>"
```
결과: `backend/workdir/<job_id>/output.mp4`

## TTS 보이스 목록
```powershell
.venv\Scripts\python.exe -c "import asyncio; from app.pipeline.tts import list_korean_voices; print([v['ShortName'] for v in asyncio.run(list_korean_voices())])"
```

## 현재 상태
- [x] Phase 0 셋업
- [x] 다운로드 / TTS / 합성 코어
- [ ] Phase 2 자막제거 + STT
- [ ] Phase 3 웹 UI (FastAPI + Next.js)
- [ ] Phase 4 제휴링크 관리
- [ ] Phase 5 데스크톱(Tauri)/모바일(PWA)

로드맵 전체: [PLAN.md](PLAN.md)
