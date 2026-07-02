"use client";

// 리셋 시각/설명을 보여주는 (?) 도움말 아이콘 — 네이티브 title 툴팁(줄바꿈 포함).
export function HelpDot({ title }: { title: string }) {
  return (
    <span
      title={title}
      className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full bg-[var(--ink-soft)]/25 text-[9px] font-bold leading-none text-[var(--ink-soft)]"
    >?</span>
  );
}
