"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "../ui";
import { JobState } from "../lib/types";
import { fmtSec } from "../lib/format";

// 생성 파이프라인 진행 표시 — 단계 체크리스트 + 부드러운 크롤 보간 + 경과/ETA + GPU 대기.
const PIPE_STEPS = ["다운로드", "자막제거", "대본", "더빙", "합성", "자막"];
const STATUS_STEP: Record<string, number> = {
  queued: 0, downloading: 0,
  removing_subtitle: 1, analyzed: 1,
  transcribing: 2, transcribed: 2,
  face_cut: 3, dubbing: 3,
  composing: 4,
  captioning: 5, done: 5,
};
const STEP_NOMINAL = [15, 120, 70, 15, 25, 20]; // 단계별 대략 소요초(ETA 근사용)

export function PipelineProgress({ job }: { job: JobState | null }) {
  const status = job?.status ?? "";
  const stage = job?.stage ?? "";
  const waiting = status === "waiting_gpu";

  const [disp, setDisp] = useState(0);
  const [, forceTick] = useState(0);          // disp가 정적일 때도 경과시간 갱신용 재렌더
  const jobIdRef = useRef<string | undefined>(undefined);
  const startRef = useRef(0);
  const stageStartRef = useRef(0);
  const lastStageRef = useRef("");
  const lastStepRef = useRef(0);
  const lastStatusRef = useRef("");

  const mapped = STATUS_STEP[status];
  const stepIdx = mapped !== undefined ? mapped : lastStepRef.current;

  // 새 job → 크롤/타이머 리셋
  useEffect(() => {
    if (job?.id !== jobIdRef.current) {
      jobIdRef.current = job?.id;
      setDisp(0);
      startRef.current = Date.now();
      stageStartRef.current = Date.now();
      lastStageRef.current = stage;
    }
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 단계(status) 전환 → 진행바를 '그 단계 0'에서 다시 시작 + 단계 타이머 리셋.
  // status 기준(stage 텍스트는 %마다 바뀌므로 리셋 트리거로 못 씀).
  useEffect(() => {
    if (status !== lastStatusRef.current) {
      lastStatusRef.current = status;
      setDisp(job?.progress ?? 0);   // 현재 단계 0~100 시작점
      stageStartRef.current = Date.now();
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mapped !== undefined) lastStepRef.current = mapped;
  }, [mapped]);

  // 크롤 보간: 목표까지 이징 → 목표 정적이면 살살 전진(안 멈춰 보이게) → 대기 중엔 정지.
  useEffect(() => {
    const id = setInterval(() => {
      forceTick((n) => (n + 1) & 1023);
      setDisp((d) => {
        const t = job?.progress ?? 0;
        if (waiting) return d;
        if (t > d) return Math.min(100, d + Math.max(0.5, (t - d) * 0.2));  // 실제 진행 따라감
        // 백엔드 실측 없는 단계(ProPainter·합성 등): 현재 단계 0~92 살살 크롤.
        const idle = !!status && !["done", "analyzed", "transcribed", "error", "waiting_gpu"].includes(status);
        if (idle && d < 92) return Math.min(d + 0.25, 92);
        return d;
      });
    }, 200);
    return () => clearInterval(id);
  }, [job?.progress, status, waiting]);

  if (startRef.current === 0) startRef.current = Date.now(); // 최초 렌더 안전망
  const elapsed = (Date.now() - startRef.current) / 1000;
  const stageElapsed = (Date.now() - stageStartRef.current) / 1000;
  const etaLeft = (STEP_NOMINAL[stepIdx] ?? 30) - stageElapsed;
  const pct = Math.min(100, Math.round(disp));

  return (
    <div className="panel-2 mt-4 w-full overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3 text-[12px] font-semibold">
        {PIPE_STEPS.map((label, i) => {
          const done = status === "done" || i < stepIdx;
          const active = i === stepIdx && !done;
          return (
            <span key={label} className={done ? "text-emerald-400" : active ? "text-[var(--text-strong)]" : "text-slate-600"}>
              {done ? "✓" : active ? "⟳" : "○"} {label}
            </span>
          );
        })}
      </div>
      <div className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-100">
        <Spinner className={`h-4 w-4 ${waiting ? "border-amber-400/50 border-t-amber-400" : "border-pink-500/40 border-t-pink-500"}`} />
        {waiting ? (
          <span className="text-amber-400">GPU 대기 중 · 앞 작업이 끝나면 시작돼요</span>
        ) : (
          <span>
            {stage || "준비 중"} · {pct}%
            <span className="ml-2 text-xs font-normal text-slate-500">
              {fmtSec(elapsed)} 경과{etaLeft > 3 ? ` · ~${fmtSec(etaLeft)} 남음` : stepIdx < 5 ? " · 마무리 중" : ""}
            </span>
          </span>
        )}
      </div>
      <div className="h-1.5 w-full bg-white/10">
        <div className={`h-full transition-all duration-300 ${waiting ? "bg-amber-400" : "bg-[var(--brand)]"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
