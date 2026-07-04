"""[6] 최종 합성 — ffmpeg로 영상+더빙+자막+CTA를 9:16 쇼츠로 머지."""
import subprocess
from pathlib import Path

from app.config import FFMPEG, TARGET_W, TARGET_H, DEFAULT_FONT
from app.media_util import probe_duration


def _ff_path(p: str) -> str:
    """ffmpeg 필터 인자용 경로 이스케이프 (윈도우 콜론 문제)."""
    return p.replace("\\", "/").replace(":", "\\:")


def _probe_duration(path: Path) -> float:
    """미디어 길이(초). 실패 시 예외 전파(기존 check=True 동작)."""
    return probe_duration(path)


def _escape_drawtext(s: str) -> str:
    """ffmpeg drawtext용 이스케이프."""
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’")


def apply_overlays(video_path: Path, out_path: Path, overlays: list) -> Path:
    """이미 합성된 9:16 영상 위에 오버레이(말풍선 PNG·알파 MOV 스티커/트랜지션) 얹기.

    overlays 각 항목:
      file(절대경로), type("image"|"video"), x/y(0~1 중심 좌표), scale(0~1, TARGET_W 대비 폭),
      start/end(초, end 없으면 끝까지 또는 클립길이), fullscreen(bool, 화면 꽉 채움=트랜지션).
    알파(RGBA/ProRes yuva)는 overlay 필터가 자동 반영. 오디오는 원본 유지.
    """
    video_path, out_path = Path(video_path), Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ov = [o for o in (overlays or []) if o.get("file") and Path(o["file"]).exists()]
    if not ov:
        # 오버레이 없으면 원본 그대로 복사 대신 그대로 반환(호출측이 스킵하게)
        return video_path

    cmd = [FFMPEG, "-y", "-i", str(video_path)]
    for o in ov:
        cmd += ["-i", str(o["file"])]

    parts = []
    last = "[0:v]"
    for i, o in enumerate(ov, start=1):
        start = float(o.get("start", 0.0))
        end = o.get("end")
        scale = float(o.get("scale", 0.5))
        pre = f"[{i}:v]"
        if o.get("fullscreen"):
            sc = (f"scale={TARGET_W}:{TARGET_H}:force_original_aspect_ratio=increase,"
                  f"crop={TARGET_W}:{TARGET_H}")
        else:
            sc = f"scale={int(scale * TARGET_W)}:-1"
        chain = f"{pre}{sc}"
        if o.get("type") == "video":
            # 클립을 start 시점에 배치(부족분은 그 이후 사라짐). 알파 포맷 보존.
            chain += f",format=yuva444p,setpts=PTS-STARTPTS+{start}/TB"
        chain += f"[o{i}]"
        parts.append(chain)
        # 중심 앵커 배치
        x = f"(main_w*{o.get('x', 0.5)})-(overlay_w/2)"
        y = f"(main_h*{o.get('y', 0.5)})-(overlay_h/2)"
        en = ""
        if end is not None:
            en = f":enable='between(t,{start},{float(end)})'"
        elif o.get("type") == "image":
            en = f":enable='gte(t,{start})'"
        nl = f"[v{i}]"
        parts.append(f"{last}[o{i}]overlay={x}:{y}{en}{nl}")
        last = nl

    cmd += ["-filter_complex", ";".join(parts), "-map", last, "-map", "0:a?",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "copy", "-pix_fmt", "yuv420p", str(out_path)]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg overlay 실패 (code {r.returncode}):\n{r.stderr[-1200:]}")
    return out_path


def compose(
    video_path: Path,
    audio_path: Path | None,
    out_path: Path,
    cta_text: str | None = None,
    replace_audio: bool = True,
    cta_size: int = 56,
    cta_pos: float = 0.88,
) -> Path:
    """영상 + (선택)더빙오디오 + (선택)CTA자막 → 9:16 mp4.

    replace_audio=True: 원본 음성을 더빙으로 교체.
    cta_text: CTA 문구. cta_size: 글자 크기(px). cta_pos: 세로 위치(0=맨위~1=맨아래).
    """
    video_path, out_path = Path(video_path), Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # 9:16 변환: 가운데 크롭 후 스케일. 비율 안 맞으면 패딩.
    vf = (
        f"scale={TARGET_W}:{TARGET_H}:force_original_aspect_ratio=increase,"
        f"crop={TARGET_W}:{TARGET_H}"
    )
    if cta_text:
        txt = _escape_drawtext(cta_text)
        font = _ff_path(DEFAULT_FONT)
        sz = max(12, int(cta_size))
        bw = max(2, sz // 14)
        # cta_pos: 0=맨위~1=맨아래. 글자높이 고려해 화면 안에 들어오게 클램프.
        pos = min(0.98, max(0.02, float(cta_pos)))
        vf += (
            f",drawtext=fontfile='{font}':text='{txt}':fontcolor=white:fontsize={sz}:"
            f"borderw={bw}:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)*{pos}"
        )

    # 더빙(내레이션)으로 교체할 땐 최종 길이 = 더빙(TTS) 길이가 기준.
    # 영상이 더빙보다 짧으면 -stream_loop로 반복해 채우고, 길면 -shortest가 더빙 끝에서 자른다.
    # → 내레이션이 절대 잘리지 않고, 영상은 딱 내레이션 길이만큼.
    loop_video = bool(audio_path and replace_audio)
    cmd = [FFMPEG, "-y"]
    if loop_video:
        cmd += ["-stream_loop", "-1"]
    cmd += ["-i", str(video_path)]
    if audio_path:
        cmd += ["-i", str(audio_path)]

    cmd += ["-vf", vf]

    if audio_path and replace_audio:
        # 더빙 오디오로 교체 + 영상은 더빙(TTS) 길이에 맞춤(-shortest는 무한 루프 영상 대신 더빙서 종료)
        cmd += ["-map", "0:v:0", "-map", "1:a:0", "-shortest"]
    elif audio_path and not replace_audio:
        cmd += ["-map", "0:v:0", "-map", "1:a:0"]

    if audio_path:
        # 라우드니스 정규화(EBU R128, 모바일/숏츠 타깃 -16 LUFS) + 깨끗한 리샘플(48kHz).
        # 성우·클립 간 볼륨 편차 제거해 '프로 광고' 마감. 그다음 샘플레이트 불일치/지직 방지.
        cmd += ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=async=1:first_pts=0:osr=48000"]

    cmd += [
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-pix_fmt", "yuv420p",
        str(out_path),
    ]

    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg compose 실패 (code {r.returncode}):\n{r.stderr[-1500:]}")
    return out_path
