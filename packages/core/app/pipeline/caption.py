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
    shadow_color: str = "000000"    # 그림자색 (ASS BackColour로 매핑)
    shadow_blur: int = 0            # 그림자 흐림(px) — >0이면 메인 뒤 블러 레이어로 근사
    glow: bool = False              # 글로우(빛번짐) on/off — 메인 뒤 블러 외곽 레이어
    glow_color: str = "FFE600"      # 글로우색
    glow_size: int = 0             # 글로우 크기(px ≈ \bord·\blur)
    italic: bool = False
    gradient: tuple | None = None   # (top_color, bottom_color) — None이면 단색
    bold: bool = True
    box: bool = False               # 박스(BorderStyle=3) on/off
    box_color: str = "000000"       # 박스 배경색
    box_opacity: float = 0.5        # 박스 불투명도(0~1)
    box_pad: int = 6                # 박스 글자~테두리 여백 px (ASS Outline로 매핑)
    # NOTE: boxRadius(둥근 모서리)는 libass가 지원 안 해 burn-in 불가 → 웹 프리뷰 전용.
    pos_v: str = "bottom"           # 자막 세로 위치: top/middle/bottom (ASS Alignment)
    pos_x: float | None = None      # 자유위치 가로(0~1, 중심 앵커). None=pos_v 프리셋 사용
    pos_y: float | None = None      # 자유위치 세로(0~1, 중심 앵커). None=pos_v 프리셋 사용
    emphasis: bool = True           # 가격·혜택 등 핵심 단어 자동 강조(인라인 색/크기 팝)
    emphasis_color: str = "FFE600"  # 강조 단어 색 (hex)
    animate: bool = False           # 워드바이워드 애니(말할 때 단어 팝 + 강조어 색). words 타임스탬프 필요
    anim: str = "none"              # 줄 등장 효과: none/fade/pop/rise (웹 anim과 동일)


@dataclass
class CaptionLine:
    """자막 한 줄 = 텍스트 + 타이밍 + 스타일 + 수동 강조."""
    text: str
    start: float          # 초
    end: float            # 초
    style: CaptionStyle = field(default_factory=CaptionStyle)
    emph: list | None = None   # 수동 강조 단어 인덱스. None=자동(정규식), []/[i…]=그 단어만
    words: list | None = None  # 워드바이워드 애니용 [{text,start,end}](절대초). 없으면 애니 불가(정적)


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
        shadow_color=hx(d.get("shadowColor"), b.shadow_color),
        shadow_blur=int(d.get("shadowBlur", b.shadow_blur)),
        glow=bool(d.get("glow", b.glow)),
        glow_color=hx(d.get("glowColor"), b.glow_color),
        glow_size=int(d.get("glowSize", b.glow_size)),
        italic=bool(d.get("italic", b.italic)),
        bold=bool(d.get("bold", b.bold)),
        box=bool(d.get("box", b.box)),
        box_color=hx(d.get("boxColor"), b.box_color),
        box_opacity=float(d.get("boxOpacity", b.box_opacity)),
        # 웹은 좌우/상하 여백 따로 보냄 → ASS는 단일 Outline값이라 평균으로 매핑.
        box_pad=int(round((int(d.get("boxPadX", b.box_pad)) +
                           int(d.get("boxPadY", b.box_pad))) / 2)),
        pos_v=str(d.get("posV", b.pos_v)),
        emphasis=bool(d.get("emphasis", b.emphasis)),
        emphasis_color=hx(d.get("emphasisColor"), b.emphasis_color),
        animate=bool(d.get("animate", b.animate)),
        anim=(str(d.get("anim")) if d.get("anim") in ("none", "fade", "pop", "rise") else b.anim),
        pos_x=(float(d["posX"]) if d.get("posX") is not None else b.pos_x),
        pos_y=(float(d["posY"]) if d.get("posY") is not None else b.pos_y),
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
        em = it.get("emph")
        emph = [int(x) for x in em] if isinstance(em, list) else None
        wd = it.get("words")
        words = wd if isinstance(wd, list) and wd else None
        out.append(CaptionLine(text=text, start=round(start, 2),
                               end=round(end, 2), style=st, emph=emph, words=words))
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
            "emph": getattr(ln, "emph", None),
            "words": getattr(ln, "words", None),
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
        "shadowColor": "#" + st.shadow_color,
        "shadowBlur": st.shadow_blur,
        "glow": st.glow,
        "glowColor": "#" + st.glow_color,
        "glowSize": st.glow_size,
        "italic": st.italic,
        "bold": st.bold,
        "box": st.box,
        "boxColor": "#" + st.box_color,
        "boxOpacity": st.box_opacity,
        "boxPadX": st.box_pad,
        "boxPadY": st.box_pad,
        "posV": st.pos_v,
        "posX": st.pos_x,
        "posY": st.pos_y,
        "emphasis": st.emphasis,
        "emphasisColor": "#" + st.emphasis_color,
        "animate": st.animate,
        "anim": getattr(st, "anim", "none"),
    }


import re as _re

# 문장 끝(하드 브레이크) / 약한 끊음(소프트) 부호
_SENT_END = ("。", "！", "？", ".", "!", "?", "…")
_SOFT_END = ("，", ",", "、", "·", ";", ":")

