"""[6] 자동 자막 생성 — ASS 자막 (난이도 상, 차별화 포인트).

강의 도구보다 강력한 자막 편집기가 목표.
요구사항:
  - TTS 음성 타임스탬프로 자동 싱크
  - 구간별로 다른 폰트 / 다른 사이즈
  - 그라데이션 / 테두리(outline) / 그림자(shadow)
  - 기울기(italic)
  - 템플릿 저장/불러오기

왜 ASS인가:
  ffmpeg drawtext로는 구간별 스타일/그라데이션이 한계.
  ASS(Advanced SubStation Alpha)는 libass로 렌더되며
  폰트/색/테두리/그림자/위치/타이밍을 라인마다 자유롭게 지정 가능.
  → ffmpeg -vf "ass=sub.ass" 로 영상에 구움(burn-in).

흐름:
  TTS 타임스탬프(WordBoundary) → 자막 라인+타이밍 →
  스타일 적용 → .ass 파일 생성 → ffmpeg로 영상에 burn-in
"""
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class CaptionStyle:
    """자막 한 구간의 스타일. 템플릿의 기본단위."""
    font: str = "Pretendard"        # assets/fonts 의 폰트명
    size: int = 64
    primary_color: str = "FFFFFF"   # 글자색 (hex)
    outline_color: str = "000000"   # 테두리색
    outline_width: int = 3
    shadow: int = 2                 # 그림자 깊이 (0=없음)
    italic: bool = False
    gradient: tuple | None = None   # (top_color, bottom_color) — None이면 단색
    bold: bool = True


@dataclass
class CaptionLine:
    """자막 한 줄 = 텍스트 + 타이밍 + 스타일."""
    text: str
    start: float          # 초
    end: float            # 초
    style: CaptionStyle = field(default_factory=CaptionStyle)


def build_lines_from_tts(timestamps: list, default_style: CaptionStyle) -> list:
    """edge-tts WordBoundary 타임스탬프 → CaptionLine 리스트.

    timestamps 예: [{"text": "안녕하세요", "offset": 0.0, "duration": 0.8}, ...]
    단어를 적당히 묶어 한 줄(2~3초) 단위 자막으로.

    TODO: 줄 묶기 규칙(글자수/시간), 문장부호 기준 분할.
    """
    raise NotImplementedError("Phase 2에서 구현")


def render_ass(lines: list, out_ass: Path, video_w: int, video_h: int) -> Path:
    """CaptionLine 리스트 → .ass 자막 파일.

    각 라인의 CaptionStyle을 ASS Style/Dialogue로 변환.
    그라데이션은 ASS \\1c 태그 + 클립 또는 멀티레이어 트릭으로.

    TODO: ASS 헤더(Script Info/Styles) 작성, Dialogue 라인 생성.
    TODO: 그라데이션/쉐도우/테두리 태그 매핑.
    """
    raise NotImplementedError("Phase 2에서 구현")


def burn_captions(video_path: Path, ass_path: Path, out_path: Path) -> Path:
    """ffmpeg로 .ass 자막을 영상에 burn-in.

    cmd: ffmpeg -i video -vf "ass=sub.ass" out
    (폰트는 assets/fonts 를 fontsdir로 지정)

    TODO: 윈도우 경로 이스케이프 주의(ass 필터 경로 콜론 문제).
    """
    raise NotImplementedError("Phase 2에서 구현")
