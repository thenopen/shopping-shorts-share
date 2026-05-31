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
    outline: bool = True            # 외곽선 on/off
    outline_color: str = "000000"   # 테두리색
    outline_width: int = 3
    shadow: int = 2                 # 그림자 깊이 (0=없음)
    italic: bool = False
    gradient: tuple | None = None   # (top_color, bottom_color) — None이면 단색
    bold: bool = True
    box: bool = False               # 박스(BorderStyle=3) on/off
    box_color: str = "000000"       # 박스 배경색
    box_opacity: float = 0.5        # 박스 불투명도(0~1)


@dataclass
class CaptionLine:
    """자막 한 줄 = 텍스트 + 타이밍 + 스타일."""
    text: str
    start: float          # 초
    end: float            # 초
    style: CaptionStyle = field(default_factory=CaptionStyle)


def style_from_dict(d: dict | None, base: CaptionStyle | None = None) -> CaptionStyle:
    """웹 CaptionStyle(dict) → CaptionStyle dataclass.

    base 주면 그 위에 d로 덮어씀(줄별 override). d 없으면 base(또는 기본) 반환.
    웹 키: font,size,color,outline,outlineColor,outlineWidth,shadow,italic,bold,box,boxColor,boxOpacity.
    """
    b = base or CaptionStyle()
    if not d:
        return b

    def hx(v, dflt):
        v = v if v not in (None, "") else dflt
        return str(v).lstrip("#").upper() or dflt

    return CaptionStyle(
        font=d.get("font", b.font),
        size=int(d.get("size", b.size)),
        primary_color=hx(d.get("color"), b.primary_color),
        outline=bool(d.get("outline", b.outline)),
        outline_color=hx(d.get("outlineColor"), b.outline_color),
        outline_width=int(d.get("outlineWidth", b.outline_width)),
        shadow=2 if d.get("shadow", b.shadow > 0) else 0,
        italic=bool(d.get("italic", b.italic)),
        bold=bool(d.get("bold", b.bold)),
        box=bool(d.get("box", b.box)),
        box_color=hx(d.get("boxColor"), b.box_color),
        box_opacity=float(d.get("boxOpacity", b.box_opacity)),
    )


def lines_from_payload(payload: list, default_style: CaptionStyle) -> list:
    """웹에서 편집된 자막 줄(JSON) → CaptionLine 리스트.

    payload 예: [{"text":"...", "start":0.0, "end":2.0, "style":{...}|null}, ...]
    style 없으면(null) default_style 사용 → 줄별 override 가능.
    """
    out: list[CaptionLine] = []
    for it in payload or []:
        text = (it.get("text") or "").strip()
        if not text:
            continue
        try:
            start = float(it.get("start", 0.0))
            end = float(it.get("end", start))
        except (TypeError, ValueError):
            continue
        if end < start:
            end = start
        st = style_from_dict(it.get("style"), base=default_style)
        out.append(CaptionLine(text=text, start=round(start, 2),
                               end=round(end, 2), style=st))
    return out


def lines_to_payload(lines: list, default_style: CaptionStyle) -> list:
    """CaptionLine 리스트 → 웹 편집용 JSON(줄별 스타일은 기본과 다를 때만 포함)."""
    base_sig = _style_sig(default_style)
    out = []
    for ln in lines:
        st = getattr(ln, "style", None) or default_style
        style_dict = None
        if _style_sig(st) != base_sig:
            style_dict = _style_to_web(st)
        out.append({
            "text": (ln.text or "").replace("\\N", "\n"),
            "start": round(float(ln.start), 2),
            "end": round(float(ln.end), 2),
            "style": style_dict,
        })
    return out


def _style_to_web(st: CaptionStyle) -> dict:
    """CaptionStyle → 웹 CaptionStyle(dict)."""
    return {
        "font": st.font,
        "size": st.size,
        "color": "#" + st.primary_color,
        "outline": st.outline,
        "outlineColor": "#" + st.outline_color,
        "outlineWidth": st.outline_width,
        "shadow": st.shadow > 0,
        "italic": st.italic,
        "bold": st.bold,
        "box": st.box,
        "boxColor": "#" + st.box_color,
        "boxOpacity": st.box_opacity,
    }


