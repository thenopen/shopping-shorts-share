"use client";

import { Stages } from "../lib/types";

// 재사용 진입점 표시 — 원본/자막제거/대본 중 어디까지 캐시되어 있는지(✓/○).
export function StageBadges({ stages }: { stages: Stages }) {
  const items: [keyof Stages, string][] = [["source", "원본"], ["nosub", "자막제거"], ["script", "대본"]];
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {items.map(([k, l]) => (
        <span key={k} className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${stages[k] ? "bg-emerald-100 text-emerald-700" : "bg-white/50 text-[var(--ink-soft)]/60"}`}>
          {stages[k] ? "✓" : "○"} {l}
        </span>
      ))}
    </div>
  );
}
