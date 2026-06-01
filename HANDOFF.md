# 작업 인수인계서 (HANDOFF)

> 새 세션에서 이 파일을 먼저 읽으면 바로 이어서 작업 가능. 최종 업데이트: 2026-05-31

## 프로젝트
- **쇼핑쇼츠 메이커**: 도우인 상품영상 링크 → 한국어 쇼핑 쇼츠 자동변환 SaaS
- 위치: `c:/Users/user/Desktop/쇼핑쇼츠/`
- GitHub: `https://github.com/ShiningShuri/shopping-shorts-maker` (Private)
- 모노레포: `packages/{core,web,server,desktop}`
  - core = Python FastAPI (venv: `packages/core/.venv`, torch 2.11.0+cu128, GPU=RTX 5070Ti)
  - web = Next.js (포트 3000)
- 별도 프로젝트 "작업실"(autoworkers-script)도 같은 PC에서 돌아감 → 건드릴 때 주의(아래 참고)

## 서버 3개 (현재 떠있음)
| 서버 | 포트 | 실행법 | 비고 |
|---|---|---|---|
| 쇼핑쇼츠 코어 API | 8000 | `packages/core` 에서 `.venv\Scripts\python.exe app\_run_server.py` (= `scripts\start-core.ps1`) | GPU 인페인팅/OCR. **반드시 venv로 실행** |
| 쇼핑쇼츠 웹 | 3000 | `scripts\start-web.ps1` (next dev 0.0.0.0) | 앱 화면 |
| 작업실(autoworkers) | 8765 | `C:\Users\user\Downloads\2주차강의대본 스킬\autoworkers-script\web` 에서 `..\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8765` | 별도 프로젝트. **main.py가 web/ 폴더에 있음** |

원격 접속: Tailscale. 이 PC = `desktop-fu19gql` (`100.87.145.86`). 폰/아이패드/맥북에서 `http://desktop-fu19gql.tailbf2d8f.ts.net:3000` (쇼핑쇼츠) / `:8765/office` (작업실).

## ⚠️ 절대 주의 (이번 세션 사고)
- **프로세스 죽일 때 `*uvicorn*` 같은 넓은 패턴 금지.** 작업실(8765)까지 같이 죽음. 포트(`*8000*`)나 스크립트명(`*server_api*`, `*_run_server*`)으로 좁혀서만 종료.
- venv torch(2.11.0+cu128) **재설치/다운그레이드 금지**. lama 의존성이 바꾸려 하면 `--no-deps`.

## 완료된 것
- 자막제거 = AI 인페인팅(simple-lama)으로 전환 완료. `app/pipeline/subtitle_inpaint.py`. 8s 자막 깨끗 제거 확인됨(과거 검증).
- `subtitle_detect.detect_segments`: conf_min=0.0, bottom_ratio=0.4 (easyocr이 흰자막에 conf≈0 줘서 위치만으로 판정).
- 서버를 `_run_server.py`(uvicorn.Server.run 단일프로세스)로 기동 → 글로벌 python 폴백 방지.
- Tailscale 원격접속 셋업.
- 두 repo 커밋·푸시 완료.

## 진행 중 / 막힌 것 (다음 할 일)
1. **자막제거 40%에서 멈춤 버그** — 분석 시 "중국어 자막 제거 · 40%"에서 멈춤.
   - 원인: ffmpeg 재조립 단계에서 입력 경로(한글/공백 `쇼핑쇼츠`)가 깨져 `C:\Users\user\Desk`로 잘림.
   - **수정함(미검증)**: `subtitle_inpaint.py`의 ffmpeg 호출을 frame 폴더 안에서(`cwd=work`) 상대경로(`f_%06d.png`)로 실행하도록 변경 + fps 0이면 30 보정.
   - **다음 할 일: 실제로 검증.** `packages/core`에서:
     ```
     .venv\Scripts\python.exe -c "from app.pipeline.subtitle_detect import detect_segments as d; from app.pipeline.subtitle_inpaint import inpaint_subtitles as i; s=d('workdir/67801cdd/source.mp4',interval_sec=0.5,bottom_ratio=0.4); print(len(s)); i('workdir/67801cdd/source.mp4','workdir/67801cdd/nosub.mp4',s); print('OK')"
     ```
     성공하면 서버 재기동 후 웹에서 도우인 링크로 분석 → 40% 넘어가는지 확인.
2. **웹 UI 수정** — "한국어 대본" 글자 잘림(줄바꿈) 고치기 + 디자인 색감 살리기 (`packages/web/app/page.tsx`). 폰서 보면 색 다 빠져 보임.
3. **폰트 추가** — `fonts.ts`에 이름 15종만 있고 실제 폰트파일/@font-face 없음(`globals.css`에 폰트 로딩 0). `packages/web/public/fonts/`에 woff2 넣고 `@font-face` 정의 필요. 라이선스 OK: 온글잎(ownglyph.com), Pretendard, Gmarket, 배민(BM)계열, 눈누.

## 미커밋 변경분 (현재 working tree)
- M `packages/core/app/pipeline/subtitle_inpaint.py` (ffmpeg 경로 수정)
- M `packages/web/app/page.tsx`
- M `scripts/start-core.ps1`
- ?? `packages/core/app/_run_server.py` (신규 서버 런처)
- ?? `TASK_FOR_CODEX.md`, `packages/web/public/fonts/`
