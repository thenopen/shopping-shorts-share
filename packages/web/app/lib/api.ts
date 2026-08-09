// API 호출 공용 유틸 — 같은 출처("") → next.config rewrites가 8000 백엔드로 프록시.

const TOKEN_KEY = "ss_auth_token";

// 서버가 부팅 토큰 인증을 켠 경우, 모든 요청에 Bearer 토큰을 붙인다.
// 토큰은 localStorage 1곳에 저장(첫 진입 시 ?token= 으로 받거나 토큰 입력창에서 입력).
export function getToken(): string {
  if (typeof window === "undefined") return "";
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

export function setToken(t: string) {
  if (typeof window === "undefined") return;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export function clearToken() { setToken(""); }

// ── 401(인증 거부) 전파 ──
// apiFetch 가 401 을 받으면 토큰을 폐기하고 등록된 리스너들에게 알린다.
// page.tsx 가 리스너를 등록해 "토큰 입력 오버레이"를 다시 띄운다(영구 차단 방지).
type UnauthorizedListener = () => void;
const _unauthListeners: Set<UnauthorizedListener> = new Set();

export function onUnauthorized(fn: UnauthorizedListener): () => void {
  _unauthListeners.add(fn);
  return () => { _unauthListeners.delete(fn); };   // 구독 해제 함수 반환(cleanup)
}

function _notifyUnauthorized() {
  for (const fn of _unauthListeners) {
    try { fn(); } catch {}
  }
}

// 토큰이 있으면 Authorization 헤더를 만든다(없으면 빈 객체 — 서버가 ALLOW_NO_AUTH=1 일 수 있음).
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const t = getToken();
  const h: Record<string, string> = { ...(extra || {}) };
  if (t) h["Authorization"] = `Bearer ${t}`;
  return h;
}

export function apiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE;
  if (typeof window === "undefined") return "http://127.0.0.1:8000";
  // 같은 출처("") → next.config rewrites가 8000으로 프록시 (터널/LAN/Tailscale 포트 하나로 통일)
  return "";
}

// 참고: 과거 대용량 업로드용 apiDirect()(8000 직접)가 있었으나 호출처가 없어 제거됨(2026-08-09).
// 모든 요청은 apiBase() 경유(Next proxy)로 통일 — proxyClientMaxBodySize: 50mb 로 커버됨.

// 모든 GET 요청의 공용 진입 — 토큰 자동 첨부 + 401(토큰 불일치) 처리.
// 401 시 토큰을 비우고 에러를 throw → 호출측(useEffect 등)이 토큰 입력 오버레이를 띄우게 함.
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: authHeaders(init?.headers as Record<string, string> | undefined),
  });
  if (r.status === 401) {
    clearToken();   // 잘못된/만료된 토큰 폐기
    _notifyUnauthorized();   // page.tsx 게이트가 오버레이를 다시 띄우게 함(영구 차단 방지)
    throw new AuthError("인증 토큰이 필요합니다. 서버 콘솔에 표시된 토큰을 입력하세요.");
  }
  return r;
}

export class AuthError extends Error {
  constructor(msg: string) { super(msg); this.name = "AuthError"; }
}

export async function postJSON<T = any>(path: string, body: unknown): Promise<T> {
  try {
    const r = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const msg = await r.text().catch(() => "");
      throw new Error(msg || `요청 실패 (HTTP ${r.status})`);
    }
    return r.json();
  } catch (e) {
    // apiFetch 가 throw 한 AuthError 는 그대로 전파(호출측이 구분하게)
    if (e instanceof AuthError) throw e;
    throw e;
  }
}

// catch 블록 공용 — Error면 그 메시지, 아니면 fallback. AuthError 는 메시지 우선.
export function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

// 인증이 필요한지(토큰이 설정돼 있는지) — page.tsx 가 토큰 입력 오버레이 표시 여부 결정.
export function hasToken(): boolean { return !!getToken(); }