# 핵심 강조 키워드(쇼핑 숏츠) — 가격/숫자 패턴은 아래 정규식이 따로 잡음.
_EMPH_KEYWORDS = [
    "무료배송", "무료", "최저가", "최저", "최대", "역대급", "초특가", "특가",
    "반값", "할인", "세일", "증정", "사은품", "한정", "단독", "오늘만",
    "마지막", "품절임박", "품절", "1+1", "원플원", "공짜", "득템", "꿀템",
]
# 숫자(가격/수량/퍼센트/단위) + 키워드 → 강조 대상
_EMPH_RE = _re.compile(
    r"(\d[\d,]*(?:\.\d+)?\s*(?:%|％|원|만원|천원|개|배|초|분|시간|일|주|개월|년|ml|g|kg|cm|호)?)"
    r"|(" + "|".join(_re.escape(k) for k in _EMPH_KEYWORDS) + r")"
)


def _vis_len(s: str) -> int:
    """공백 제외 표시 글자수(자막 길이 기준 — 한글 음절/숫자/영문 카운트)."""
    return len((s or "").replace(" ", ""))


def _clean_caption_text(text: str) -> str:
    """자막 텍스트 잡음 정리 — STT/TTS 필러·반복 문장부호 제거.

    고립된 자모 1글자('ㅇ' 등)는 인식/합성 잡음이라 제거하되, 2글자 이상 런(ㅋㅋ, ㅎㅎ 등)은
    대본의 의도적 표현이라 보존. (과거 'ㅇ,,' 증상은 ASS Format 헤더 버그의 '0,,' 오진이었음 —
    렌더 쪽은 수정됨. 이 정리는 순수 STT 필러용으로만 유지.)
    """
    t = text or ""
    # 고립 자모 1글자만 제거 — 조합형(U+1100~11FF)·호환(U+3130~318F)·반각(U+FFA0~FFDC) 블록 커버.
    t = _re.sub(r"[ᄀ-ᇿ㄰-㆏ﾠ-ￜ]+", lambda m: m.group(0) if len(m.group(0)) >= 2 else " ", t)
    t = _re.sub(r"[,，、]{2,}", ",", t)             # 반복 쉼표 → 하나
    t = _re.sub(r"[.。]{3,}", "…", t)              # 마침표 3+ → …
    t = _re.sub(r"\s+([,.。、，!?！？…])", r"\1", t)  # 부호 앞 공백 제거
    t = _re.sub(r"\s{2,}", " ", t).strip()
    return t.strip(" ,，、").strip()                # 양끝 고립 쉼표/공백 정리


def split_korean_lines(text: str, ideal: int = 8, max_chars: int = 10,
                       min_chars: int = 6) -> list[str]:
    """한국어 텍스트를 6~10자(목표 8) 의미단위 줄로 분할.

    띄어쓰기 어절(=내용어+조사/어미, 자연스러운 의미단위)을 글자수 예산으로 묶는다.
    - 한 어절이 max_chars를 넘으면 그 어절 자체를 강제 분할(아주 긴 합성어 대비).
    - 문장부호(。！？.…)에서 우선 끊음(min_chars 이상이면).
    - 누적이 ideal 도달하면 어절 경계에서 끊음 → 대부분 6~10자 단일 줄.
    """
    text = _clean_caption_text(_re.sub(r"\s+", " ", (text or "").replace("\n", " ")).strip())
    if not text:
        return []
    # 어절 토큰화 + 너무 긴 어절 강제 분할
    words: list[str] = []
    for w in text.split(" "):
        while _vis_len(w) > max_chars:
            words.append(w[:max_chars])
            w = w[max_chars:]
        if w:
            words.append(w)

    lines: list[str] = []
    cur = ""
    for w in words:
        cand = (cur + " " + w) if cur else w
        if cur and _vis_len(cand) > max_chars:
            lines.append(cur)
            cur = w
        else:
            cur = cand
        tail = cur.rstrip()
        if tail and tail[-1] in _SENT_END and _vis_len(cur) >= min_chars:
            lines.append(cur)
            cur = ""
            continue
        if _vis_len(cur) >= ideal:
            lines.append(cur)
            cur = ""
    if cur:
        # 마지막 잔여가 너무 짧으면(<min) 직전 줄에 합쳐 너무 짧은 자막 방지
        if lines and _vis_len(cur) < min_chars and _vis_len(lines[-1] + " " + cur) <= max_chars + 2:
            lines[-1] = lines[-1] + " " + cur
        else:
            lines.append(cur)
    return [ln.strip() for ln in lines if ln.strip()]


def _ass_emphasis(text: str, style, emph: list | None = None, inline: str = "") -> str:
    """라인 텍스트의 핵심 단어를 ASS 인라인 태그로 강조.

    매칭 구간을 {\\1c색\\fscx112\\fscy112\\b1}...{\\r} 로 감싸 색팝+살짝 키움.
    emph(단어 인덱스 list) 지정 시 그 단어만(수동), None이면 자동(가격/키워드 정규식).
    style.emphasis=False면 원문 그대로.
    inline: 줄 등장 효과(팝 스케일 \\t) — {\\r}가 라인 태그를 리셋하므로 \\r 뒤마다 재적용.
    \\t 타이밍은 이벤트 시작 기준 절대값이라 재선언해도 동일 애니로 이어진다.
    """
    if not getattr(style, "emphasis", True) or not text:
        return text
    col = _ass_c(getattr(style, "emphasis_color", "FFE600"))
    wrap = f"{{\\1c{col}\\fscx112\\fscy112\\b1}}%s{{\\r{inline}}}"

    if emph is not None:
        # 수동: 공백런 분할 단어(프론트 splitWords와 동일) 중 지정 인덱스만 강조.
        sel = set(emph)
        words = text.split()
        return " ".join(wrap % w if i in sel else w for i, w in enumerate(words))

    return _EMPH_RE.sub(lambda m: wrap % m.group(0), text)


