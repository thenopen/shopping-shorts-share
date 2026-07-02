// API 호출 공용 유틸 — 같은 출처("") → next.config rewrites가 8000 백엔드로 프록시.

export function apiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE;
  if (typeof window === "undefined") return "http://127.0.0.1:8000";
  // 같은 출처("") → next.config rewrites가 8000으로 프록시 (터널/LAN/Tailscale 포트 하나로 통일)
  return "";
}

export async function postJSON<T = any>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(msg || `요청 실패 (HTTP ${r.status})`);
  }
  return r.json();
}

// catch 블록 공용 — Error면 그 메시지, 아니면 fallback.
export function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
