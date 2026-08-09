# BGM / SFX 음원 디렉토리

이 디렉토리에 BGM/효과음 음원(mp3)을 넣으면 렌더 시 배경음으로 믹싱됩니다.

## 음원 넣기

저작권상 음원 파일은 레포에 번들하지 않습니다. 무료(CC0/PD) 음원을 직접 다운로드해 이 디렉토리에 넣어주세요.

추천 출처:
- **Pixabay Music** (https://pixabay.com/music/) — CC0, 상업용 가능, 출처 표시 불필요
- **YouTube 오디오 보관실** (https://www.youtube.com/audiolibrary) — YouTube 콘텐츠용 무료
- **Free Music Archive** (https://freemusicarchive.org/) — CC 라이선스별 확인 필요

## 매니페스트

`manifest.json`에 음원 정보(id/file/title/mood/duration/source)를 기록합니다.
- `id`: 렌더 요청(RenderReq.bgm)에서 참조하는 식별자.
- `file`: 이 디렉토리 기준 파일명.
- 음원을 추가하면 manifest.json에도 항목을 추가하세요.

## 사용

웹 UI(렌더 스테이지)에서 BGM을 선택하거나, API로 `bgm: "bgm_upbeat_cute"` 형태로 전달.
믹싱 로직은 `packages/core/app/pipeline/audio_mix.py` — TTS(100%) + BGM(기본 20%, 루핑+페이드) + SFX(원샷).
