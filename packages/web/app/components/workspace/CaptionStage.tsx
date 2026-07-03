"use client";

// Vrew식 자막 세그먼트 리스트(워크스페이스 중앙) — 기존 CaptionTimeline의 편집 로직을
// proto-vrew 룩으로 이식. 프리뷰 currentTime과 활성 줄 싱크 + 줄 클릭 시 시크.
import { useEffect, useRef } from "react";
import { Captions, ChevronsDownUp, ChevronsUpDown, Info, Lock, LockOpen, Plus, RefreshCw, Undo2, X } from "lucide-react";
import { CaptionStyle, splitWords, autoEmphIndices } from "../../caption/style";
import { CaptionLineData } from "../../caption/types";
import { Spinner, Switch } from "../../ui";

// 줄 나누기(재분할) — 같은 단어를 줄바꿈만 다시(음성과 안 어긋남, 즉시·무료).
// 문구·톤 재작성은 대본 단계 다이얼로 이동함(자막을 AI로 바꾸면 성우 음성과 desync).
const SPLIT_DIRECTIONS: { key: string; label: string; icon: typeof ChevronsDownUp; hint: string }[] = [
  { key: "shorter", label: "촘촘히", icon: ChevronsDownUp, hint: "같은 문장을 더 짧은 줄로 재분할" },
  { key: "longer", label: "넓게", icon: ChevronsUpDown, hint: "같은 문장을 더 긴 줄로 재분할" },
];

function fmt(t: number) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}

