"""Google Cloud TTS 어댑터 (edge-tts보다 자연스러움).

무료 한도: 월 100만자 (Neural2/WaveNet), Chirp3-HD 별도 한도.
사용 전 준비(사용자):
  1. Google Cloud 가입 + 프로젝트 생성
  2. "Cloud Text-to-Speech API" 활성화
  3. 서비스계정 키(JSON) 발급 → 다운로드
  4. 키 경로를 환경변수 GOOGLE_APPLICATION_CREDENTIALS 또는
     auth/google_tts_key.json 에 저장

키 없으면 edge-tts로 자동 폴백(tts.py에서 처리).
"""
import os
from pathlib import Path

from app.config import BACKEND_ROOT

KEY_PATH = BACKEND_ROOT / "auth" / "google_tts_key.json"

# 보이스 매핑은 voices.py 단일 소스 사용


def available() -> bool:
    """Google TTS 사용 가능한지 (키 존재)."""
    return bool(os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")) or KEY_PATH.exists()


def _client():
    from google.cloud import texttospeech
    if not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") and KEY_PATH.exists():
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(KEY_PATH)
    return texttospeech.TextToSpeechClient()


def synthesize(text: str, out_path: Path, nickname: str = "소담",
               speaking_rate: float = 1.0) -> Path:
    """Google TTS로 한국어 음성 생성.

    speaking_rate: 배속 (0.25~4.0, 1.0=기본).
    반환: mp3 경로.
    """
    from google.cloud import texttospeech as tts

    from app.voices import get_voice
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    voice_name = get_voice(nickname).google

    client = _client()
    synthesis_input = tts.SynthesisInput(text=text)
    voice = tts.VoiceSelectionParams(language_code="ko-KR", name=voice_name)
    audio_config = tts.AudioConfig(
        audio_encoding=tts.AudioEncoding.MP3,
        speaking_rate=speaking_rate,
    )
    resp = client.synthesize_speech(
        input=synthesis_input, voice=voice, audio_config=audio_config
    )
    out_path.write_bytes(resp.audio_content)
    return out_path
