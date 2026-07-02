import type { CaptionLineData } from "../caption/types";

export function fmtK(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return `${n}`;
}

export function fmtSec(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

// 소구포인트 텍스트("카테고리: X\n소구포인트:\n- p1\n- p2") → {카테고리, 포인트[]}. 파싱 실패해도 안전.
export function parsePoints(t: string): { cat: string; points: string[] } {
  const cat = ((t || "").match(/카테고리[:：]\s*(.+)/) || [])[1]?.trim() || "";
  const points = (t || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-•*·]/.test(l))
    .map((l) => l.replace(/^[-•*·]\s*/, "").trim())
    .filter(Boolean);
  return { cat, points };
}

// 서버가 준 자막 줄 배열 → CaptionLineData[] 정규화(text/start/end/style만).
export function normLines(arr: CaptionLineData[] | undefined | null): CaptionLineData[] {
  return (arr || []).map((l) => ({ text: l.text, start: l.start, end: l.end, style: l.style ?? null }));
}
