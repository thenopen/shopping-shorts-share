"use client";

// 전역 토스트 시스템 — alert() 를 대체(모바일 친화적, 자동 소멸, 큐).
// 사용: import { toast } from "./components/ui/Toast"; toast.error("실패");
import { useEffect, useState } from "react";

export type ToastType = "error" | "success" | "info" | "warn";
export type ToastItem = { id: number; type: ToastType; msg: string; duration: number };

// 가벼운 전역 스토어(use-react-state 패턴 직구현 — 의존성 0).
type Listener = () => void;
let _toasts: ToastItem[] = [];
let _listeners: Listener[] = [];
let _nextId = 1;

function emit() { for (const l of _listeners) l(); }
function subscribe(l: Listener): () => void {
  _listeners.push(l);
  return () => { _listeners = _listeners.filter((x) => x !== l); };
}

export function pushToast(opts: { type?: ToastType; msg: string; duration?: number }) {
  const id = _nextId++;
  const item: ToastItem = {
    id,
    type: opts.type || "info",
    msg: opts.msg,
    duration: opts.duration ?? (opts.type === "error" ? 6000 : 3500),
  };
  _toasts = [..._toasts, item];
  emit();
  if (item.duration > 0) {
    setTimeout(() => dismissToast(id), item.duration);
  }
  return id;
}

export function dismissToast(id: number) {
  _toasts = _toasts.filter((t) => t.id !== id);
  emit();
}

// 편의 전역 객체 — 어디서든 import 해서 쓸 수 있음(useState/useEffect 불필요).
export const toast = {
  error: (msg: string, duration?: number) => pushToast({ type: "error", msg, duration }),
  success: (msg: string, duration?: number) => pushToast({ type: "success", msg, duration }),
  info: (msg: string, duration?: number) => pushToast({ type: "info", msg, duration }),
  warn: (msg: string, duration?: number) => pushToast({ type: "warn", msg, duration }),
  push: pushToast,
  dismiss: dismissToast,
};

// React hook — 컴포넌트에서 토스트 목록 구독.
export function useToasts(): ToastItem[] {
  const [, setN] = useState(0);
  useEffect(() => subscribe(() => setN((n: number) => n + 1)), []);
  return _toasts;
}

// 색상 토큰 매핑 — productErr 패턴(rose/emerald) 재사용 + info/warn 추가.
const TYPE_STYLE: Record<ToastType, { bg: string; text: string; icon: string }> = {
  error: { bg: "bg-rose-500/15", text: "text-rose-300", icon: "✕" },
  success: { bg: "bg-emerald-500/15", text: "text-emerald-300", icon: "✓" },
  info: { bg: "bg-sky-500/15", text: "text-sky-300", icon: "ℹ" },
  warn: { bg: "bg-amber-500/15", text: "text-amber-300", icon: "⚠" },
};

// 토스트 컨테이너 — layout.tsx 또는 page.tsx 최상단에 한 번 렌더.
export function ToastContainer() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[9999] flex flex-col items-center gap-2 px-3">
      {toasts.map((t) => {
        const s = TYPE_STYLE[t.type];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-md items-start gap-2 rounded-xl ${s.bg} ${s.text} px-3.5 py-2.5 text-sm shadow-lg ring-1 ring-[var(--line)] backdrop-blur`}
            style={{ animation: "toastIn 0.2s ease-out" }}
            onClick={() => dismissToast(t.id)}
            role="alert"
          >
            <span className="mt-0.5 font-bold">{s.icon}</span>
            <span className="whitespace-pre-line break-words">{t.msg}</span>
            <button
              className="ml-1 shrink-0 opacity-60 hover:opacity-100"
              onClick={(e) => { e.stopPropagation(); dismissToast(t.id); }}
              aria-label="닫기"
            >✕</button>
          </div>
        );
      })}
    </div>
  );
}