def _align_words_to_text(text: str, words: list) -> list:
    """대본 원문 어절 ↔ TTS/whisper 단어 타임스탬프 정렬 → [{text,start,end}].

    화면 텍스트는 **대본 원문**(verbatim), 타이밍만 words에서 가져온다 —
    whisper가 발음대로 받아쓴 표기('달걀'→'달개', '맞아요!'→'맞아요.')가 자막에 노출되는 것 방지.
    어절 수 같으면 1:1 매핑, 다르면 글자수 누적 비율로 words 시간축에 보간.
    """
    toks = [t for t in (text or "").split() if t]
    ws = [w for w in (words or []) if (w.get("text") or "").strip()]
    if not toks or not ws:
        return []
    if len(toks) == len(ws):
        return [{"text": t, "start": round(float(w["start"]), 2), "end": round(float(w["end"]), 2)}
                for t, w in zip(toks, ws)]
    # 글자수 비례 보간 — words를 글자수 가중 구간으로 보고 스크립트 누적 비율 위치의 시각을 계산.
    wchars = [max(1, _vis_len(w.get("text") or "")) for w in ws]
    wtot = sum(wchars)

    def at(frac: float) -> float:
        target = frac * wtot
        acc = 0.0
        for w, c in zip(ws, wchars):
            if acc + c >= target - 1e-9:
                r = min(1.0, max(0.0, (target - acc) / c))
                return float(w["start"]) + r * (float(w["end"]) - float(w["start"]))
            acc += c
        return float(ws[-1]["end"])

    ttot = sum(_vis_len(t) for t in toks) or 1
    out = []
    acc = 0
    for t in toks:
        f0 = acc / ttot
        acc += _vis_len(t)
        f1 = acc / ttot
        out.append({"text": t, "start": round(at(f0), 2), "end": round(at(f1), 2)})
    return out


def _ass_animated(ln, st, intro_fad: bool = True, brk: int | None = None) -> str:
    """워드바이워드 애니 — 말할 때 단어 팝(scale) + 강조어(가격/키워드) 색 유지.
    \\t 오프셋은 라인 시작 기준 ms. words(단어별 절대초 타임스탬프) 필요.
    intro_fad=False면 기본 \\fad(100,0) 생략(등장 효과 anim이 이벤트 태그로 대신 넣음).
    화면 텍스트는 ln.text(대본 원문) 기준 — words의 발음 표기는 타이밍으로만 사용.
    brk: 2줄 배치 분할 어절 인덱스 — 그 단어 앞을 공백 대신 \\N으로.
    """
    words = _align_words_to_text((ln.text or "").replace("\n", " "), getattr(ln, "words", None) or [])
    if not words:
        return _ass_emphasis((ln.text or "").replace("\n", "\\N"), st, getattr(ln, "emph", None))
    line_start = float(ln.start)
    emph = getattr(ln, "emph", None)
    if emph is not None:
        emph_set = set(emph)
    else:
        emph_set = set(i for i, w in enumerate(words) if _EMPH_RE.search((w.get("text") or "")))
    accent = _ass_c(getattr(st, "emphasis_color", "FFE600"))
    use_emph = bool(getattr(st, "emphasis", True))
    parts = []
    for i, w in enumerate(words):
        txt = (w.get("text") or "").strip()
        if not txt:
            continue
        on = max(0, int(round((float(w.get("start", line_start)) - line_start) * 1000)))
        is_e = use_emph and (i in emph_set)
        pop = 130 if is_e else 118
        anim = f"\\t({on},{on + 70},\\fscx{pop}\\fscy{pop})\\t({on + 70},{on + 170},\\fscx100\\fscy100)"
        if is_e:
            parts.append(f"{{\\1c{accent}\\b1{anim}}}{txt}{{\\r}}")
        else:
            parts.append(f"{{{anim}}}{txt}{{\\r}}")
    # 2줄 배치: brk번째 단어 앞은 공백 대신 줄바꿈(정적 경로와 동일 분할점)
    out = []
    for idx, part in enumerate(parts):
        if idx:
            out.append("\\N" if idx == brk else " ")
        out.append(part)
    return ("{\\fad(100,0)}" if intro_fad else "") + "".join(out)


_PAUSE_GAP = 0.28   # 단어 사이 침묵(초) ≥ → 발화 쉼 = 자연 구/절 경계
# 한국어 연결어미(어절 끝) — 여기서 끊으면 절 경계라 자연스럽다.
_CONNECT = ("니까", "는데", "지만", "어서", "아서", "여서", "라서", "도록",
            "다가", "든지", "거나", "면서", "고", "서", "며", "면", "고요")


