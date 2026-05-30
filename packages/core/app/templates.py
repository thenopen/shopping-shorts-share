"""자막 스타일 템플릿 (프리셋).

사용자가 자막 스타일(폰트/색/효과)을 저장해두고 재사용.
UI에서 "템플릿 선택"하면 그 스타일이 자막 전체 기본값으로.

저장 위치: SQLite 또는 JSON (Phase 3에서 결정).
지금은 코드 내장 기본 프리셋 몇 개만.
"""
from app.pipeline.caption import CaptionStyle


# 내장 기본 템플릿. 동생이 보고 "이런 식으로 늘리면 되는구나" 알게.
PRESETS = {
    "기본": CaptionStyle(
        font="Pretendard", size=64,
        primary_color="FFFFFF", outline_color="000000", outline_width=3,
        shadow=2, bold=True,
    ),
    "강조노랑": CaptionStyle(
        font="GmarketSans", size=72,
        primary_color="FFE600", outline_color="000000", outline_width=4,
        shadow=3, bold=True,
    ),
    "그라데이션": CaptionStyle(
        font="서울한강체", size=70,
        gradient=("FF6699", "9966FF"), outline_color="FFFFFF", outline_width=2,
        shadow=2, bold=True,
    ),
}


def get_preset(name: str) -> CaptionStyle:
    return PRESETS.get(name, PRESETS["기본"])
