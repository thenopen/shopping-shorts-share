"""파이프라인 오케스트레이터. CLI MVP.

사용:
  python -m app.pipeline.run <video_url> --script "한국어 대본" [--cta "지금 구매"]
  python -m app.pipeline.run <video_url> --script-file script.txt
"""
import argparse
import uuid
from pathlib import Path

from app.config import WORKDIR, DEFAULT_VOICE
from app.pipeline.download import download_video
from app.pipeline.tts import synthesize
from app.pipeline.compose import compose


def run(url: str, script: str | None, cta: str | None = None,
        voice: str = DEFAULT_VOICE, rate: str = "+0%") -> Path:
    job_id = uuid.uuid4().hex[:8]
    job_dir = WORKDIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    print(f"[job {job_id}] start")

    # [1] 다운로드
    print("  [1/3] downloading...")
    src = download_video(url, job_id)
    print(f"        -> {src}")

    # [4] TTS (대본 있을 때만)
    dub = None
    if script:
        print("  [2/3] tts (edge-tts)...")
        dub = synthesize(script, job_dir / "dub.mp3", voice=voice, rate=rate)
        print(f"        -> {dub}")
    else:
        print("  [2/3] tts skipped (no script) — 원본 음성 유지")

    # [6] 합성
    print("  [3/3] composing 9:16...")
    out = compose(
        video_path=src,
        audio_path=dub,
        out_path=job_dir / "output.mp4",
        cta_text=cta,
        replace_audio=bool(dub),
    )
    print(f"[job {job_id}] DONE -> {out}")
    return out


def main():
    p = argparse.ArgumentParser(description="AI 쇼핑 쇼츠 메이커 (MVP)")
    p.add_argument("url", help="영상 URL")
    p.add_argument("--script", help="한국어 대본 텍스트")
    p.add_argument("--script-file", help="대본 파일 경로")
    p.add_argument("--cta", help="화면 하단 CTA 문구")
    p.add_argument("--voice", default=DEFAULT_VOICE)
    p.add_argument("--rate", default="+0%", help='예: "+10%%"')
    args = p.parse_args()

    script = args.script
    if args.script_file:
        script = Path(args.script_file).read_text(encoding="utf-8")

    run(args.url, script, cta=args.cta, voice=args.voice, rate=args.rate)


if __name__ == "__main__":
    main()