def build_lines_from_tts(
    timestamps: list,
    default_style: CaptionStyle,
    max_chars: int = 13,
    max_dur: float = 2.2,
    total_dur: float | None = None,
    full_text: str | None = None,
) -> list:
    """TTS 타임스탬프 → CaptionLine 리스트(타임코드 맞춤, 적당한 길이로 분할).

    timestamps 예: [{"text": "안녕", "offset": 0.0, "duration": 0.4}, ...]
    단어를 묶어 한 줄(≤max_chars글자, ≤max_dur초) 단위 자막으로.
    문장부호(. ! ? , …)에서 우선 끊음.

    timestamps 없으면(google TTS 등) total_dur + full_text로 글자수 균등분할 폴백.
    """
    if not timestamps:
        return _lines_uniform(full_text or "", total_dur or 0.0, default_style,
                              max_chars=max_chars, max_dur=max_dur)

    lines: list[CaptionLine] = []
    cur_words: list[str] = []
    cur_start: float | None = None
    cur_end: float = 0.0

    def joined_text():
        return " ".join(w for w in cur_words if w).strip()

    def flush():
        nonlocal cur_words, cur_start, cur_end
        text = joined_text()
        if text and cur_start is not None:
            lines.append(CaptionLine(text=_wrap(text, max_chars),
                                     start=round(cur_start, 2),
                                     end=round(cur_end, 2), style=default_style))
        cur_words = []
        cur_start = None

    BREAK = ("。", "！", "？", ".", "!", "?", "…")
    SOFT = ("，", ",", "、")
    for ts in timestamps:
        w = ts.get("text", "")
        off = float(ts.get("offset", 0.0))
        dur = float(ts.get("duration", 0.0))
        if cur_start is None:
            cur_start = off
        cur_words.append(w)
        cur_end = off + dur
        joined = joined_text()
        clean = joined.rstrip()
        hard_break = any(clean.endswith(b) for b in BREAK)
        soft_break = any(clean.endswith(b) for b in SOFT)
        too_long = len(joined) >= max_chars or (cur_end - cur_start) >= max_dur
        if hard_break or (too_long and (soft_break or len(joined) >= max_chars)):
            flush()
    flush()
    # 자막은 다음 줄 시작 전까지 보이게(틈 메움) — 끊김 방지
    for i in range(len(lines) - 1):
        if lines[i].end < lines[i + 1].start:
            lines[i].end = lines[i + 1].start
    return lines


def _wrap(text: str, max_chars: int) -> str:
    """한 줄이 max_chars 넘으면 \\N(ASS 개행)으로 2줄까지 분할(화면폭 잘림 방지)."""
    text = (text or "").strip()
    if len(text) <= max_chars:
        return text
    # 띄어쓰기 있으면 중앙 근처 공백서 자름, 없으면 글자수 중앙
    mid = len(text) // 2
    sp = text.rfind(" ", 0, max_chars + 1)
    cut = sp if sp > max_chars // 2 else min(max_chars, mid)
    return text[:cut].strip() + "\\N" + text[cut:].strip()


def _lines_uniform(text: str, total: float, style: CaptionStyle,
                   max_chars: int = 18, max_dur: float = 2.6) -> list:
    """타임스탬프 없을 때: 전체 텍스트를 글자수 비례로 균등분할."""
    text = (text or "").strip()
    if not text or total <= 0:
        return []
    import re
    # 문장부호 기준 청크 후 max_chars로 재분할
    raw = re.split(r"(?<=[.!?。！？…])\s*", text)
    chunks: list[str] = []
    for seg in raw:
        seg = seg.strip()
        while len(seg) > max_chars:
            cut = seg.rfind(" ", 0, max_chars)
            cut = cut if cut > 0 else max_chars
            chunks.append(seg[:cut].strip())
            seg = seg[cut:].strip()
        if seg:
            chunks.append(seg)
    if not chunks:
        return []
    total_chars = sum(len(c) for c in chunks) or 1
    lines: list[CaptionLine] = []
    t = 0.0
    for c in chunks:
        share = len(c) / total_chars
        dur = min(max_dur, max(0.8, total * share))
        lines.append(CaptionLine(text=c, start=round(t, 2),
                                 end=round(t + dur, 2), style=style))
        t += dur
    # 마지막을 total에 맞춤
    if lines:
        lines[-1].end = round(max(lines[-1].end, total), 2)
    return lines


def _hex_to_ass(color: str, alpha: int = 0) -> str:
    """#RRGGBB → ASS &HAABBGGRR (BGR순서 + alpha. alpha 0=불투명, 255=투명)."""
    h = (color or "#FFFFFF").lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        h = "FFFFFF"
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def _ass_time(t: float) -> str:
    """초 → ASS 타임 H:MM:SS.cc."""
    t = max(0.0, t)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    cs = int(round((t - int(t)) * 100))
    if cs == 100:
        cs = 99
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _style_sig(st) -> tuple:
    """스타일 동일성 키 — 같으면 ASS Style 1개 재사용(중복 방지)."""
    return (
        getattr(st, "font", "Pretendard"),
        getattr(st, "size", 64),
        getattr(st, "primary_color", "FFFFFF"),
        getattr(st, "outline_color", "000000"),
        getattr(st, "outline", True),
        getattr(st, "outline_width", 3),
        getattr(st, "shadow", 2),
        getattr(st, "bold", True),
        getattr(st, "italic", False),
        getattr(st, "box", False),
        getattr(st, "box_color", "000000"),
        round(float(getattr(st, "box_opacity", 0.5)), 3),
    )


