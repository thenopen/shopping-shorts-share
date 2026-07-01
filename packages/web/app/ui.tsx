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
