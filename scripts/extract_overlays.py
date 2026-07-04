# -*- coding: utf-8 -*-
"""ae-sources/*.zip(직접 오버레이용) → packages/core/assets/overlays/ 로 추출 + manifest.
한글 파일명이 zip에 cp437로 깨져 있어 인덱스 ASCII명으로 재명명. 썸네일(PNG=축소, MOV=중간프레임) 생성.
"""
import json, subprocess, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "ae-sources"
DST = ROOT / "packages" / "core" / "assets" / "overlays"
FFMPEG = "ffmpeg"

# (zip파일, 카테고리, 확장자필터, 프리픽스)
JOBS = [
    ("말풍선_40.zip", "bubble", (".png",), "bubble"),
    ("Simple_트랜지션.zip", "transition", (".mov",), "transition"),
    ("ㅋㅋㅋ_리액션소스.zip", "reaction", (".mov",), "reaction"),
]


def _dur(src: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=nk=1:nw=1", str(src)], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except Exception:
        return 0.0


def thumb(src: Path, out: Path, is_video: bool):
    # 투명 PNG로 출력(알파 유지) — 픽커는 어두운 컨테이너에 얹혀 보이고, 프리뷰는 영상 위 회색박스 없이 표시.
    # 영상은 클립 중간(55%)을 output-seek(-ss를 -i 뒤에)로 정확히 — 손글씨 다 그려진 프레임(시작부는 빈 프레임).
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [FFMPEG, "-y", "-i", str(src)]
    if is_video:
        d = _dur(src)
        cmd += ["-ss", f"{max(0.4, d * 0.55):.2f}" if d > 0 else "1"]
    cmd += ["-vf", "scale=240:240:force_original_aspect_ratio=decrease,format=rgba",
            "-frames:v", "1", str(out)]
    subprocess.run(cmd, capture_output=True)


def main():
    manifest = {"bubble": [], "transition": [], "reaction": []}
    for zname, cat, exts, prefix in JOBS:
        zp = SRC / zname
        if not zp.exists():
            print("SKIP(없음):", zname); continue
        z = zipfile.ZipFile(zp)
        members = [i for i in z.infolist()
                   if not i.is_dir() and i.filename.lower().endswith(exts)]
        members.sort(key=lambda i: i.filename)
        outdir = DST / cat
        outdir.mkdir(parents=True, exist_ok=True)
        for idx, m in enumerate(members, 1):
            ext = Path(m.filename).suffix.lower()
            name = f"{prefix}_{idx:02d}{ext}"
            fp = outdir / name
            if not fp.exists():                 # 이미 있으면 재복사 스킵(썸네일만 갱신)
                fp.write_bytes(z.read(m.filename))
            tp = outdir / "thumb" / f"{prefix}_{idx:02d}.png"
            thumb(fp, tp, is_video=(ext == ".mov"))
            manifest[cat].append({"id": f"{cat}_{idx:02d}", "file": f"{cat}/{name}",
                                  "thumb": f"{cat}/thumb/{prefix}_{idx:02d}.png",
                                  "type": "video" if ext == ".mov" else "image"})
        print(f"{cat}: {len(members)}개 추출")
    (DST / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print("manifest:", DST / "manifest.json")


if __name__ == "__main__":
    main()