def _tail_bnd(clean: str) -> str:
    """누적 자막 끝의 경계 강도 — 문장끝(sent) / 절경계(clause) / 없음."""
    if not clean:
        return ""
    if clean[-1] in _SENT_END:
        return "sent"
    if clean[-1] in _SOFT_END:
        return "clause"
    toks = clean.split()
    if toks and any(toks[-1].endswith(c) for c in _CONNECT):
        return "clause"
    return ""


def _wmeta(items: list) -> list:
    """[{text,offset,duration}] → [{text,start,end}] 워드바이워드 애니용(공백 단어 제외)."""
    return [{"text": g.get("text", ""),
             "start": round(float(g.get("offset", 0.0)), 2),
             "end": round(float(g.get("offset", 0.0)) + float(g.get("duration", 0.0)), 2)}
            for g in items if (g.get("text") or "").strip()]


def _group_words(items: list, style, ideal_chars: int, min_chars: int,
                 max_chars: int, max_dur: float) -> list:
    """TTS 단어 리스트 → CaptionLine 리스트.
    발화 쉼(단어 간 침묵)·한국어 연결어미·문장부호·글자/시간 상한으로 분할.
    스크립트 의미단위가 없을 때의 폴백 + 긴 세그먼트 서브분할에 공용."""
    lines: list[CaptionLine] = []
    cur: list = []
    cur_start: float | None = None
    n = len(items)

    def joined():
        return " ".join((t.get("text") or "") for t in cur).strip()

    def flush():
        nonlocal cur, cur_start
        text = _clean_caption_text(joined())
        if text and cur_start is not None:
            bi = _break_index(text)   # 폭 초과면 생성 시점에 \n으로 2줄(렌더/프리뷰는 \n만 존중)
            if bi is not None:
                toks = text.split()
                text = " ".join(toks[:bi]) + "\n" + " ".join(toks[bi:])
            end = float(cur[-1].get("offset", 0.0)) + float(cur[-1].get("duration", 0.0))
            # words 텍스트를 자막 텍스트 어절로 정렬 — 클리닝으로 어절 수/표기가 달라져도 일치 보장.
            lines.append(CaptionLine(text=text, start=round(cur_start, 2), end=round(end, 2),
                                     style=style, words=_align_words_to_text(text, _wmeta(cur)) or None))
        cur = []
        cur_start = None

    for idx, ts in enumerate(items):
        off = float(ts.get("offset", 0.0))
        dur = float(ts.get("duration", 0.0))
        if cur_start is None:
            cur_start = off
        cur.append(ts)
        clean = _clean_caption_text(joined())
        vis = _vis_len(clean)
        if vis == 0:
            continue
        nxt = items[idx + 1] if idx + 1 < n else None
        gap = (float(nxt.get("offset", off + dur)) - (off + dur)) if nxt else 1e9
        seg_dur = (off + dur) - cur_start
        bnd = _tail_bnd(clean)
        # 우선순위: 상한(강제) → 문장끝 → 발화 쉼(자연) → 절경계+목표길이
        if vis >= max_chars or seg_dur >= max_dur:
            flush()
        elif bnd == "sent" and vis >= min_chars:
            flush()
        elif gap >= _PAUSE_GAP and vis >= min_chars:
            flush()
        elif bnd == "clause" and vis >= ideal_chars:
            flush()
    flush()
    return lines


def _meaning_segments(text: str | None) -> list:
    """스크립트 텍스트 → 의미단위 세그먼트. 대본 생성이 ENTER(줄바꿈)로 문장/구를 구분함."""
    if not text:
        return []
    out = []
    for raw in str(text).replace("\r", "\n").split("\n"):
        s = _clean_caption_text(raw)
        if s:
            out.append(s)
    return out


# ── 줄배치 알고리즘 (2단계) ──────────────────────────────────────────────
# 1단계: 세그먼트 → 자막 청크(DP 최소 raggedness). 2단계: 청크 → 1줄/2줄(\N 최적 분할점).
# ASS는 WrapStyle:2(자동 줄바꿈 없음)라 2줄은 우리가 \N으로 명시해야 한다.
# 웹 미리보기(caption/layout.ts)와 동일 로직·동일 상수 — 프리뷰=렌더 일치.

_WRAP_CHARS = 12   # 한 줄 표시 상한(공백 제외 글자수). 넘으면 2줄 배치. layout.ts와 동일 값.


def _gap_quality(prev_tok: str) -> float:
    """어절 사이 분할점 품질(클수록 자연 경계) — 앞 어절 끝 기준.
    문장끝 > 약한 부호 > 한국어 연결어미 > 일반."""
    if prev_tok and prev_tok[-1] in _SENT_END:
        return 3.0
    if prev_tok and prev_tok[-1] in _SOFT_END:
        return 2.0
    if any(prev_tok.endswith(c) for c in _CONNECT):
        return 1.6
    return 1.0


