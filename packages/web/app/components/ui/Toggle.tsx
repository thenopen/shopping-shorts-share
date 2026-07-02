"use client";

// 알약 토글 버튼(선택 = btn-grad). dense=true → whitespace-nowrap + px-2.5 (좁은 칸/스타일 행용),
// 기본 → px-3. 두 호출부(CaptionEditor·CaptionTimeline)의 기존 룩을 그대로 재현.
export function Toggle({ on, onClick, label, dense }: { on: boolean; onClick: () => void; label: string; dense?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`${dense ? "whitespace-nowrap px-2.5" : "px-3"} rounded-full py-1 text-xs font-semibold transition ${on ? "btn-grad" : "bg-white/60 text-[var(--ink-soft)] hover:bg-white/80"}`}
    >
      {label}
    </button>
  );
}
