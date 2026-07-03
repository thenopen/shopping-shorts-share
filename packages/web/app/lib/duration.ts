// 대본 → 예상 발화 길이(초) 추정 + 실측 보정(피드백 루프 1단계).
//
// 관계식: 영상 길이 = 공백제외 글자수 ÷ (CPS × 말하기속도).
// CPS(초당 글자)는 한국어 TTS 1.0x 기준 ≈ 5.5로 시작하고,
// TTS 미리듣기·자막 생성에서 얻는 실측 길이로 성우별로 보정(EMA)해 점점 정확해진다.

export const BASE_CPS = 5.5;           // 한국어 TTS 1.0x 초당 글자(공백 제외) — 보정 전 기본값
const CPS_KEY = "tts_cps_v1";          // localStorage: { [voice]: { cps, n } }

export function visChars(s: string): number {
  return (s || "").replace(/\s+/g, "").length;
}

type CpsMap = Record<string, { cps: number; n: number }>;

function loadMap(): CpsMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(CPS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function getCps(voice: string): number {
  const m = loadMap()[voice];
  return m?.cps || BASE_CPS;
}

// 실측 기록 — durSec는 rate 적용된 실제 음성 길이. 1.0x 환산 CPS로 저장.
// EMA(직전 60% + 신규 40%)로 흔들림 완화, 3~9 클램프(측정 오염 방어).
export function recordCps(voice: string, chars: number, durSec: number, rate: number) {
  if (typeof window === "undefined") return;
  if (!voice || chars < 20 || !durSec || durSec <= 1 || !rate) return;
  const cps1x = Math.min(9, Math.max(3, chars / (durSec * rate)));
  try {
    const map = loadMap();
    const prev = map[voice];
    map[voice] = prev
      ? { cps: +(prev.cps * 0.6 + cps1x * 0.4).toFixed(3), n: prev.n + 1 }
      : { cps: +cps1x.toFixed(3), n: 1 };
    localStorage.setItem(CPS_KEY, JSON.stringify(map));
  } catch {}
}

// 대본 예상 길이(초). 대본 비면 null.
export function estimateSec(script: string, rate: number, voice: string): number | null {
  const c = visChars(script);
  if (!c) return null;
  return c / (getCps(voice) * Math.max(0.5, rate || 1));
}

// 목표 초 → 권장 글자수(공백 제외) — 대본 생성/줄이기 프롬프트용.
export function targetChars(sec: number, rate: number, voice: string): number {
  return Math.round(sec * getCps(voice) * Math.max(0.5, rate || 1));
}