def _break_index(text: str) -> int | None:
    """2줄 분할 어절 인덱스 k(toks[k] 앞에서 줄바꿈) — 없으면 None(1줄 유지).

    비용 = 좌우 균형 잔차²/총폭 − 경계품질 보너스 + 위도우 페널티(한 줄이 1어절·4자 미만).
    각 줄 폭은 _WRAP_CHARS+2 이내 후보 우선, 전부 넘으면(초장문) 균형만으로 선택.
    """
    toks = (text or "").split()
    if len(toks) < 2:
        return None
    vis = [_vis_len(t) for t in toks]
    total = sum(vis)
    if total <= _WRAP_CHARS:
        return None
    cand: list = []       # (비용, k) — 폭 제약 만족 후보
    loose: list = []      # 폭 제약 무시 후보(폴백)
    left = 0
    for k in range(1, len(toks)):
        left += vis[k - 1]
        right = total - left
        widow = 0.0
        if k == 1 and left < 4:
            widow += 5.0
        if len(toks) - k == 1 and right < 4:
            widow += 5.0
        cost = (left - right) ** 2 / max(1, total) - 1.2 * _gap_quality(toks[k - 1]) + widow
        loose.append((cost, k))
        if left <= _WRAP_CHARS + 2 and right <= _WRAP_CHARS + 2:
            cand.append((cost, k))
    pool = cand or loose
    return min(pool)[1]


def _two_lines(text: str) -> tuple:
    """청크 텍스트 → (윗줄, 아랫줄|None, 분할 어절 인덱스|None)."""
    k = _break_index(text)
    if k is None:
        return text, None, None
    toks = text.split()
    return " ".join(toks[:k]), " ".join(toks[k:]), k


