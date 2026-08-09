"use client";

import { Check, House, Settings, Save } from "lucide-react";
import { StageKey, STAGES } from "../../lib/stage";
import { QuotaBadge } from "../QuotaBadge";
import { ThemeToggle } from "../ThemeToggle";
import { Spinner } from "../../ui";

// 편집(워크스페이스) 상단바 — 좌: 홈 복귀/타이틀, 중앙: 스테이지 칩 내비(lg+), 우: 저장·사용량·설정.
export function TopBar(props: {
  stage: StageKey;
  onStage: (s: StageKey) => void;
  done: Record<StageKey, boolean>;
  onOpenSettings: () => void;
  usageRefresh: number;
  usageActive: boolean;
  deployN: number;
  onHome: () => void;   // 홈(프로젝트 목록)으로 — 편집 상태는 유지된 채 view만 전환
  onSave: () => void; saving: boolean; projectName: string;   // 프로젝트 저장
  saveState: "idle" | "saving" | "saved";
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
      {/* 좌: 로고(홈 복귀) + 타이틀 + 편집 배지 */}
      <div className="flex items-center gap-3">
        <button
          onClick={props.onHome}
          title="홈으로 (작업은 유지돼요)"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--brand)] to-[var(--blu)] font-bold text-white transition hover:opacity-90"
        >
          S
        </button>
        {/* 프로젝트명(있으면) — 저장되면 상단에 표시. 클릭=이름 변경(저장 모달) */}
        {props.projectName ? (
          <button onClick={props.onSave} title="이름 변경 / 저장" className="flex min-w-0 items-center gap-2">
            <span className="max-w-[40vw] truncate font-semibold text-slate-100 sm:max-w-xs">{props.projectName}</span>
            {props.saveState === "saving" ? (
              <span className="whitespace-nowrap text-[10px] text-slate-500">저장 중…</span>
            ) : props.saveState === "saved" ? (
              <span className="whitespace-nowrap text-[10px] text-emerald-400">저장됨</span>
            ) : null}
          </button>
        ) : (
          <>
            <span className="hidden font-semibold text-slate-100 sm:inline">쇼핑 쇼츠 메이커</span>
            <span className="rounded-full bg-pink-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-pink-400 ring-1 ring-pink-500/30">편집</span>
          </>
        )}
        <button
          onClick={props.onHome}
          className="btn-ghost flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] font-medium"
          title="프로젝트 목록으로 — 편집 중인 작업은 유지"
        >
          <House className="h-3.5 w-3.5 text-slate-400" /> 홈
        </button>
      </div>

      {/* 중앙: 스테이지 칩 내비 — done=emerald 체크, active=brand 하이라이트 */}
      <nav className="hidden items-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-1 text-[12px] font-medium lg:flex">
        {STAGES.map(chip)}
      </nav>

      {/* 우: Modal 배포중 칩 + 사용량 배지 + 테마 + 설정 */}
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
          onClick={props.onSave}
          disabled={props.saving}
          title={props.projectName ? `'${props.projectName}' 저장` : "프로젝트 저장"}
          className="btn-ghost flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {props.saving ? <Spinner className="h-3.5 w-3.5 border-slate-400/40 border-t-slate-300" /> : <Save className="h-4 w-4 text-slate-300" />}
          저장
        </button>
        <button
          onClick={props.onOpenSettings}
          aria-label="설정"
          className="btn-ghost flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg"
        >
          <Settings className="h-4 w-4 text-slate-300" />
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
