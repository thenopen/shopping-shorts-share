"use client";

// 알약 토글 버튼(선택 = 브랜드 핑크 틴트). dense=true → whitespace-nowrap + px-2.5 (좁은 칸/스타일 행용),
// 기본 → px-3. 두 호출부(CaptionEditor·CaptionTimeline)의 기존 룩을 다크 톤으로 재현.
export function Toggle({ on, onClick, label, dense }: { on: boolean; onClick: () => void; label: string; dense?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`${dense ? "whitespace-nowrap px-2.5" : "px-3"} rounded-full py-1 text-xs font-semibold transition ${on ? "bg-pink-500/15 text-pink-400 ring-1 ring-pink-500/30" : "bg-white/5 text-slate-400 ring-1 ring-[var(--line)] hover:bg-white/10"}`}
    >
      {label}
    </button>
  );
}
