"use client";

// 공용 프리젠테이션 컴포넌트(상태 없음).

// 로딩 스피너. 크기·색은 className으로(예: "h-4 w-4 border-white/40 border-t-white").
// 기본값 = 브랜드 핑크 4x4.
export function Spinner({
  className = "h-4 w-4 border-pink-500/40 border-t-pink-500",
}: {
  className?: string;
}) {
  return <span className={`inline-block animate-spin rounded-full border-2 ${className}`} />;
}

// on/off 알약 스위치(슬라이딩 노브).
// 시각적 알약은 h-7(28px) 유지하되, 클릭 영역(hit-area)은 44px 로 확장(모바일 터치타깃).
// 버튼 자체를 44×44 로 만들고 알약은 그 안에 절대 배치.
export function Switch({ on, onToggle, ariaLabel }: { on: boolean; onToggle: () => void; ariaLabel: string }) {
  return (
    <button
      onClick={onToggle}
      className={`relative flex h-11 w-11 flex-none items-center justify-center rounded-lg`}
      aria-label={ariaLabel}
    >
      <span className={`relative h-7 w-12 rounded-full transition-colors ${on ? "bg-pink-500" : "bg-white/15"}`}>
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}
