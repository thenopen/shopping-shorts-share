"""Premiere Pro .mogrt 부분 임포터(베타) — 정적 텍스트 스타일만 추출.

.mogrt = ZIP(definition.json + project.aegraphic + thumb.png).
AE 제작 mogrt는 실제 스타일이 바이너리 .aep에 잠겨 있어 전체 추출은 불가.
뽑는 것(신뢰 가능): definition.json의 게시된 텍스트 컨트롤(폰트명·크기·bold/italic·샘플텍스트),
comp 크기(framesize → 1080 기준 스케일), 썸네일. 색은 definition에 없어 썸네일에서 추정(휴리스틱).
애니메이션·벡터 셰이프는 미지원 — 프론트에 '정적 스타일만' 경고로 안내.
"""
import io
import json
import zipfile

# mogrt 폰트명(포스트스크립트) → 우리 웹 폰트 CSS명 매핑. 못 찾으면 Pretendard.
_FONT_MAP = [
    ("appleSDgothic", "Pretendard"), ("applesdgothicneo", "Pretendard"),
    ("nanumgothic", "NanumGothic"), ("nanumsquare", "NanumSquareNeo"),
    ("gmarket", "GmarketSansBold"), ("blackhansans", "BlackHanSans"),
    ("jalnan", "Jalnan"), ("bmdohyeon", "BMDOHYEON"), ("dohyeon", "BMDOHYEON"),
    ("gasoek", "GasoekOne"), ("tmon", "TmonMonsori"), ("cafe24", "Cafe24Ssurround"),
    ("helvetica", "Pretendard"), ("arial", "Pretendard"), ("roboto", "Pretendard"),
    ("noto", "Pretendard"), ("malgun", "Pretendard"), ("pretendard", "Pretendard"),
]


def _map_font(ps_name: str) -> str:
    n = (ps_name or "").lower()
    for key, css in _FONT_MAP:
        if key in n:
            return css
    return "Pretendard"


def _loc_str(node) -> str:
    """{strDB:[{localeString,str}]} → 첫 문자열."""
    try:
        db = (node or {}).get("strDB") or []
        return db[0].get("str", "") if db else ""
    except Exception:
        return ""


def _thumb_colors(png_bytes: bytes) -> dict:
    """썸네일에서 박스색/글자색 추정(휴리스틱).

    배경(가장자리 다수색=대개 검정/투명) 제외 → 최빈색 = 박스/도형색.
    박스색 픽셀 이웃의 대비색(면적 2위) = 글자색 후보.
    실패해도 안전(None) — 색은 어차피 '추정'으로 안내.
    """
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
        img.thumbnail((200, 200))
        px = list(img.getdata())
        # 가장자리 색(배경) 수집
        w, h = img.size
        edge = set()
        for x in range(0, w, 4):
            for y in (0, h - 1):
                r, g, b, a = img.getpixel((x, y))
                edge.add((r // 32, g // 32, b // 32))
        from collections import Counter
        cnt = Counter()
        for r, g, b, a in px:
            if a < 40:
                continue
            key = (r // 32, g // 32, b // 32)
            if key in edge:
                continue
            cnt[(r, g, b)] += 0  # 정확색은 아래 재집계
            cnt[key] += 1
        if not cnt:
            return {}
        # 최빈 양자화색들 → 실제 평균색. 1위=박스/도형색, 글자색=박스와 명도 대비 최대인 색.
        tops = [k for k, _ in cnt.most_common(6) if isinstance(k, tuple) and len(k) == 3][:5]
        outs = []
        for tk in tops:
            rs = gs = bs = n = 0
            for r, g, b, a in px:
                if a >= 40 and (r // 32, g // 32, b // 32) == tk:
                    rs += r; gs += g; bs += b; n += 1
            if n:
                outs.append((rs // n, gs // n, bs // n))
        if not outs:
            return {}

        def lum(c):
            return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]

        box = outs[0]
        # 글자색: 박스와 명도차 120+ 중 최대 대비(80대는 그림자/가장자리 오탐).
        # 없으면 관행대로 밝은 박스=검정, 진한 박스=흰색(iMessage 초록=흰 글자).
        cands = [c for c in outs[1:] if abs(lum(c) - lum(box)) >= 120]
        if cands:
            text = max(cands, key=lambda c: abs(lum(c) - lum(box)))
        else:
            text = (17, 17, 17) if lum(box) >= 160 else (255, 255, 255)
        return {"box": "#%02x%02x%02x" % box, "text": "#%02x%02x%02x" % text}
    except Exception:
        return {}


def parse_mogrt(data: bytes) -> dict:
    """mogrt 바이트 → {name, styles:[웹 CaptionStyle dict], thumb_b64, warnings}."""
    import base64
    z = zipfile.ZipFile(io.BytesIO(data))
    d = json.loads(z.read("definition.json").decode("utf-8"))
    name = d.get("capsuleName") or _loc_str(d.get("capsuleNameLocalized")) or "mogrt 템플릿"
    warnings = ["mogrt 부분 임포트(베타): 폰트·크기 등 정적 스타일만 가져와요. "
                "애니메이션·도형·색상 세부는 프리미어 전용이라 반영되지 않아요(색은 썸네일 추정)."]
    if d.get("authorApp") == "aefx":
        warnings.append("After Effects 제작 템플릿 — 실제 룩과 차이가 있을 수 있어요.")

    # comp 크기(framesize) → 1080 기준 스케일
    scale = 1.0
    try:
        si = next(iter((d.get("sourceInfoLocalized") or {}).values()))
        fs = si.get("framesize") or {}
        cw = float(fs.get("width") or fs.get("x") or 0)
        if cw > 0:
            scale = 1080.0 / cw
    except Exception:
        pass

    # 썸네일 색 추정
    thumb = None
    colors = {}
    try:
        thumb = z.read("thumb.png")
        colors = _thumb_colors(thumb)
    except Exception:
        pass

    styles = []
    for c in d.get("clientControls") or []:
        fe = c.get("fonteditinfo")
        if c.get("type") != 6 or not fe:
            continue   # 텍스트 컨트롤만
        size = float(fe.get("fontSizeEditValue") or 48) * scale
        # 자막 용도 하한 — mogrt comp 좌표계가 제각각이라 너무 작으면 읽기 좋은 42로 보정.
        size = size if size >= 42 else 42
        st = {
            "font": _map_font(fe.get("fontEditValue", "")),
            "size": int(round(min(120, size))),
            "bold": bool(fe.get("fontFSBoldValue")),
            "italic": bool(fe.get("fontFSItalicValue")),
            "sample": _loc_str(c.get("value")),
            "label": _loc_str(c.get("uiName")) or "Text",
            "srcFont": fe.get("fontEditValue", ""),
        }
        # 썸네일 색 추정 반영 — 박스+글자색(밝은 박스=어두운 글자 가정 없이 추정값 그대로)
        if colors.get("box"):
            st["box"] = True
            st["boxColor"] = colors["box"]
            if colors.get("text"):
                st["color"] = colors["text"]
        styles.append(st)

    out = {"name": name, "styles": styles, "warnings": warnings,
           "fonts": (d.get("usedFontsLocalized") or {}).get("ko_KR") or []}
    if thumb:
        out["thumb"] = "data:image/png;base64," + base64.b64encode(thumb).decode()
    return out
