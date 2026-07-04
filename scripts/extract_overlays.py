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


def thumb(src: Path, out: Path, is_video: bool):
    # 알파 에셋(흰 말풍선 등)이 보이게 회색 배경에 합성.
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [FFMPEG, "-y", "-f", "lavfi", "-i", "color=c=0x2a2f3a:s=240x240"]
    if is_video:
        cmd += ["-ss", "1"]
    cmd += ["-i", str(src), "-filter_complex",
            "[1:v]scale=240:240:force_original_aspect_ratio=decrease[fg];"
            "[0:v][fg]overlay=(W-w)/2:(H-h)/2", "-frames:v", "1", str(out)]
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
