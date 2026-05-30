"""[3-보조] 중국어 음성 → 한국어 대본 자동생성.

흐름:
  원본 영상/오디오 → faster-whisper STT(중국어 인식) → 구글번역(중→한) → 한국어 대본

이 결과를 TTS[5]에 넣으면 "중국어 말 → 한국어 더빙"이 자동.
사용자가 대본 안 써도 됨 (강의 도구의 핵심 자동화).

무료: faster-whisper(로컬, GPU 없으면 CPU). 모델 small=빠름/적당, medium=정확/느림.
처음 실행시 모델 자동 다운로드(small ~500MB).
"""
from pathlib import Path
from app.pipeline.translate import translate_zh_ko


def transcribe_to_korean(
    media_path: Path,
    model_size: str = "small",
    keep_segments: bool = True,
) -> dict:
    """중국어 음성 → 한국어 대본 + 타임스탬프.

    반환:
      {
        "zh_text": "원본 중국어 전체",
        "ko_text": "번역된 한국어 대본 전체",
        "segments": [ {start, end, zh, ko}, ... ]   # 구간별 (자막싱크용)
      }
    """
    from faster_whisper import WhisperModel

    # CPU int8 = 가볍고 빠름. GPU 있으면 device="cuda".
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(media_path), language="zh")

    seg_list = []
    zh_parts = []
    for s in segments:
        zh = s.text.strip()
        zh_parts.append(zh)
        if keep_segments:
            ko = translate_zh_ko(zh)
            seg_list.append({"start": s.start, "end": s.end, "zh": zh, "ko": ko})

    zh_text = " ".join(zh_parts)
    # 전체를 한번에 번역 (구간별 합치면 부자연스러우니 전체도 따로)
    ko_text = translate_zh_ko(zh_text)

    return {"zh_text": zh_text, "ko_text": ko_text, "segments": seg_list}


if __name__ == "__main__":
    import sys
    r = transcribe_to_korean(sys.argv[1])
    print("ZH:", r["zh_text"][:200])
    print("KO:", r["ko_text"][:200])
