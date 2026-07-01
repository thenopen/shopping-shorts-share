// 공용 프리젠테이션 컴포넌트(상태 없음).

// 로딩 스피너. 크기·색은 className으로(예: "h-4 w-4 border-white/40 border-t-white").
// 기본값 = 액센트 4x4.
export function Spinner({
  className = "h-4 w-4 border-[var(--accent)]/40 border-t-[var(--accent-deep)]",
}: {
  className?: string;
}) {
  return <span className={`inline-block animate-spin rounded-full border-2 ${className}`} />;
}

// on/off 알약 스위치(슬라이딩 노브).
export function Switch({ on, onToggle, ariaLabel }: { on: boolean; onToggle: () => void; ariaLabel: string }) {
  return (
    <button
      onClick={onToggle}
      className={`relative h-7 w-12 flex-none rounded-full transition-colors ${on ? "btn-grad" : "bg-white/60"}`}
      aria-label={ariaLabel}
    >
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}
