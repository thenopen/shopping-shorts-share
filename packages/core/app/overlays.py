"""오버레이 에셋(말풍선·트랜지션·리액션) 조회 — assets/overlays/manifest.json 기반.

scripts/extract_overlays.py가 ae-sources zip에서 추출·생성. id로 파일 경로 해석(렌더 워커용).
"""
import json
from pathlib import Path

from app.config import BACKEND_ROOT

OVERLAY_DIR = BACKEND_ROOT / "assets" / "overlays"
_MANIFEST = OVERLAY_DIR / "manifest.json"


def load_manifest() -> dict:
    if not _MANIFEST.exists():
        return {"bubble": [], "transition": [], "reaction": []}
    try:
        return json.loads(_MANIFEST.read_text(encoding="utf-8"))
    except Exception:
        return {"bubble": [], "transition": [], "reaction": []}


def _index() -> dict:
    """id → item(dict). 카테고리 무관 조회."""
    out = {}
    for items in load_manifest().values():
        for it in items or []:
            if it.get("id"):
                out[it["id"]] = it
    return out


def resolve_file(oid: str) -> Path | None:
    """오버레이 id → 실제 에셋 절대경로(존재 시). traversal 가드는 app.security.safe_path 통일."""
    from app.security import safe_path
    it = _index().get(oid)
    if not it:
        return None
    fname = it.get("file") or ""
    # manifest 의 file 이름이 단일 세그먼트(파일명)라 가정하되, 혹시 슬래시가 섞여도 safe_path 가 방어.
    parts = [p for p in fname.split("/") if p]
    return safe_path(OVERLAY_DIR, *parts)


def resolve_type(oid: str) -> str:
    return (_index().get(oid) or {}).get("type", "image")