def _style_row(name: str, st, margin_v: int) -> str:
    """CaptionStyle → ASS [V4+ Styles] Style 행 1개."""
    primary = _hex_to_ass(getattr(st, "primary_color", "FFFFFF"))
    outline_c = _hex_to_ass(getattr(st, "outline_color", "000000"))
    box = getattr(st, "box", False)
    box_color = getattr(st, "box_color", "000000")
    box_alpha = int(round((1 - float(getattr(st, "box_opacity", 0.5))) * 255))
    back = _hex_to_ass(box_color, box_alpha) if box else _hex_to_ass("000000", 100)
    border_style = 3 if box else 1
    bold = -1 if getattr(st, "bold", True) else 0
    italic = -1 if getattr(st, "italic", False) else 0
    outline_w = getattr(st, "outline_width", 3) if getattr(st, "outline", True) else 0
    shadow = getattr(st, "shadow", 2)
    font = getattr(st, "font", "Pretendard")
    size = getattr(st, "size", 64)
    return (
        f"Style: {name},{font},{size},{primary},{primary},{outline_c},{back},"
        f"{bold},{italic},0,0,100,100,0,0,{border_style},{outline_w},{shadow},2,60,60,{margin_v},1"
    )


def render_ass(lines: list, out_ass: Path, video_w: int, video_h: int,
               margin_v: int = 210) -> Path:
    """CaptionLine 리스트 → .ass 자막 파일(libass burn-in용).

    구간(줄)별로 다른 스타일 지원 — 줄마다 ln.style 보고 ASS Style를 만들어
    중복 제거 후 각 Dialogue가 자기 줄 스타일을 참조한다.
    margin_v: 하단에서 자막까지 픽셀(쇼츠 하단 CTA와 안 겹치게).
    """
    out_ass = Path(out_ass)
    out_ass.parent.mkdir(parents=True, exist_ok=True)

    # 줄별 스타일 → 시그니처로 dedupe, 이름 부여(S0,S1,...).
    sig_to_name: dict = {}
    style_rows: list[str] = []
    line_style_name: list[str] = []
    for ln in lines:
        st = getattr(ln, "style", None) or CaptionStyle()
        sig = _style_sig(st)
        name = sig_to_name.get(sig)
        if name is None:
            name = f"S{len(sig_to_name)}"
            sig_to_name[sig] = name
            style_rows.append(_style_row(name, st, margin_v))
        line_style_name.append(name)
    if not style_rows:  # 빈 입력 안전장치
        style_rows.append(_style_row("S0", CaptionStyle(), margin_v))

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video_w}
PlayResY: {video_h}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{chr(10).join(style_rows)}

[Events]
Format: Layer, Start, End, Style, MarginL, MarginR, Effect, Text
"""
    dialog = []
    for i, ln in enumerate(lines):
        text = (ln.text or "").replace("\n", "\\N")
        sname = line_style_name[i] if i < len(line_style_name) else "S0"
        dialog.append(
            f"Dialogue: 0,{_ass_time(ln.start)},{_ass_time(ln.end)},{sname},,0,0,0,,{text}"
        )
    out_ass.write_text(header + "\n".join(dialog) + "\n", encoding="utf-8")
    return out_ass


def burn_captions(video_path: Path, ass_path: Path, out_path: Path,
                  fonts_dir: Path | None = None) -> Path:
    """ffmpeg로 .ass 자막을 영상에 burn-in.

    윈도우 경로 콜론 문제 회피: ass/out 파일을 영상 폴더로 두고 cwd 기준
    상대경로(파일명)로 필터 인자 전달. fonts_dir에 ttf/otf 폰트 둠.
    """
    import os
    import subprocess
    from app.config import FFMPEG

    video_path, ass_path, out_path = Path(video_path), Path(ass_path), Path(out_path)
    work = out_path.parent.resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    vid_rel = os.path.relpath(video_path.resolve(), work)
    ass_rel = os.path.relpath(ass_path.resolve(), work)
    out_rel = os.path.relpath(out_path.resolve(), work)

    # ass 필터: 경로 구분자 / 로, 파일명만 쓰면 콜론 이스케이프 불필요
    ass_arg = ass_rel.replace("\\", "/")
    vf = f"ass={ass_arg}"
    if fonts_dir and Path(fonts_dir).exists():
        fd_rel = os.path.relpath(Path(fonts_dir).resolve(), work).replace("\\", "/")
        vf = f"ass={ass_arg}:fontsdir={fd_rel}"

    cmd = [FFMPEG, "-hide_banner", "-y", "-i", vid_rel.replace("\\", "/"),
           "-vf", vf, "-c:v", "libx264", "-preset", "fast", "-crf", "20",
           "-pix_fmt", "yuv420p", "-c:a", "copy", out_rel.replace("\\", "/")]
    r = subprocess.run(cmd, cwd=str(work), capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(
            f"ffmpeg 자막 burn 실패 (code {r.returncode})\nCWD: {work}\n"
            f"CMD: {' '.join(cmd)}\nSTDERR:\n{(r.stderr or '')[-1500:]}"
        )
    return out_path
