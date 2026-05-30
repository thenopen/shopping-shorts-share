"""파이프라인 오케스트레이터. 전체 9단계를 잇는다.

동생이 이 파일 하나 보면 전체 흐름 이해 가능.
구현된 단계는 실행, 미구현(Phase 2)은 [SKIP] 로그 찍고 넘어감.

CLI 사용:
  python -m app.pipeline.run <url> --script "대본" --voice 소담 --cta profile

단계 (ARCHITECTURE.md 와 1:1 대응):
  [1] download      ✅ 다운로드+분석
  [2] audio_strip   ✅ 사운드 제거
  [3] subtitle_remove ✅ 중국어 자막 제거(하단 고정영역)
  [4] face_cut      ⬜ 얼굴샷 컷 제거 (Phase 2)
  [5] tts           ✅ 한국어 더빙 (성우/배속)
  [6] caption       ⬜ 자동 자막 (Phase 2)
  [7] audio_mix     ⬜ BGM/효과음 (Phase 2)
  [8] cta           △ compose에 CTA 텍스트로 일부 반영
  [9] compose       ✅ 9:16 합성
"""
import argparse
import uuid
from pathlib import Path

from app.config import WORKDIR
from app.pipeline.download import download_video
from app.pipeline.audio_strip import strip_audio
from app.pipeline.subtitle_remove import remove_subtitle_bottom
from app.pipeline.tts import synthesize_by_nickname
from app.pipeline.compose import compose

# Phase 2 (미구현) — 임포트만, 호출 시 NotImplementedError
from app.pipeline import face_cut, caption, audio_mix

CTA_TEXT = {
    "comment": "제품 정보는 고정 댓글을 확인해주세요!",
    "profile": "구매처는 프로필 링크에 있어요!",
    "link": "자세한 내용은 하단 링크를 클릭하세요!",
}


def run(url, script=None, voice="소담", rate=None, cta="profile",
        remove_sub=True, sub_mode="bar",
        cookiefile=None, cookies_from_browser=None):
    # 공유 텍스트 통째로 들어와도 URL만 뽑아냄
    from app.url_extract import extract_url
    clean = extract_url(url)
    if clean:
        url = clean
    job_id = uuid.uuid4().hex[:8]
    job = WORKDIR / job_id
    job.mkdir(parents=True, exist_ok=True)
    print(f"[job {job_id}] start  url={url}")
    cur = None  # 현재 작업중인 영상 경로

    # [1] 다운로드
    print("[1/9] download...")
    if "douyin" in url:
        # 도우인 = yt-dlp 불가(msToken 차단). Playwright 직접추출 사용.
        from app.pipeline.douyin_download import download_douyin
        cur = download_douyin(url, job_id)
    else:
        cur = download_video(url, job_id,
                             cookiefile=cookiefile,
                             cookies_from_browser=cookies_from_browser)
    print(f"      -> {cur}")

    # [2] 사운드 제거 (대본 있어 더빙할 때만 의미)
    if script:
        print("[2/9] strip audio...")
        cur = strip_audio(cur, job / "muted.mp4")

    # [3] 중국어 자막 제거
    if remove_sub:
        print(f"[3/9] remove subtitle (mode={sub_mode})...")
        cur = remove_subtitle_bottom(cur, job / "nosub.mp4", mode=sub_mode)

    # [4] 얼굴 컷 제거 (Phase 2)
    try:
        cur = face_cut.cut_face_segments(cur, job / "facecut.mp4")
    except NotImplementedError:
        print("[4/9] face_cut [SKIP] Phase 2")

    # [5] TTS 더빙
    dub = None
    ts = []
    if script:
        print(f"[5/9] tts (voice={voice}, rate={rate or 'default'})...")
        dub, ts = synthesize_by_nickname(script, job / "dub.mp3",
                                         nickname=voice, rate_override=rate)
        print(f"      -> {dub}  ({len(ts)} word stamps)")
    else:
        print("[5/9] tts [SKIP] no script")

    # [6] 자동 자막 (Phase 2)
    ass = None
    try:
        from app.templates import get_preset
        lines = caption.build_lines_from_tts(ts, get_preset("기본"))
        ass = caption.render_ass(lines, job / "sub.ass", 1080, 1920)
    except NotImplementedError:
        print("[6/9] caption [SKIP] Phase 2")

    # [7] BGM/효과음 (Phase 2)
    if dub:
        try:
            dub = audio_mix.mix_audio(dub, job / "mixed.mp3")
        except NotImplementedError:
            print("[7/9] audio_mix [SKIP] Phase 2")

    # [8]+[9] CTA + 합성
    print("[8-9/9] compose 9:16...")
    out = compose(
        video_path=cur,
        audio_path=dub,
        out_path=job / "output.mp4",
        cta_text=CTA_TEXT.get(cta),
        replace_audio=bool(dub),
    )
    print(f"[job {job_id}] DONE -> {out}")
    return out


def main():
    p = argparse.ArgumentParser(description="AI 쇼핑 쇼츠 메이커 (코어 CLI)")
    p.add_argument("url")
    p.add_argument("--script")
    p.add_argument("--script-file")
    p.add_argument("--voice", default="소담", help="성우 닉네임")
    p.add_argument("--rate", default=None, help='배속 예: "+10%%"')
    p.add_argument("--cta", default="profile", choices=["comment", "profile", "link"])
    p.add_argument("--no-remove-sub", action="store_true")
    p.add_argument("--sub-mode", default="bar", choices=["bar", "blur"])
    # 도우인 쿠키 (둘 중 하나). cookiefile 권장 — 브라우저 안 닫아도 됨.
    p.add_argument("--cookiefile", default=None,
                   help="cookies.txt 경로 (도우인용, 브라우저 안 닫아도 됨)")
    p.add_argument("--cookies-from-browser", default=None,
                   choices=["chrome", "edge", "firefox"],
                   help="브라우저 쿠키 자동추출 (해당 브라우저 종료 필요)")
    a = p.parse_args()

    script = a.script
    if a.script_file:
        script = Path(a.script_file).read_text(encoding="utf-8")

    run(a.url, script, voice=a.voice, rate=a.rate, cta=a.cta,
        remove_sub=not a.no_remove_sub, sub_mode=a.sub_mode,
        cookiefile=a.cookiefile, cookies_from_browser=a.cookies_from_browser)


if __name__ == "__main__":
    main()
