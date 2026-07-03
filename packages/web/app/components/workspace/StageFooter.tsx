"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { StageKey, STAGES } from "../../lib/stage";

// 중앙 컬럼 하단 고정 — 이전/다음 단계 이동(가이드형 선형 흐름).
// 상단 칩(자유 점프)과 병행: 칩=위치·비선형, 여기=순서대로 진행.
export function StageFooter({ stage, onStage }: { stage: StageKey; onStage: (s: StageKey) => void }) {
  const idx = STAGES.findIndex((s) => s.key === stage);
  const prev = STAGES[idx - 1];
  const next = STAGES[idx + 1];
  return (
    <div className="flex flex-none items-center justify-between gap-2 border-t border-[var(--line)] px-5 py-3">
      {prev ? (
        <button
          onClick={() => onStage(prev.key)}
          className="btn-ghost flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium"
        >
          <ChevronLeft className="h-4 w-4" /> 이전 · {prev.label}
        </button>
      ) : (
        <span className="text-[11px] text-slate-500">첫 단계</span>
      )}
      {next ? (
        <button
          onClick={() => onStage(next.key)}
          className="flex items-center gap-1.5 rounded-lg bg-pink-500/15 px-5 py-2 text-sm font-semibold text-pink-300 ring-1 ring-pink-500/30 transition hover:bg-pink-500/25"
        >
          다음 · {next.label} <ChevronRight className="h-4 w-4" />
        </button>
      ) : (
        <span className="text-[11px] text-slate-500">
          마지막 단계 — 옵션 확인 후 위 <b className="text-slate-400">영상 생성</b> 버튼으로 완성
        </span>
      )}
    </div>
  );
}
