# 작업지시서 (Claude Code → Codex): 인페인팅 자막제거 서버 검증 + 폰트 추가

## 배경
프로젝트: `c:/Users/user/Desktop/쇼핑쇼츠/`, 코어 venv: `packages/core/.venv` (torch 2.11.0+cu128, GPU=RTX 5070Ti, lama/easyocr 설치됨).
웹서 "분석" 클릭 시 ffmpeg 에러로 자막제거 실패했었음:
`Command [..ffmpeg.. f_%06d.png ..] returned non-zero exit status 4294967294` (= 프레임 0개 → ffmpeg 입력 없음).

## 진단 결과 (Claude Code 확인 완료 — 추측 아님)
1. **근본원인**: 코어서버를 `-m uvicorn app.server_api:app`(CLI)로 띄우면 워커가 venv가 아닌 **글로벌 Python312**로 스폰됨(venv의 `_base_executable`이 글로벌이라). 글로벌엔 `simple_lama_inpainting`/`easyocr` 없음 → `_analyze_worker`(LISTEN 프로세스 내 threading.Thread)서 인페인팅 실패 → 프레임 0개.
2. **검증된 사실**:
   - `uvicorn.Server(cfg).run()` 직접 호출 = 자식 0개(단일 프로세스). 글로벌 폴백 안 일어남.
   - `sys._base_executable = sys.executable` 패치 시 `multiprocessing.spawn.get_executable()`이 venv 반환(추가 안전장치).
   - venv python으로 `from app.server_api import app` import만으론 자식 0개(import 부작용 아님).
3. **이미 적용한 수정(Claude Code)**:
   - `packages/core/app/_run_server.py` 신규: sys.path 추가 + `uvicorn.Server(Config(app,...)).run()` 단일프로세스 기동.
   - `scripts/start-core.ps1`: `& "$venv\python.exe" "app\_run_server.py"` 로 변경(CLI 방식 폐기), venv를 PATH 최상단.
   - `scripts/start-web.ps1`, `scripts/start-all.ps1`(0.0.0.0 바인딩, Tailscale 원격용).
   - `app/pipeline/subtitle_inpaint.py`: ffmpeg `capture_output` → 에러시 stderr 노출 + 프레임 0개 가드(RuntimeError).

## 해야 할 일

### 1단계: 깨끗한 서버 재기동 (venv 단일프로세스 확인)
```powershell
Get-CimInstance Win32_Process -Filter "name='python.exe'" | Where-Object { $_.CommandLine -like '*server_api*' -or $_.CommandLine -like '*uvicorn*8000*' -or $_.CommandLine -like '*_run_server*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
cd c:\Users\user\Desktop\쇼핑쇼츠
.\scripts\start-core.ps1
```
확인: `netstat -ano | findstr :8000` 의 LISTEN PID가 **venv python**인지 (`wmic process where processid=PID get executablepath` → `.venv\Scripts\python.exe`). 글로벌(Python312)이면 실패 → `_run_server.py` 맨 위에 `import sys; sys._base_executable = sys.executable` 추가 후 재시도.

### 2단계: E2E 인페인팅 검증
```powershell
cd c:\Users\user\Desktop\쇼핑쇼츠\packages\core
$env:PYTHONIOENCODING="utf-8"; $env:PYTHONUTF8="1"
.venv\Scripts\python.exe -c "from app.pipeline.subtitle_detect import detect_segments; from app.pipeline.subtitle_inpaint import inpaint_subtitles; s=detect_segments('workdir/67801cdd/source.mp4', interval_sec=0.5, bottom_ratio=0.4); print(len(s),'seg'); inpaint_subtitles('workdir/67801cdd/source.mp4','workdir/67801cdd/verify.mp4',s); print('OK')"
ffmpeg -y -ss 8 -i workdir\67801cdd\verify.mp4 -frames:v 1 workdir\67801cdd\verify8.png
```
그담 웹(`localhost:3000`)서 실제 도우인 링크로 분석 → 미리보기에 자막제거 영상 뜨는지 + 8000 서버 로그창 에러 없나 확인.

### 3단계: 폰트 추가 (로컬 woff2)
- `packages/web/app/fonts.ts`엔 15종 이름만 있고 실제 폰트파일/@font-face 없음(`globals.css`에 폰트 로딩 0). 그래서 미리보기서 폰트 차이 안 남.
- 라이선스 OK: **온글잎(ownglyph.com)** — UI/영상자막/임베딩 허용(폰트파일 수정·유료판매 금지). 그 외 Pretendard/Gmarket/배민(BM)계열/눈누(noonnu) 무료폰트.
- 작업: woff2를 `packages/web/public/fonts/`에 넣고 `globals.css`에 `@font-face` 15종 정의(`font-family`는 fonts.ts의 `css` 값과 정확히 일치). CaptionEditor가 `fontFamily: s.font`로 적용하므로 이름만 맞으면 미리보기·렌더 둘 다 반영.
- `fonts.ts` 목록을 실제 확보한 폰트로 정리(라이선스 불명 폰트 제외). 온글잎 외 어떤 폰트 원하는지 사용자에게 한 번 확인 권장.

## 성공 기준
- 8000 서버 LISTEN PID = venv python (글로벌 아님)
- `workdir/67801cdd/verify8.png` 에서 중국어 자막 깨끗 제거(번짐 없음)
- 웹 분석 → 미리보기에 자막제거 영상, ffmpeg 에러 없음
- 웹 폰트 미리보기서 폰트별 글꼴 실제 달라짐

## 건드리지 말 것 (동작 검증됨)
- `subtitle_detect.detect_segments`(conf_min=0.0, bottom_ratio=0.4 — easyocr 흰자막 conf≈0이라 위치만으로 판정. 낮추지 마라)
- `subtitle_inpaint.inpaint_subtitles`(simple-lama, 8s 자막 제거 확인됨)
- venv torch(2.11.0+cu128) — **절대 재설치/다운그레이드 금지**. lama 의존성이 torch 바꾸려 하면 `--no-deps`.
