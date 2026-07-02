"use client";

import { Check, Clapperboard, Settings, FilePlus2 } from "lucide-react";
import { StageKey, STAGES } from "../../lib/stage";
import { Spinner } from "../../ui";
import { QuotaBadge } from "../QuotaBadge";
import { ThemeToggle } from "../ThemeToggle";

// 워크스페이스 상단바 — 좌: 로고/타이틀, 중앙: 스테이지 칩 내비(lg+), 우: 사용량·설정·영상 생성 CTA.
export function TopBar(props: {
  stage: StageKey;
  onStage: (s: StageKey) => void;
  done: Record<StageKey, boolean>;
  onOpenSettings: () => void;
  usageRefresh: number;
  usageActive: boolean;
  deployN: number;
  onRender: () => void;
  renderDisabled: boolean;
  renderBusy: boolean;
  onNewProject: () => void;   // 새 영상(현재 작업 초기화 → 소스)
}) {
  // 스테이지 칩 1개 (데스크톱 중앙/모바일 하단 행 공용)
  const chip = (s: { key: StageKey; label: string }) => {
    const active = props.stage === s.key;
    return (
      <button
        key={s.key}
        onClick={() => props.onStage(s.key)}
        className={`flex flex-none items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
          active
            ? "bg-pink-500/15 text-[var(--text-strong)] ring-1 ring-pink-500/40"
            : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
        }`}
      >
        {props.done[s.key] && <Check className="h-3.5 w-3.5 text-emerald-400" />}
        {s.label}
      </button>
    );
  };

  return (
    <>
    <header className="flex h-14 flex-none items-center justify-between border-b border-[var(--line)] px-4">
      {/* 좌: 로고 + 타이틀 + BETA */}
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--brand)] to-[var(--blu)] font-bold text-white">
          S
        </div>
        <span className="font-semibold text-slate-100">쇼핑 쇼츠 메이커</span>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-400 ring-1 ring-[var(--line)]">
          BETA
        </span>
      </div>

      {/* 중앙: 스테이지 칩 내비 — done=emerald 체크, active=brand 하이라이트 */}
      <nav className="hidden items-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-1 text-[12px] font-medium lg:flex">
        {STAGES.map(chip)}
      </nav>

      {/* 우: Modal 배포중 칩 + 사용량 배지 + 설정 + 영상 생성 CTA */}
      <div className="flex items-center gap-2">
        {props.deployN > 0 && (
          <button
            onClick={props.onOpenSettings}
            className="whitespace-nowrap rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-400 ring-1 ring-amber-400/30 hover:bg-amber-400/20"
          >
            Modal 배포중 {props.deployN}
          </button>
        )}
        <QuotaBadge refreshKey={props.usageRefresh} active={props.usageActive} />
        <ThemeToggle />
        <button
          onClick={props.onOpenSettings}
          aria-label="설정"
          className="btn-ghost flex h-9 w-9 items-center justify-center rounded-lg"
        >
          <Settings className="h-4 w-4 text-slate-300" />
        </button>
        <button
          onClick={props.onNewProject}
          className="btn-ghost flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium"
          title="현재 작업을 접고 새 영상을 시작"
        >
          <FilePlus2 className="h-4 w-4 text-slate-300" /> 새 영상
        </button>
        <button
          onClick={props.onRender}
          disabled={props.renderDisabled}
          className="btn-primary flex items-center gap-2 rounded-xl px-5 py-2"
        >
          {props.renderBusy ? (
            <>
              <Spinner className="h-4 w-4 border-white/40 border-t-white" /> 생성 중…
            </>
          ) : (
            <>
              <Clapperboard className="h-4 w-4" /> 영상 생성
            </>
          )}
        </button>
      </div>
    </header>
    {/* 모바일 스테이지 칩 — 데스크톱 중앙 내비는 lg 전용이라 별도 가로 스크롤 행 */}
    <nav className="flex items-center gap-1 overflow-x-auto border-b border-[var(--line)] px-3 py-2 text-[12px] font-medium lg:hidden">
      {STAGES.map(chip)}
    </nav>
    </>
  );
}
