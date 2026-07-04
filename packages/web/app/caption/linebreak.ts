// 자막 줄배치(2줄) — 백엔드 caption.py(_WRAP_CHARS·_gap_quality·_break_index)의 쌍둥이.
// 로직·상수를 동일하게 유지해야 웹 미리보기 = 최종 렌더(ASS \N). 한쪽 바꾸면 양쪽 다.

export const WRAP_CHARS = 12;   // 한 줄 표시 상한(공백 제외). caption.py _WRAP_CHARS와 동일.

const SENT_END = new Set(["。", "！", "？", ".", "!", "?", "…"]);
const SOFT_END = new Set(["，", ",", "、", "·", ";", ":"]);
const CONNECT = ["니까", "는데", "지만", "어서", "아서", "여서", "라서", "도록",
  "다가", "든지", "거나", "면서", "고", "서", "며", "면", "고요"];

const vis = (s: string) => s.replace(/\s+/g, "").length;

// 어절 사이 분할점 품질(클수록 자연 경계) — 앞 어절 끝 기준.
function gapQuality(prev: string): number {
  const last = prev.slice(-1);
  if (SENT_END.has(last)) return 3.0;
  if (SOFT_END.has(last)) return 2.0;
  if (CONNECT.some((c) => prev.endsWith(c))) return 1.6;
  return 1.0;
}

// 2줄 분할 어절 인덱스 k(toks[k] 앞에서 줄바꿈) — 없으면 null(1줄 유지).
export function breakIndex(text: string): number | null {
  const toks = (text || "").split(/\s+/).filter(Boolean);
  if (toks.length < 2) return null;
  const v = toks.map(vis);
  const total = v.reduce((a, b) => a + b, 0);
  if (total <= WRAP_CHARS) return null;
  let best: number | null = null, bestCost = Infinity;       // 폭 제약 만족 후보
  let loose: number | null = null, looseCost = Infinity;     // 제약 무시 폴백
  let left = 0;
  for (let k = 1; k < toks.length; k++) {
    left += v[k - 1];
    const right = total - left;
    let widow = 0;
    if (k === 1 && left < 4) widow += 5;
    if (toks.length - k === 1 && right < 4) widow += 5;
    const cost = ((left - right) ** 2) / Math.max(1, total) - 1.2 * gapQuality(toks[k - 1]) + widow;
    if (cost < looseCost) { looseCost = cost; loose = k; }
    if (left <= WRAP_CHARS + 2 && right <= WRAP_CHARS + 2 && cost < bestCost) { bestCost = cost; best = k; }
  }
  return best ?? loose;
}

// 표시용 줄 분해 — 오직 텍스트의 줄바꿈(\n)으로만 나눈다(자동 폭맞춤 재분할 없음).
// 줄바꿈은 생성 시점에 \n으로 박히거나 유저가 편집창 엔터로 넣는다 → 표시는 그대로 존중.
// emph(수동 강조 단어 인덱스)는 줄별로 시프트해서 반환(강조 위치 보존).
export function displayLines(
  text: string,
  emph?: number[] | null,
): { text: string; emph: number[] | null }[] {
  const shift = (arr: number[] | null | undefined, from: number, to: number) =>
    arr == null ? null : arr.filter((i) => i >= from && i < to).map((i) => i - from);

  if (!text.includes("\n")) return [{ text, emph: emph ?? null }];
  const lines = text.split("\n").filter((l) => l.trim());
  const out: { text: string; emph: number[] | null }[] = [];
  let cum = 0;
  for (const l of lines) {
    const n = l.split(/\s+/).filter(Boolean).length;
    out.push({ text: l, emph: shift(emph, cum, cum + n) });
    cum += n;
  }
  return out;
}
