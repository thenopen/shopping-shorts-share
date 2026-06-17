import os
from pathlib import Path

from app.config import BACKEND_ROOT

KEY_PATH = BACKEND_ROOT / "auth" / "google_tts_key.json"


def available() -> bool:
    return bool(os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")) or KEY_PATH.exists()


def _client():
    from google.cloud import texttospeech

    if not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") and KEY_PATH.exists():
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(KEY_PATH)
    return texttospeech.TextToSpeechClient()


def synthesize(text: str, out_path: Path, nickname: str = "소담", speaking_rate: float = 1.0) -> Path:
    from google.cloud import texttospeech as tts

    from app.voices import get_voice

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    voice_name = get_voice(nickname).google

    client = _client()
    synthesis_input = tts.SynthesisInput(text=text)
    voice = tts.VoiceSelectionParams(language_code="ko-KR", name=voice_name)
    # LINEAR16(무손실 WAV) + 44.1kHz → MP3 32kbps 저음질 지직 제거. compose에서 aac로 재인코딩됨.
    audio_config = tts.AudioConfig(
        audio_encoding=tts.AudioEncoding.LINEAR16,
        sample_rate_hertz=44100,
        speaking_rate=speaking_rate,
    )
    resp = client.synthesize_speech(input=synthesis_input, voice=voice, audio_config=audio_config)
    out_path.write_bytes(resp.audio_content)
    return out_path