def _split_text_dp(text: str, max_chars: int) -> list:
    """세그먼트(어절)를 자막 청크들로 DP 분할 — 그리디 균형분할 대체(Knuth 최소 raggedness 축소판).

    자료구조: 어절 prefix sum(구간 폭 O(1)) + dp/prev 배열(경로 복원). O(n·청크폭).
    비용 = (폭−이상폭)²/이상폭 ÷ 경계품질 — 자연 경계(문장끝·부호·연결어미)에서 끊으면 할인.
    청크 상한 = 2줄 폭(2*max_chars). 마지막 청크는 짧아도 감점 완화(꼬리 억지 늘림 방지),
    너무 짧은 중간 청크(min 미만)는 가산 페널티.
    """
    toks = (text or "").split()
    n = len(toks)
    if n <= 1:
        return [text] if text else []
    pre = [0]
    for t in toks:
        pre.append(pre[-1] + _vis_len(t))
    total = pre[-1]
    cap = 2 * max_chars
    if total <= cap:
        return [text]                     # 한 청크(렌더에서 1~2줄 배치)
    ideal = max(4, int(round(max_chars * 1.5)))   # 2줄을 적극 활용하는 목표 폭
    INF = float("inf")
    dp = [INF] * (n + 1)
    prev = [-1] * (n + 1)
    dp[0] = 0.0
    for i in range(1, n + 1):
        for j in range(i - 1, -1, -1):
            w = pre[i] - pre[j]
            if w > cap and i - j > 1:     # 폭 초과(단, 초장문 단일 어절은 허용)
                break
            q = _gap_quality(toks[i - 1]) if i < n else 1.5   # 세그먼트 끝은 경계 취급
            cost = (w - ideal) ** 2 / ideal / q
            if i == n:
                cost *= 0.35              # 마지막 청크는 짧아도 자연스러움
            elif w < max(3, max_chars // 2):
                cost += 8.0               # 중간의 자투리 청크 억제
            if dp[j] + cost < dp[i]:
                dp[i] = dp[j] + cost
                prev[i] = j
    out: list = []
    i = n
    while i > 0:
        j = prev[i]
        out.append(" ".join(toks[j:i]))
        i = j
    return list(reversed(out))


def _emit_seg(lines: list, seg_text: str, cs: float, ce: float, wmeta: list,
              style, max_chars: int) -> None:
    """세그먼트 하나(스크립트 원문 seg_text)를 [cs,ce] 구간에 자막으로 방출.
    2줄 폭 초과면 어절 균형 서브분할, 각 조각 타이밍은 글자수 비례, 애니 words는 시간 겹침."""
    chunks = _split_text_dp(seg_text, max_chars)
    cvis_total = sum(_vis_len(c) for c in chunks) or 1
    span = max(0.0, ce - cs)
    cum = 0
    for ci, chunk in enumerate(chunks):
        s = cs + (cum / cvis_total) * span
        cum += _vis_len(chunk)
        e = ce if ci == len(chunks) - 1 else cs + (cum / cvis_total) * span
        cw = wmeta if (len(chunks) == 1 and wmeta) else [w for w in (wmeta or [])
                                                         if s <= (w["start"] + w["end"]) / 2 < e]
        clean = _clean_caption_text(chunk)
        # 줄바꿈은 '텍스트의 \n'으로만 표현(렌더·프리뷰가 자동 재분할 안 함). 폭 초과 청크는
        # 생성 시점에 최적 지점(_break_index)에서 \n을 박아 2줄로 — 편집창에 엔터로 보이고
        # 유저가 직접 조정 가능. 자유위치 드래그 땐 자동 줄바꿈이 위치를 흔들지 않는다.
        bi = _break_index(clean)
        if bi is not None:
            toks = clean.split()
            clean = " ".join(toks[:bi]) + "\n" + " ".join(toks[bi:])
        # words 텍스트를 대본 원문 어절로 정렬(타이밍만 유지) — 웹 미리보기/애니에 발음 표기 노출 방지.
        aligned = _align_words_to_text(clean, cw)
        lines.append(CaptionLine(text=clean, start=round(s, 2),
                                 end=round(e, 2), style=style, words=aligned or None))


def _lines_by_segments(segs: list, timestamps: list, style, ideal_chars: int,
                       min_chars: int, max_chars: int, max_dur: float,
                       total_dur: float | None = None) -> list:
    """스크립트 의미단위(segs)를 1차 경계로, TTS 단어를 글자수 기준으로 순서대로 배정.
    자막 텍스트는 **스크립트 원문 그대로**(verbatim), 타이밍만 TTS 단어에서.
    단어가 대본보다 먼저 소진돼도 남은 의미단위를 남은 시간(오디오 끝/읽기속도 추정)에 비례
    배분해 방출한다 — 자막이 대본보다 짧아지지 않도록(드롭 방지)."""
    lens = [_vis_len(s) for s in segs]
    W = len(timestamps)
    lines: list[CaptionLine] = []
    if not W:
        return lines
    if total_dur:
        audio_end = float(total_dur)
    else:
        audio_end = float(timestamps[-1].get("offset", 0.0)) + float(timestamps[-1].get("duration", 0.0))
    last_end = float(timestamps[0].get("offset", 0.0))
    wi = 0
    si = 0
    while si < len(segs):
        last = si == len(segs) - 1
        grp: list = []
        acc = 0
        target = lens[si]
        while wi < W:
            t = timestamps[wi]
            grp.append(t)
            acc += _vis_len(t.get("text", ""))
            wi += 1
            if not last and acc >= target:
                break
        if last:                       # 마지막 세그먼트가 남은 단어 전부 흡수
            while wi < W:
                grp.append(timestamps[wi]); wi += 1
        if grp:
            t0 = float(grp[0].get("offset", 0.0))
            t1 = float(grp[-1].get("offset", 0.0)) + float(grp[-1].get("duration", 0.0))
            _emit_seg(lines, segs[si], t0, t1, _wmeta(grp), style, max_chars)
            last_end = t1
            si += 1
        else:
            # TTS 단어 소진 → 남은 세그먼트를 [last_end, end]에 글자수 비례 배분(드롭 방지).
            # 오디오에 여유가 없으면(TTS가 대본 다 못 읽음) 읽기속도(≈0.15s/자)로 추정 구간 생성.
            rem = segs[si:]
            rem_chars = sum(_vis_len(s) for s in rem) or 1
            end = max(audio_end, last_end + rem_chars * 0.15 + 0.5)
            span = end - last_end
            cum = 0
            for rs in rem:
                cs = last_end + (cum / rem_chars) * span
                cum += _vis_len(rs)
                ce = last_end + (cum / rem_chars) * span
                _emit_seg(lines, rs, cs, ce, [], style, max_chars)
            break
    return lines


def _merge_widows(lines: list, min_chars: int, max_chars: int, max_dur: float) -> list:
    """너무 짧은 꼬리줄을 앞줄에 병합(상한 이내, 문장 안 넘을 때). 휴리스틱 경로 전용."""
    merged: list[CaptionLine] = []
    for ln in lines:
        if merged:
            prev = merged[-1]
            too_short = _vis_len(ln.text) < min_chars or (ln.end - ln.start) < 0.7
            fits = (_vis_len(prev.text) + _vis_len(ln.text) <= max_chars
                    and ln.end - prev.start <= max_dur + 0.6)
            prev_sent = bool(prev.text) and prev.text[-1] in _SENT_END
            if too_short and fits and not prev_sent:
                prev.text = _clean_caption_text(prev.text + " " + ln.text)
                prev.end = ln.end
                if prev.words or ln.words:
                    prev.words = (prev.words or []) + (ln.words or [])
                continue
        merged.append(ln)
    return merged


def build_lines_from_tts(
    timestamps: list,
    default_style: CaptionStyle,
    max_chars: int = 10,
    max_dur: float = 2.2,
    total_dur: float | None = None,
    full_text: str | None = None,
    ideal_chars: int = 8,
    min_chars: int = 6,
) -> list:
    """TTS 타임스탬프 → CaptionLine 리스트.

    경계 우선순위:
      1) 스크립트 의미단위 — 대본 생성이 ENTER(줄바꿈)로 문장/구를 구분한다. 이걸 1차 자막 경계로.
         full_text에 의미단위가 2개↑면 각 세그먼트에 TTS 단어를 글자수 기준으로 배정.
      2) 폴백(줄바꿈 정보 없음): 발화 쉼(단어 간 침묵)·연결어미·문장부호·글자/시간 상한으로 분할.
    timestamps 없으면 total_dur+full_text로 글자수 균등분할.
    """
    if not timestamps:
        return _lines_uniform(full_text or "", total_dur or 0.0, default_style,
                              max_chars=max_chars, max_dur=max_dur)

    segs = _meaning_segments(full_text)
    if len(segs) >= 2:
        lines = _lines_by_segments(segs, timestamps, default_style,
                                   ideal_chars, min_chars, max_chars, max_dur, total_dur=total_dur)
    else:
        lines = _group_words(timestamps, default_style, ideal_chars, min_chars, max_chars, max_dur)
        lines = _merge_widows(lines, min_chars, max_chars, max_dur)

    # 자막은 다음 줄 시작 전까지 보이게(틈 메움) — 끊김 방지
    for i in range(len(lines) - 1):
        if lines[i].end < lines[i + 1].start:
            lines[i].end = lines[i + 1].start
    return lines


def _lines_uniform(text: str, total: float, style: CaptionStyle,
                   max_chars: int = 10, max_dur: float = 2.6) -> list:
    """타임스탬프 없을 때: 한국어 어절기반 6~10자 분할 후 글자수 비례로 시간 배분."""
    text = (text or "").strip()
    if not text or total <= 0:
        return []
    chunks = split_korean_lines(text, ideal=8, max_chars=max_chars, min_chars=6)
    if not chunks:
        return []
    total_chars = sum(_vis_len(c) for c in chunks) or 1
    lines: list[CaptionLine] = []
    t = 0.0
    for c in chunks:
        share = _vis_len(c) / total_chars
        dur = min(max_dur, max(0.7, total * share))
        bi = _break_index(c)   # 폭 초과면 \n으로 2줄(렌더/프리뷰 일관)
        if bi is not None:
            toks = c.split()
            c = " ".join(toks[:bi]) + "\n" + " ".join(toks[bi:])
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


def _ass_c(color: str) -> str:
    """#RRGGBB → ASS 색 오버라이드 토큰 &HBBGGRR& (alpha 별도, \\1c·\\3c 용)."""
    h = (color or "FFFFFF").lstrip("#").upper()
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        h = "FFFFFF"
    return f"&H{h[4:6]}{h[2:4]}{h[0:2]}&"


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
        getattr(st, "shadow_color", "000000"),
        getattr(st, "shadow_blur", 0),
        getattr(st, "glow", False),
        getattr(st, "glow_color", "FFE600"),
        getattr(st, "glow_size", 0),
        getattr(st, "bold", True),
        getattr(st, "italic", False),
        getattr(st, "box", False),
        getattr(st, "box_color", "000000"),
        round(float(getattr(st, "box_opacity", 0.5)), 3),
        getattr(st, "box_pad", 6),
        getattr(st, "pos_v", "bottom"),
        getattr(st, "pos_x", None),
        getattr(st, "pos_y", None),
        getattr(st, "emphasis", True),
        getattr(st, "emphasis_color", "FFE600"),
        getattr(st, "animate", False),
        getattr(st, "anim", "none"),
    )


