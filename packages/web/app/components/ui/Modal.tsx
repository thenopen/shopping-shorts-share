"use client";

// 전역 모달(confirm/prompt) — window.confirm/window.prompt 를 대체.
// Promise 기반: const ok = await confirmDialog({ title, message, danger });
// 사용: import { confirmDialog, promptDialog, ModalContainer } from "./Modal";
import { useEffect, useState } from "react";

type ConfirmOpts = { title?: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type PromptOpts = { title?: string; message?: string; placeholder?: string; confirmLabel?: string; cancelLabel?: string };

type PendingConfirm = { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void };
type PendingPrompt = { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void };
type Pending = PendingConfirm | PendingPrompt;

let _pending: Pending | null = null;
let _listeners: Array<() => void> = [];

function emit() { for (const l of _listeners) l(); }
function subscribe(l: () => void): () => void {
  _listeners.push(l);
  return () => { _listeners = _listeners.filter((x) => x !== l); };
}

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    _pending = { kind: "confirm", opts, resolve };
    emit();
  });
}

export function promptDialog(opts: PromptOpts): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    _pending = { kind: "prompt", opts, resolve };
    emit();
  });
}

function close(result: boolean | string | null) {
  const p = _pending;
  if (!p) return;
  _pending = null;
  emit();
  if (p.kind === "confirm") p.resolve(result as boolean);
  else p.resolve(result as string | null);
}

export function ModalContainer() {
  const [, setN] = useState(0);
  useEffect(() => subscribe(() => setN((n) => n + 1)), []);
  const [promptVal, setPromptVal] = useState("");
  const p = _pending;
  useEffect(() => { setPromptVal(""); }, [p]);

  if (!p) return null;
  const title = p.opts.title || (p.kind === "confirm" ? "확인" : "입력");

  // Enter/ESC 키 처리.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") close(p.kind === "confirm" ? false : null);
    if (e.key === "Enter") {
      if (p.kind === "confirm") close(true);
      else if (promptVal.trim()) close(promptVal.trim());
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => close(p.kind === "confirm" ? false : null)}
      onKeyDown={onKey}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="panel w-full max-w-sm rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-base font-bold text-[var(--text-strong)]">{title}</div>
        {p.opts.message && (
          <p className="mb-4 whitespace-pre-line text-sm text-[var(--text-mut)]">{p.opts.message}</p>
        )}
        {p.kind === "prompt" && (
          <input
            autoFocus
            value={promptVal}
            onChange={(e) => setPromptVal(e.target.value)}
            placeholder={p.opts.placeholder || ""}
            className="field mb-4 w-full rounded-lg px-3 py-2 text-sm outline-none"
          />
        )}
        <div className="flex justify-end gap-2">
          <button
            className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm text-[var(--text-mut)] hover:bg-[var(--panel-2)]"
            onClick={() => close(p.kind === "confirm" ? false : null)}
          >
            {p.opts.cancelLabel || "취소"}
          </button>
          <button
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
              p.kind === "confirm" && p.opts.danger ? "bg-rose-500 hover:bg-rose-600" : "bg-pink-500 hover:bg-pink-600"
            }`}
            onClick={() => close(p.kind === "confirm" ? true : promptVal.trim() || null)}
          >
            {p.opts.confirmLabel || "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}
