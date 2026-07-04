"""프로젝트 저장/불러오기 — 편집 상태(대본·보이스·자막·CTA·오버레이 등)를 통째로 영속화.

다운로드 라이브러리(url 캐시)와 별개. 사용자가 '저장'하면 편집 전체가 projects/{id}.json 에 남고,
홈에서 목록·불러오기. CapCut식 타임라인 편집의 데이터 토대이기도 하다.

state 스키마(프론트가 채움, 백엔드는 통째 보관):
  { name, source_url, script, voice{voice_id,emotion,emotion_intensity,rate},
    captionStyle, captionLines[], caption_on, cta{on,text,size,pos},
    overlays[], target_sec }
"""
import json
import time
import uuid
from pathlib import Path

from app.config import BACKEND_ROOT

PROJECTS_DIR = BACKEND_ROOT / "projects"
_HEX = __import__("re").compile(r"^[0-9a-f]{8,32}$")


def _path(pid: str) -> Path:
    return PROJECTS_DIR / f"{pid}.json"


def save(state: dict, pid: str | None = None) -> dict:
    """프로젝트 저장(신규=id 생성, 기존=덮어씀). 저장된 메타 반환."""
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    now = time.time()
    if pid and _HEX.match(pid) and _path(pid).exists():
        try:
            prev = json.loads(_path(pid).read_text(encoding="utf-8"))
        except Exception:
            prev = {}
        created = prev.get("created", now)
    else:
        pid = uuid.uuid4().hex[:12]
        created = now
    doc = {
        "id": pid,
        "name": (state.get("name") or "제목 없는 프로젝트")[:80],
        "created": created,
        "updated": now,
        "state": state,
    }
    _path(pid).write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    return {"id": pid, "name": doc["name"], "created": created, "updated": now}


def get(pid: str) -> dict | None:
    if not (pid and _HEX.match(pid) and _path(pid).exists()):
        return None
    try:
        return json.loads(_path(pid).read_text(encoding="utf-8"))
    except Exception:
        return None


def list_all(limit: int = 100) -> list:
    """저장된 프로젝트 메타 목록(최근 수정 순). state는 제외(가벼움)."""
    if not PROJECTS_DIR.exists():
        return []
    out = []
    for f in PROJECTS_DIR.glob("*.json"):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            st = d.get("state") or {}
            out.append({
                "id": d.get("id", f.stem),
                "name": d.get("name", ""),
                "created": d.get("created", 0),
                "updated": d.get("updated", 0),
                "source_url": st.get("source_url", ""),
                "n_captions": len(st.get("captionLines") or []),
                "n_overlays": len(st.get("overlays") or []),
            })
        except Exception:
            continue
    out.sort(key=lambda x: x.get("updated", 0), reverse=True)
    return out[:limit]


def delete(pid: str) -> bool:
    p = _path(pid)
    if pid and _HEX.match(pid) and p.exists():
        p.unlink()
        return True
    return False