def _style_row(name: str, st, margin_v: int) -> str:
    """CaptionStyle → ASS [V4+ Styles] Style 행 1개."""
    primary = _hex_to_ass(getattr(st, "primary_color", "FFFFFF"))
    outline_c = _hex_to_ass(getattr(st, "outline_color", "000000"))
    box = getattr(st, "box", False)
    box_color = getattr(st, "box_color", "000000")
    box_alpha = int(round((1 - float(getattr(st, "box_opacity", 0.5))) * 255))
    # 박스면 BackColour=박스배경색. 비박스면 BackColour=그림자색(불투명) → 하드 드롭섀도 색 반영.
    if box:
        back = _hex_to_ass(box_color, box_alpha)
    else:
        back = _hex_to_ass(getattr(st, "shadow_color", "000000"), 0)
    border_style = 3 if box else 1
    bold = -1 if getattr(st, "bold", True) else 0
    italic = -1 if getattr(st, "italic", False) else 0
    # BorderStyle=3(박스)일 때 Outline 필드 = 박스 여백(px). 일반(=1)이면 글자 외곽선 두께.
    if box:
        outline_w = getattr(st, "box_pad", 6)
    else:
        outline_w = getattr(st, "outline_width", 3) if getattr(st, "outline", True) else 0
    shadow = getattr(st, "shadow", 2)
    font = getattr(st, "font", "Pretendard")
    size = getattr(st, "size", 64)
    # 세로 위치 → ASS Alignment(8=상단중앙,5=중앙,2=하단중앙) + 그에 맞는 MarginV.
    pos_v = getattr(st, "pos_v", "bottom")
    if pos_v == "top":
        align, mv = 8, 210
    elif pos_v == "middle":
        align, mv = 5, 0
    else:
        align, mv = 2, margin_v
    return (
        f"Style: {name},{font},{size},{primary},{primary},{outline_c},{back},"
        f"{bold},{italic},0,0,100,100,0,0,{border_style},{outline_w},{shadow},{align},60,60,{mv},1"
    )


def _entrance_tags(st, video_w: int, video_h: int, margin_v: int) -> tuple:
    """줄 등장 효과(anim) → (event_tag, inline_tag).

    event_tag: 라인 맨 앞 1회 — \\fad/\\move는 이벤트 단위라 {\\r}에 안 지워짐.
    inline_tag: 팝의 스케일 \\t — {\\r} 뒤마다 재적용 필요(강조 wrap이 리셋하므로).
    rise는 \\an+\\move로 위치까지 지정 → 호출부에서 \\pos 태그 대신 사용.
    타이밍은 웹 프리뷰 keyframes(globals.css)와 일치: fade 180ms / pop 210ms / rise 180ms.
    """
    anim = getattr(st, "anim", "none") or "none"
    if anim == "fade":
        return "\\fad(180,0)", ""
    if anim == "pop":
        return ("\\fad(70,0)",
                "\\fscx70\\fscy70\\t(0,110,\\fscx107\\fscy107)\\t(110,210,\\fscx100\\fscy100)")
    if anim == "rise":
        px, py = getattr(st, "pos_x", None), getattr(st, "pos_y", None)
        if px is not None and py is not None:
            an = 5
            x, y = int(round(float(px) * video_w)), int(round(float(py) * video_h))
        else:
            # _style_row의 Alignment/MarginV와 동일 앵커 좌표 재계산
            pos_v = getattr(st, "pos_v", "bottom")
            x = video_w // 2
            if pos_v == "top":
                an, y = 8, 210
            elif pos_v == "middle":
                an, y = 5, video_h // 2
            else:
                an, y = 2, video_h - margin_v
        return f"\\an{an}\\move({x},{y + 42},{x},{y},0,180)\\fad(150,0)", ""
    return "", ""


