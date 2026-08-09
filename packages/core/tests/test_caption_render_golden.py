"""Tier 2 골든 테스트 — render_ass_text 의 ASS 출력을 고정 문자열과 비교.

render_ass(조립+파일쓰기)를 순수 함수 render_ass_text 로 분리(2026-08-09)한 덕분에
I/O 없이 결정론적 비교가 가능. 과거 "0,," 아티팩트(Format 헤더 필드 수 불일치), 스타일 매핑 회귀,
강조/애니/위치 변환 회귀를 잡는 안전망.

골든 파일 관리:
  - 첫 실행(또는 UPDATE_GOLDEN=1)시 fixtures/golden_*.ass 를 자동 생성.
  - 이후 실행은 디스크의 골든과 == 비교. 불일치 시 diff 출력 + 갱신 안내.
  - render_ass_text 출력이 의도적으로 바뀌면 UPDATE_GOLDEN=1 pytest 로 갱신.
"""
import os
from pathlib import Path

import pytest

from app.pipeline.caption import CaptionLine, CaptionStyle, render_ass_text

FIXTURES = Path(__file__).parent / "fixtures"
UPDATE = os.environ.get("UPDATE_GOLDEN") == "1"


def _scenario_default():
    """기본 스타일 + 가격/키워드 강조."""
    return [CaptionLine(text="무료배송 9900원", start=0.0, end=2.5)]


def _scenario_box():
    """박스 모드(BorderStyle=3) — 단일 줄, 강조 off."""
    st = CaptionStyle(box=True, box_color="000000", box_opacity=0.5, box_pad=6, emphasis=False)
    return [CaptionLine(text="안녕하세요", start=0.0, end=1.5, style=st)]


def _scenario_shadow_blur():
    """소프트 섀도 블러 레이어(별도 Dialogue)."""
    st = CaptionStyle(shadow=2, shadow_blur=4, shadow_color="000000", emphasis=False)
    return [CaptionLine(text="부드러운 그림자", start=0.5, end=2.0, style=st)]


def _scenario_glow():
    """글로우 레이어(별도 Dialogue)."""
    st = CaptionStyle(glow=True, glow_size=8, glow_color="FFE600", emphasis=False)
    return [CaptionLine(text="빛번짐", start=0.0, end=1.0, style=st)]


def _scenario_anim(anim: str):
    """등장 효과(fade/pop/rise)."""
    st = CaptionStyle(anim=anim, emphasis=False)
    return [CaptionLine(text=f"{anim} 효과", start=0.0, end=1.5, style=st)]


def _scenario_freepos():
    """자유위치(pos_x/pos_y) — \\an5\\pos prepend."""
    st = CaptionStyle(pos_x=0.5, pos_y=0.3, emphasis=False)
    return [CaptionLine(text="중앙 상단", start=0.0, end=1.0, style=st)]


def _scenario_multistyle():
    """구간별 다중 스타일 — S0/S1 dedupe 검증."""
    st0 = CaptionStyle(emphasis=False)
    st1 = CaptionStyle(font="BlackHanSans", size=80, primary_color="FF0000", emphasis=False)
    return [
        CaptionLine(text="첫줄 기본", start=0.0, end=1.0, style=st0),
        CaptionLine(text="둘째줄 빨강", start=1.0, end=2.0, style=st1),
        CaptionLine(text="셋째줄 기본 반복", start=2.0, end=3.0, style=st0),  # S0 재사용
    ]


SCENARIOS = [
    ("golden_default.ass", _scenario_default),
    ("golden_box.ass", _scenario_box),
    ("golden_shadow_blur.ass", _scenario_shadow_blur),
    ("golden_glow.ass", _scenario_glow),
    ("golden_anim_fade.ass", lambda: _scenario_anim("fade")),
    ("golden_anim_pop.ass", lambda: _scenario_anim("pop")),
    ("golden_anim_rise.ass", lambda: _scenario_anim("rise")),
    ("golden_freepos.ass", _scenario_freepos),
    ("golden_multistyle.ass", _scenario_multistyle),
]


@pytest.mark.parametrize("name,scenario_fn", SCENARIOS)
def test_render_ass_golden(name: str, scenario_fn):
    """각 시나리오의 ASS 출력을 골든 파일과 비교. 없으면 생성(첫 실행)."""
    lines = scenario_fn()
    actual = render_ass_text(lines, 1080, 1920, margin_v=346)
    golden_path = FIXTURES / name

    if UPDATE or not golden_path.exists():
        FIXTURES.mkdir(parents=True, exist_ok=True)
        golden_path.write_text(actual, encoding="utf-8")
        if not UPDATE:
            pytest.skip(f"골든 파일 생성됨({name}) — 재실행하면 검증됨")
        return

    expected = golden_path.read_text(encoding="utf-8")
    if actual != expected:
        # diff 를 보기 쉽게 줄 단위로 첫 차이점 표시
        a_lines = actual.splitlines()
        e_lines = expected.splitlines()
        first_diff = next((i for i, (a, e) in enumerate(zip(a_lines, e_lines)) if a != e), -1)
        msg = [f"골든 파일({name})과 출력이 다릅니다. 의도적 변경이면 UPDATE_GOLDEN=1 pytest 로 갱신."]
        if first_diff >= 0:
            msg.append(f"첫 차이 줄 {first_diff + 1}:")
            msg.append(f"  기대: {e_lines[first_diff]!r}")
            msg.append(f"  실제: {a_lines[first_diff]!r}")
        else:
            msg.append(f"줄 수 차이: 기대 {len(e_lines)}줄, 실제 {len(a_lines)}줄")
        pytest.fail("\n".join(msg))


def test_render_ass_text_empty_lines_safe():
    """빈 lines 도 기본 S0 한 줄로 안전하게 헤더 생성(빈 입력 안전장치)."""
    out = render_ass_text([], 1080, 1920)
    assert "[Script Info]" in out
    assert "[V4+ Styles]" in out
    assert "Style: S0," in out   # 기본 스타일 한 줄
    assert "[Events]" in out
    # Dialogue 는 없어야(lines 가 비었으므로)
    assert "Dialogue:" not in out


def test_render_ass_text_format_field_count():
    """[V4+ Styles] Format 과 Style 행의 필드 수 일치 — 과거 '0,,' 아티팩트 회귀 감지.

    ASS [V4+ Styles] Format 은 23개 필드(Name, Fontname, Fontsize, PrimaryColour,
    SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut,
    ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment,
    MarginL, MarginR, MarginV, Encoding). Style 행도 같은 수여야(libass 가 필드를 잘못 파싱 안 함).
    """
    out = render_ass_text(_scenario_default(), 1080, 1920)
    lines = out.splitlines()
    fmt_line = next(l for l in lines if l.startswith("Format: Name,"))
    style_line = next(l for l in lines if l.startswith("Style: S"))
    assert len(fmt_line.split(",")) == 23, f"Format 필드 수: {len(fmt_line.split(','))}"
    assert len(style_line.split(",")) == 23, f"Style 필드 수: {len(style_line.split(','))}"

    # [Events] Format 과 Dialogue 도 10개 필드(Layer,...,Text)
    ev_fmt = next(l for l in lines if l.startswith("Format: Layer,"))
    assert len(ev_fmt.split(",")) == 10
    dlg = next(l for l in lines if l.startswith("Dialogue:"))
    assert len(dlg.split(",")) == 10, f"Dialogue 필드 수: {len(dlg.split(','))}"
