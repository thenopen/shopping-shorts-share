# -*- coding: utf-8 -*-
"""폰트 일괄 임포트 — ttf/otf → web woff2 + core ttf + 내부 이름테이블 정규화.

소스 폴더의 폰트를 골라(or 전체) css명으로 이름 통일 후
  - packages/web/public/fonts/<css>.woff2   (웹 @font-face)
  - packages/core/assets/fonts/<css>.ttf     (ASS burn-in Fontname 매칭)
로 저장하고, globals.css @font-face / fonts.ts 항목을 자동 갱신한다.

ASS 자막은 Fontname 문자열로 폰트를 찾으므로 내부 name table(1,4,6,16)을
css명과 동일하게 바꿔야 libass가 매칭한다.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "packages" / "web" / "public" / "fonts"
CORE = ROOT / "packages" / "core" / "assets" / "fonts"
GLOBALS = ROOT / "packages" / "web" / "app" / "globals.css"
FONTS_TS = ROOT / "packages" / "web" / "app" / "fonts.ts"


def normalize_names(font: TTFont, css: str) -> None:
    nm = font["name"]
    for nid in (1, 4, 6, 16):
        nm.setName(css, nid, 3, 1, 0x409)
        nm.setName(css, nid, 1, 0, 0)
    nm.setName("Regular", 2, 3, 1, 0x409)
    nm.setName("Regular", 17, 3, 1, 0x409)


def convert(src: Path, css: str) -> bool:
    try:
        f = TTFont(str(src))
        normalize_names(f, css)
        CORE.mkdir(parents=True, exist_ok=True)
        WEB.mkdir(parents=True, exist_ok=True)
        f.save(str(CORE / (css + ".ttf")))
        f.flavor = "woff2"
        f.save(str(WEB / (css + ".woff2")))
        return True
    except Exception as e:  # noqa
        print(f"  x {src.name}: {str(e)[:100]}")
        return False


def family_name(p: Path) -> str | None:
    try:
        f = TTFont(str(p), fontNumber=0)
        nm = f["name"]
        for nid in (16, 1):
            rec = nm.getName(nid, 3, 1, 0x409) or nm.getName(nid, 1, 0, 0)
            if rec:
                return str(rec).strip()
    except Exception:
        return None
    return None


def update_globals(entries: list[tuple[str, str]]) -> int:
    css = GLOBALS.read_text(encoding="utf-8")
    added = 0
    block = []
    for slug, _label in entries:
        if f'font-family: "{slug}"' in css:
            continue
        block.append(
            f'@font-face {{ font-family: "{slug}"; '
            f'src: url("/fonts/{slug}.woff2") format("woff2"); font-display: swap; }}'
        )
        added += 1
    if not block:
        return 0
    # 마지막 @font-face 줄 뒤에 삽입
    lines = css.splitlines()
    last = max(i for i, ln in enumerate(lines) if ln.startswith("@font-face"))
    lines[last + 1:last + 1] = block
    GLOBALS.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return added


def update_fonts_ts(entries: list[tuple[str, str]]) -> int:
    ts = FONTS_TS.read_text(encoding="utf-8")
    added = 0
    rows = []
    for slug, label in entries:
        if f'css: "{slug}"' in ts:
            continue
        rows.append(f'  {{ label: "{label}", css: "{slug}" }},')
        added += 1
    if not rows:
        return 0
    idx = ts.rfind("];")
    ts = ts[:idx] + "\n".join(rows) + "\n" + ts[idx:]
    FONTS_TS.write_text(ts, encoding="utf-8")
    return added