def render_ass(lines: list, out_ass: Path, video_w: int, video_h: int,
               margin_v: int = 346) -> Path:  # 1920 기준 18% — 쇼츠 하단 UI 위, 프리뷰 bottom-[18%]와 일치
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
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    dialog = []
    for i, ln in enumerate(lines):
        st = getattr(ln, "style", None) or CaptionStyle()
        raw = ln.text or ""
        # 줄바꿈은 '텍스트의 \n'만 존중(자동 폭맞춤 재분할 없음 — 생성 시점에 \n을 박아둠).
        # WrapStyle:2라 명시한 \n(→\N)만 개행. raw_lines가 여러 줄이면 줄별로 강조 적용.
        text = raw.replace("\n", "\\N")
        raw_lines = raw.split("\n")
        # 애니(워드) 경로용 \n 분할 어절 인덱스 — 윗줄 어절 수(2줄 이상이면 첫 경계만 반영).
        nl_brk = len(raw_lines[0].split()) if len(raw_lines) > 1 else None
        sname = line_style_name[i] if i < len(line_style_name) else "S0"
        start, end = _ass_time(ln.start), _ass_time(ln.end)
        # 자유위치(pos_x/pos_y)면 중심 앵커 절대배치 — 모든 레이어(글로우/섀도/메인)에 prepend.
        px, py = getattr(st, "pos_x", None), getattr(st, "pos_y", None)
        pp = f"{{\\an5\\pos({int(round(float(px)*video_w))},{int(round(float(py)*video_h))})}}" if (px is not None and py is not None) else ""
        # 등장 효과(anim) — 이벤트 태그(fad/move) + 인라인 태그(팝 \t). 모든 레이어 동일 적용.
        ev_tag, inline = _entrance_tags(st, video_w, video_h, margin_v)
        word_anim = bool(getattr(st, "animate", False) and getattr(ln, "words", None))
        if word_anim:
            inline = ""   # 단어별 팝과 라인 팝 \t가 fscx에서 충돌 → 워드 애니 땐 fad/move만
        if "\\move" in ev_tag:
            pp = ""       # rise의 \an+\move가 위치 지정을 대체(자유위치 포함)
        intro = f"{{{ev_tag}}}" if ev_tag else ""
        # 글로우/소프트섀도는 '메인 텍스트 뒤'(낮은 Layer)에 별도 블러 이벤트로 깐다.
        # → 메인 텍스트 글리프 자체는 선명 유지(웹 편집기와 동일한 룩).
        if getattr(st, "glow", False) and int(getattr(st, "glow_size", 0)) > 0:
            g = int(st.glow_size)
            # 채움 투명(\1a&HFF&) + 두꺼운 외곽선(글로우색) + 블러 → 빛번짐 후광.
            gtag = (f"{{\\1a&HFF&\\3a&H00&\\4a&HFF&\\3c{_ass_c(st.glow_color)}"
                    f"\\bord{g}\\shad0\\blur{max(g, 2)}{inline}}}")
            dialog.append(f"Dialogue: 0,{start},{end},{sname},,0,0,0,,{pp}{intro}{gtag}{text}")
        if int(getattr(st, "shadow", 0)) and int(getattr(st, "shadow_blur", 0)) > 0:
            sb = int(st.shadow_blur)
            # 외곽선/그림자 끄고 채움=그림자색 + 블러 → 부드러운 색 그림자 후광(근사).
            stag = (f"{{\\bord0\\shad0\\3a&HFF&\\4a&HFF&"
                    f"\\1c{_ass_c(st.shadow_color)}\\blur{sb}{inline}}}")
            dialog.append(f"Dialogue: 0,{start},{end},{sname},,0,0,0,,{pp}{intro}{stag}{text}")
        # 메인 텍스트(최상단 Layer 1) — Style 행이 색/외곽선/박스/하드 드롭섀도 처리.
        # animate=on이고 단어 타임스탬프 있으면 워드바이워드 애니, 아니면 정적 색팝 강조.
        if word_anim:
            main_text = _ass_animated(ln, st, intro_fad=not ev_tag, brk=nl_brk)
        else:
            emph = getattr(ln, "emph", None)
            if len(raw_lines) > 1:
                # 여러 줄(\n): 줄마다 강조 적용, 강조 인덱스는 어절 누적으로 줄별 시프트
                parts = []
                cum = 0
                for rl in raw_lines:
                    n = len(rl.split())
                    e = [x - cum for x in emph if cum <= x < cum + n] if emph is not None else None
                    parts.append(_ass_emphasis(rl, st, e, inline=inline))
                    cum += n
                main_text = "\\N".join(parts)
            else:
                main_text = _ass_emphasis(text, st, emph, inline=inline)
            if inline:
                main_text = f"{{{inline}}}" + main_text
        dialog.append(f"Dialogue: 1,{start},{end},{sname},,0,0,0,,{pp}{intro}{main_text}")
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