export function CaptionStage({
  lines,
  onChange,
  defaultStyle,
  captionsOn,
  setCaptionsOn,
  onGenerate,
  generating,
  hasScript,
  onAiEdit,
  aiEditBusy,
  onUndoEdit,
  canUndoEdit,
  currentTime,
  onSeek,
  selected,
  onSelect,
  onToggleLock,
}: {
  lines: CaptionLineData[];
  onChange: (l: CaptionLineData[]) => void;
  defaultStyle: CaptionStyle;
  captionsOn: boolean; setCaptionsOn: (b: boolean) => void;
  onGenerate: () => void; generating: boolean; hasScript: boolean;
  onAiEdit: (dir: string) => void; aiEditBusy: boolean;
  onUndoEdit: () => void; canUndoEdit: boolean;
  currentTime: number;              // PreviewPane video 현재 초
  onSeek: (t: number) => void;      // 줄 클릭 → 프리뷰 시크
  selected: number | null;          // 선택된 줄(우측 패널·드래그 대상)
  onSelect: (i: number | null) => void;    // 줄 선택(null=해제)
  onToggleLock: (i: number) => void; // 줄 스타일 잠금(독립)/해제(전체 따름)
}) {
  // ── 활성 줄 싱크: currentTime ∈ [start,end) 줄만 seg-active + 보이게 스크롤 ──
  const activeIdx = lines.findIndex((l) => currentTime >= l.start && currentTime < l.end);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const prevActive = useRef(-1);
  useEffect(() => {
    if (activeIdx === prevActive.current) return; // activeIdx가 바뀔 때만 스크롤
    prevActive.current = activeIdx;
    if (activeIdx >= 0) rowRefs.current[activeIdx]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIdx]);

  function patch(i: number, p: Partial<CaptionLineData>) {
    onChange(lines.map((l, idx) => (idx === i ? { ...l, ...p } : l)));
  }

  // 단어 강조 토글 — emph 없으면 자동강조 셋에서 시작(사용자가 가감). 이후 명시적 인덱스.
  function toggleEmph(i: number, wi: number) {
    const ln = lines[i];
    const set = new Set(ln.emph ?? autoEmphIndices(ln.text));
    if (set.has(wi)) set.delete(wi); else set.add(wi);
    patch(i, { emph: Array.from(set).sort((a, b) => a - b) });
  }

  // 텍스트 편집 시: 단어 타임스탬프(words) 무효화(→애니 정적 폴백), 단어수 바뀌면 emph도 초기화.
  function editText(i: number, t: string) {
    const same = splitWords(t).length === splitWords(lines[i].text).length;
    patch(i, same ? { text: t, words: null } : { text: t, words: null, emph: null });
  }

  function addLine() {
    const last = lines[lines.length - 1];
    const start = last ? last.end : 0;
    onChange([...lines, { text: "새 자막", start, end: start + 2, style: null }]);
  }

  function delLine(i: number) {
    onChange(lines.filter((_, idx) => idx !== i));
    // 선택이 위치(index) 기반 — 삭제로 인덱스가 당겨지면 보정, 삭제된 줄이면 해제
    if (selected != null) {
      if (selected === i) onSelect(null);
      else if (selected > i) onSelect(selected - 1);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── 헤더: 제목 + 줄수 + 자동자막 스위치 / AI 다듬기 + 직전으로 + 생성 ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-5 py-2.5">
        <div className="flex items-center gap-2.5 text-[12px]">
          <span className="font-semibold text-slate-100">자막 타임라인</span>
          <span className="text-slate-500">{lines.length}줄</span>
          <span className="flex items-center gap-1.5 text-slate-400" title="끄면 최종 영상에 자막을 넣지 않아요">
            <Switch on={captionsOn} onToggle={() => setCaptionsOn(!captionsOn)} ariaLabel="자동 자막 켜기/끄기" />
            자동 자막
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
          {lines.length > 0 && (
            <>
              <span className="text-slate-500">줄 나누기</span>
              {SPLIT_DIRECTIONS.map((d) => {
                const Icon = d.icon;
                return (
                  <button
                    key={d.key}
                    onClick={() => onAiEdit(d.key)}
                    disabled={aiEditBusy}
                    title={d.hint}
                    className="btn-ghost flex items-center gap-1 rounded-lg px-2.5 py-1.5 transition disabled:opacity-40"
                  >
                    <Icon className="h-3.5 w-3.5 text-slate-400" />
                    {d.label}
                  </button>
                );
              })}
              {aiEditBusy && <Spinner className="h-3 w-3 border-pink-500/40 border-t-pink-500" />}
              <button
                onClick={onUndoEdit}
                disabled={!canUndoEdit || aiEditBusy}
                title="직전 자막으로 되돌리기"
                className="btn-ghost flex items-center gap-1 rounded-lg px-2.5 py-1.5 transition disabled:opacity-40"
              >
                <Undo2 className="h-3.5 w-3.5" />
                직전으로
              </button>
              <span className="mx-0.5 h-4 w-px bg-[var(--line)]" />
            </>
          )}
          <button
            onClick={onGenerate}
            disabled={!hasScript || generating}
            title={hasScript ? "" : "먼저 대본을 입력하세요"}
            className="btn-primary flex items-center gap-1 rounded-lg px-3 py-1.5 transition"
          >
            {generating ? (
              <Spinner className="h-3.5 w-3.5 border-white/40 border-t-white" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {generating ? "자막 생성 중..." : lines.length ? "자막 다시 생성" : "자동 자막 생성"}
          </button>
        </div>
      </div>

      {/* 정합성 안내 — 문구·톤은 대본에서(자막을 AI로 바꾸면 성우 음성과 어긋남) */}
      {lines.length > 0 && (
        <div className="flex items-center gap-1.5 border-b border-[var(--line)] bg-white/[.02] px-5 py-1.5 text-[11px] text-slate-500">
          <Info className="h-3 w-3 flex-none" />
          <span><b className="text-slate-400">단어를 눌러</b> 강조(노랑)를 켜고 끌 수 있어요. 문구·톤 변경은 <b className="text-slate-400">대본 단계</b>에서 — 자막은 성우 음성과 맞춰져 있어요.</span>
        </div>
      )}

      {/* ── 세그먼트 리스트 ── */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {lines.length === 0 ? (
          // 빈 상태
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            {hasScript ? (
              <>
                <p className="text-[13px] text-slate-400">
                  <b className="text-slate-200">자동 자막 생성</b>을 누르면 대본이 타임코드로 분할됩니다
                </p>
                <button
                  onClick={onGenerate}
                  disabled={generating}
                  className="btn-primary flex items-center gap-2 rounded-xl px-6 py-3 text-sm"
                >
                  {generating ? (
                    <Spinner className="h-4 w-4 border-white/40 border-t-white" />
                  ) : (
                    <Captions className="h-4 w-4" />
                  )}
                  {generating ? "자막 생성 중..." : "자동 자막 생성"}
                </button>
              </>
            ) : (
              <p className="text-[13px] text-slate-500">먼저 대본을 만들어 주세요</p>
            )}
          </div>
        ) : (
          <div>
            {lines.map((ln, i) => {
              const hasOverride = ln.style != null;   // = 잠금(전체 변경에 안 바뀜)
              const active = i === activeIdx;
              const isSel = i === selected;
              return (
                <div
                  key={i}
                  ref={(el) => { rowRefs.current[i] = el; }}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("input,select,button,textarea,label")) return;
                    onSelect(i);       // 줄 선택(우측 패널·드래그 대상)
                    onSeek(ln.start);
                  }}
                  className={`mb-2 cursor-pointer rounded-xl border px-3 py-2.5 transition ${
                    isSel ? "border-amber-400/60 bg-amber-400/5 ring-1 ring-amber-400/40"
                      : active ? "seg-active border-[var(--line)]"
                        : "border-[var(--line)] bg-[var(--panel-2)] hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* 줄 번호 */}
                    <span className="mt-0.5 w-4 flex-none text-right text-[11px] font-semibold text-slate-500">{i + 1}</span>

                    {/* 시간 배지(썸네일 자리) */}
                    <div className="flex h-14 w-14 flex-none flex-col items-center justify-center gap-0.5 rounded-md bg-white/5 text-[10px] text-slate-400 ring-1 ring-[var(--line)]">
                      <span>{fmt(ln.start)}</span>
                      <span className="rounded bg-white/5 px-1 text-slate-500">+{Math.max(0, ln.end - ln.start).toFixed(1)}초</span>
                    </div>

                    <div className="min-w-0 flex-1">
                      {/* 단어 칩 — 클릭해서 강조 켜고 끄기(노랑=강조). 최종 룩은 왼쪽 프리뷰. */}
                      <div className="flex flex-wrap items-center gap-1">
                        {(() => {
                          const emphSet = new Set(ln.emph ?? autoEmphIndices(ln.text));
                          return splitWords(ln.text).map((w, wi) => {
                            const on = emphSet.has(wi);
                            return (
                              <button
                                key={wi}
                                onClick={(e) => { e.stopPropagation(); toggleEmph(i, wi); }}
                                title={on ? "강조 끄기" : "이 단어 강조"}
                                className={`rounded-md border px-1.5 py-0.5 text-[12px] transition ${
                                  on
                                    ? "border-yellow-400/50 bg-yellow-400/15 font-bold text-yellow-300"
                                    : "border-[var(--line)] bg-white/5 text-slate-200 hover:border-yellow-400/40 hover:text-yellow-200"
                                }`}
                              >
                                {w}
                              </button>
                            );
                          });
                        })()}
                      </div>

                      {/* 시간·텍스트 편집 행 */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <input
                          type="number"
                          step={0.1}
                          min={0}
                          value={ln.start}
                          onChange={(e) => patch(i, { start: +e.target.value })}
                          className="field w-16 rounded-lg px-2 py-1 text-[12px] outline-none"
                          aria-label="시작 시간(초)"
                        />
                        <span className="text-slate-600">→</span>
                        <input
                          type="number"
                          step={0.1}
                          min={0}
                          value={ln.end}
                          onChange={(e) => patch(i, { end: +e.target.value })}
                          className="field w-16 rounded-lg px-2 py-1 text-[12px] outline-none"
                          aria-label="끝 시간(초)"
                        />
                        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                          {Math.max(0, ln.end - ln.start).toFixed(1)}s
                        </span>
                        <input
                          value={ln.text}
                          onChange={(e) => editText(i, e.target.value)}
                          className="field min-w-0 flex-1 rounded-lg px-3 py-1 text-sm outline-none"
                          placeholder="자막 내용"
                        />
                      </div>
                    </div>

                    {/* 우측: 잠금(전체 변경 면제) + 삭제 */}
                    <div className="flex flex-none flex-col items-end gap-1">
                      <button
                        onClick={() => onToggleLock(i)}
                        title={hasOverride ? "잠금 해제 — 전체 스타일 따름" : "잠금 — 이 줄 스타일 고정(전체 변경에 안 바뀜)"}
                        aria-label="스타일 잠금"
                        className={`rounded-lg p-1.5 transition ${hasOverride ? "bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/30" : "text-slate-500 hover:bg-white/10 hover:text-slate-300"}`}
                      >
                        {hasOverride ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => delLine(i)}
                        className="rounded p-1 text-slate-600 transition hover:bg-white/10 hover:text-rose-400"
                        title="줄 삭제"
                        aria-label="줄 삭제"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* 줄 추가 */}
            <button
              onClick={addLine}
              className="mt-1 flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-pink-500/40 bg-white/[.02] py-2.5 text-xs font-bold text-pink-400 transition hover:bg-white/5"
            >
              <Plus className="h-3.5 w-3.5" />
              줄 추가
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
