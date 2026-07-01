"""다운로드 영상 라이브러리 — URL로 중복 다운로드 방지(재사용) + 메타데이터/썸네일 관리.

download_dir(설정 가능) 아래에 URL 해시별 폴더로 원본 mp4 + meta.json + thumb.jpg 보관.
같은 URL 재분석 시 다운로드를 건너뛰고 보관본을 재사용한다(하드링크, 실패 시 복사).
썸네일은 ffmpeg로 첫 프레임을 뽑아 만든다(플랫폼 무관 — 도우인도 됨).
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

from app.config import FFMPEG
from app import settings as _settings
from app.url_extract import extract_url


def download_dir() -> Path:
    p = Path(_settings.get_download_dir())
    p.mkdir(parents=True, exist_ok=True)
    return p


def _key(url: str) -> str:
    norm = (extract_url(url) or url or "").strip().rstrip("/").lower()
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()[:16]


def entry_dir(url: str) -> Path:
    return download_dir() / _key(url)


def _link_or_copy(src: Path, dst: Path) -> None:
    """같은 볼륨이면 하드링크(디스크 절약), 아니면 복사."""
    src, dst = Path(src), Path(dst)
    if src.resolve() == dst.resolve():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        if dst.exists():
            dst.unlink()
        os.link(src, dst)
    except Exception:
        shutil.copy2(src, dst)


def _make_thumb(src: Path, dst: Path) -> bool:
    """영상 첫 부분(1s) 프레임 1장 → 썸네일 jpg(가로 360)."""
    try:
        subprocess.run(
            [FFMPEG, "-hide_banner", "-y", "-ss", "1", "-i", str(src),
             "-frames:v", "1", "-vf", "scale=360:-2", str(dst)],
            capture_output=True, text=True, timeout=60)
    except Exception:
        pass
    return Path(dst).exists()


def find(url: str) -> dict | None:
    """URL의 보관본 메타 반환(원본 파일 있을 때만). 없으면 None."""
    d = entry_dir(url)
    src = d / "source.mp4"
    if not src.exists():
        return None
    meta = {}
    try:
        meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    except Exception:
        pass
    meta["key"] = _key(url)
    meta["source"] = str(src)
    meta["has_thumb"] = (d / "thumb.jpg").exists()
    meta["stages"] = _stage_flags(d)
    return meta


def register(url: str, src: Path, title: str | None = None, duration=None,
             width=None, height=None, platform: str = "") -> dict:
    """새로 받은 원본을 라이브러리에 등록(보관본 링크 + 썸네일 + meta.json)."""
    d = entry_dir(url)
    d.mkdir(parents=True, exist_ok=True)
    lib_src = d / "source.mp4"
    _link_or_copy(Path(src), lib_src)
    _make_thumb(lib_src, d / "thumb.jpg")
    meta = {
        "url": extract_url(url) or url,
        "title": (title or "").strip(),
        "duration": duration,
        "width": width,
        "height": height,
        "platform": platform,
        "downloaded_at": time.time(),
        "size": lib_src.stat().st_size if lib_src.exists() else 0,
    }
    (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    meta["key"] = _key(url)
    return meta


def reuse_into(url: str, job_src: Path) -> bool:
    """보관본을 job 폴더의 source.mp4로 링크/복사. 성공 시 True(다운로드 생략)."""
    ent = find(url)
    if not ent:
        return False
    try:
        _link_or_copy(Path(ent["source"]), Path(job_src))
        return True
    except Exception:
        return False


# ---- 단계별 캐시(자막제거본·대본) — 같은 URL 재분석 시 해당 단계부터 재사용 ----

def _stage_flags(d: Path) -> dict:
    return {
        "source": (d / "source.mp4").exists(),
        "nosub": (d / "nosub.mp4").exists(),
        "script": (d / "script.json").exists(),
    }


def stages(url: str) -> dict:
    """URL의 캐시된 단계: {source, nosub, script} 존재 여부."""
    return _stage_flags(entry_dir(url))


def nosub_path(url: str) -> Path | None:
    p = entry_dir(url) / "nosub.mp4"
    return p if p.exists() else None


def save_nosub(url: str, src: Path) -> None:
    """자막제거본(nosub.mp4)을 라이브러리에 보관 → 다음부터 자막제거 단계 생략."""
    d = entry_dir(url)
    d.mkdir(parents=True, exist_ok=True)
    _link_or_copy(Path(src), d / "nosub.mp4")


def reuse_nosub_into(url: str, dst: Path) -> bool:
    """보관 자막제거본을 job 폴더로 링크/복사. 성공 시 True(자막탐지·인페인트 생략)."""
    p = nosub_path(url)
    if not p:
        return False
    try:
        _link_or_copy(p, Path(dst))
        return True
    except Exception:
        return False


def get_script(url: str) -> dict | None:
    """보관된 대본(script.json) 반환. 없으면 None."""
    p = entry_dir(url) / "script.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def save_script(url: str, data: dict) -> None:
    """대본(STT/번역 결과)을 라이브러리에 보관 → 다음부터 STT 단계 생략."""
    d = entry_dir(url)
    d.mkdir(parents=True, exist_ok=True)
    (d / "script.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def list_entries(limit: int = 60) -> list:
    """보관 영상 목록(최근순). 썸네일/제목/길이 등."""
    dd = download_dir()
    out = []
    for d in (dd.iterdir() if dd.exists() else []):
        if not d.is_dir() or not (d / "source.mp4").exists():
            continue
        meta = {}
        try:
            meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
        except Exception:
            pass
        out.append({
            "key": d.name,
            "url": meta.get("url", ""),
            "title": meta.get("title", ""),
            "duration": meta.get("duration"),
            "platform": meta.get("platform", ""),
            "downloaded_at": meta.get("downloaded_at", 0),
            "size": meta.get("size", 0),
            "has_thumb": (d / "thumb.jpg").exists(),
            "stages": _stage_flags(d),
        })
    out.sort(key=lambda x: x.get("downloaded_at", 0), reverse=True)
    return out[:limit]


def thumb_path(key: str) -> Path | None:
    p = download_dir() / key / "thumb.jpg"
    return p if p.exists() else None


def delete(key: str) -> bool:
    """보관 항목 삭제(라이브러리 폴더 내부만)."""
    dd = download_dir()
    d = (dd / key).resolve()
    if d.parent == dd.resolve() and d.exists():
        shutil.rmtree(d, ignore_errors=True)
        return True
    return False
