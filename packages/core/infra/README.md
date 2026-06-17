# 클라우드 GPU 인프라 (Modal) — 자막 제거 측정/프로덕션

로컬 RTX 3070 8GB는 ProPainter OOM(1080x1920 native ~17GB). 제품은 SaaS라 영상 처리는
서버측에서 한다 → **GPU 단계만 Modal(클라우드 GPU)로 오프로드**. 목표는 ① 풀해상도 품질
확인 ② **영상 1개당 GPU 처리시간·원가** 측정. (전략 배경은 Notion `Shots_Generator` #5 참고)

## 0. 1회 셋업

```powershell
cd packages\core
.\.venv\Scripts\python.exe -m pip install modal      # 반드시 venv에 설치
.\.venv\Scripts\python.exe -m modal token new        # 브라우저 인증(계정 없으면 가입, 월 무료 크레딧)
```

> ⚠️ **반드시 venv 파이썬으로 실행**(`.\.venv\Scripts\python.exe -m modal ...`).
> 글로벌 `modal.exe`로 돌리면 local_entrypoint가 cv2/torch 없는 글로벌 파이썬에서 실행돼
> `ModuleNotFoundError: No module named 'cv2'` 발생. 토큰은 `~/.modal.toml`(사용자 단위)이라 1회만.
> 인증은 인터랙티브라 Claude가 대신 못 함 — 터미널에서 `!` 로 실행.

## 1. 측정 (트랙 1) — 풀해상도 품질·단가 베이스라인

```powershell
# 샘플 영상 하나로 (자막 자동탐지 → Modal GPU → 합성). 반드시 venv 파이썬으로!
.\.venv\Scripts\python.exe -m modal run infra/modal_propainter.py --video "workdir\df68eb60\source.mp4"

# 옵션
.\.venv\Scripts\python.exe -m modal run infra/modal_propainter.py --video "<v.mp4>" --resize-ratio 1.0 --subvideo-length 80 --neighbor-length 10
$env:PP_GPU="A100"; .\.venv\Scripts\python.exe -m modal run infra/modal_propainter.py --video "<v.mp4>"   # 더 빠른/큰 GPU
```

GPU 타입은 `PP_GPU` 환경변수로(`L4`/`A10G`/`A100`/`H100`). 끝나면 리포트 출력:
GPU·해상도·**처리시간·peak VRAM·영상당 원가(≈$)**. 출력 mp4를 LaMa 결과와 눈으로 비교.

### 무엇을 보고 무엇을 결정하나
- **품질**: ProPainter(시간축 복원)가 LaMa(프레임독립) 대비 자막영역 얼룩/번짐을 잡는가.
- **단가**: `영상당 원가`가 쇼츠 단가 모델에 맞는가. 너무 비싸면 resize_ratio↓ / subvideo↓ /
  neighbor↓ 로 VRAM·시간 줄이거나(품질 트레이드오프), 더 싼 GPU(RunPod 4090)·경량 엔진 재검토.

## 2. 프로덕션 배선 (트랙 2 — 측정 후)

```powershell
modal deploy infra/modal_propainter.py     # run_propainter 를 상시 엔드포인트로 배포
```

배포 후 `packages/core`의 자막제거 단계가 로컬 subprocess 대신 이 함수를 호출하도록
`app/pipeline/propainter_inpaint.py`에 원격 모드(`PROPAINTER_BACKEND=modal`)를 추가한다.
scale-to-zero라 호출 없을 땐 과금 0.

## OOM 대응 (중요)

ProPainter는 **클립 전체 프레임에 대해 광학흐름을 한 번에 계산** → VRAM이 해상도뿐 아니라
**클립 길이(프레임 수)에 비례**한다. 47초(1413프레임) 풀해상도는 A10G(24GB)도 OOM.
`subvideo_length`는 인페인팅 단계만 쪼개고 흐름 단계는 안 쪼개므로 길이 문제엔 효과 제한적.

대응(효과 큰 순):
1. **클립을 짧게** — 측정/품질판단엔 10~15초면 충분. `ffmpeg -i in.mp4 -t 12 ... short.mp4`
2. **해상도 낮추기** — `--resize-ratio 0.5`(품질 트레이드오프)
3. **큰 GPU** — `$env:PP_GPU="A100"`(40GB)로 풀클립 시도
4. (프로덕션) **시간축 청크 분할** — 영상을 N초 단위로 잘라 각각 ProPainter → 이어붙이기.
   길이 무관하게 메모리 상한 고정. 본 배포 전 구현 필요.

## 가격 메모(대략치 — 반드시 콘솔에서 확인)
| GPU | VRAM | $/hr(대략) | 비고 |
|---|---|---|---|
| L4 | 24GB | ~0.80 | 전성비, 느림 |
| A10G | 24GB | ~1.10 | 균형(기본값) |
| A100 | 40/80GB | ~2.50 | 빠름·대용량 |
| H100 | 80GB | ~4.50 | 최速 |

> 최저 단가 속도는 RunPod/Vast의 4090이 더 유리. Modal은 운영 단순함+scale-to-zero가 강점.
> 물량 커지면 GPU만 갈아끼우는 식으로 이전 가능.
