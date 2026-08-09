"use client";
import { useRef, useState } from "react";
import { apiBase } from "../lib/api";
import { toast } from "../components/ui/Toast";

// 보이스 미리듣기 — 숨은 <audio> 하나로 재생(iOS 인앱브라우저 호환). audioRef/playing은
// TTS 대본 미리듣기(previewTts)와 공유해야 하므로 그대로 노출.
// Typecast 마이그레이션: 정적 /voices/<닉>.mp3 → 서버 GET /tts/voice_sample?voice_id=tc_xxx
// (고정 문구 합성 + workdir/voice_samples 캐시 — 보이스당 최초 1회만 크레딧 소모).
export function useVoicePreview() {
  const [playing, setPlaying] = useState<string | null>(null);       // 재생 중 voice_id
  const [loadingVoice, setLoadingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function toggleVoice(voiceId: string, engine: string = "typecast") {
    const el = audioRef.current;
    if (!el) return;
    if (playing === voiceId) {    // 같은 보이스 다시 누르면 정지
      el.pause();
      setPlaying(null);
      return;
    }
    // iOS/인앱브라우저: play()는 사용자 제스처 안에서 동기 호출돼야 한다.
    // load() 호출하면 진행중 play()가 AbortError로 취소됨 → src만 바꾸고 play().
    const q = `voice_id=${encodeURIComponent(voiceId)}&engine=${encodeURIComponent(engine)}`;
    if (!el.src.endsWith(q)) el.src = `${apiBase()}/tts/voice_sample?${q}`;
    el.currentTime = 0;
    setLoadingVoice(voiceId);     // 클릭 즉시 로딩 표시(첫 합성은 수 초 걸릴 수 있음)
    setPlaying(voiceId);
    el.play()
      .then(() => setLoadingVoice(null))
      .catch((err: unknown) => {
        const name = err instanceof Error ? err.name : "";
        if (name === "AbortError") return; // 다른 보이스로 빠르게 전환 시 정상 — 무시
        setLoadingVoice(null);
        setPlaying(null);
        toast.error(`미리듣기 재생 실패: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  const onAudioEnded = () => setPlaying(null);

  return { audioRef, playing, setPlaying, loadingVoice, toggleVoice, onAudioEnded };
}
