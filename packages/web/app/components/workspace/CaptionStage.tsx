"use client";

// Vrew식 자막 세그먼트 리스트(워크스페이스 중앙) — 기존 CaptionTimeline의 편집 로직을
// proto-vrew 룩으로 이식. 프리뷰 currentTime과 활성 줄 싱크 + 줄 클릭 시 시크.
import { useEffect, useRef, useState } from "react";
import { Captions, ChevronsDownUp, ChevronsUpDown, Info, Plus, RefreshCw, Undo2, X } from "lucide-react";
import { CaptionStyle, styleToCss, emphasizeNodes } from "../../caption/style";
import { CaptionLineData } from "../../caption/types";
import { FONTS } from "../../data/fonts";
import { Spinner, Switch } from "../../ui";
import { Toggle } from "../ui/Toggle";

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
}) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

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

  function addLine() {
    const last = lines[lines.length - 1];
    const start = last ? last.end : 0;
    onChange([...lines, { text: "새 자막", start, end: start + 2, style: null }]);
  }

  // TODO(bug/개선트랙): key={i}·editingIdx가 위치 기반 — 위 줄 삭제/삽입 시 열린 스타일패널·포커스가
  //   다른 줄에 붙음. 줄마다 stable id 부여(key+editingIdx)로 고치거나, 최소한 삭제 idx가 editingIdx보다
  //   위면 editingIdx를 1 줄일 것.
  function delLine(i: number) {
    onChange(lines.filter((_, idx) => idx !== i));
    if (editingIdx === i) setEditingIdx(null);
  }

  // 줄별 스타일 override 시작 = 기본스타일 복사본을 그 줄에 부여
  function enableLineStyle(i: number) {
    patch(i, { style: { ...(lines[i].style || defaultStyle) } });
    setEditingIdx(i);
  }
  function resetLineStyle(i: number) {
    patch(i, { style: null });
    if (editingIdx === i) setEditingIdx(null);
  }
  function setLineStyle<K extends keyof CaptionStyle>(i: number, k: K, v: CaptionStyle[K]) {
    const base = lines[i].style || defaultStyle;
    patch(i, { style: { ...base, [k]: v } });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── 헤더: 제목 + 줄수 + 자동자막 스위치 / AI 다듬기 + 직전으로 + 생성 ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-5 py-2.5">
        <div className="flex items-center gap-2.5 text-[12px]">
          <span className="font-semibold text-slate-100">자막 타임라인</span>
          <span className="text-slate-500">{lines.length}줄</span>
          <span className="flex items-center gap-1.5 text-slate-400">
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
          문구·톤 변경은 <b className="text-slate-400">대본 단계</b>에서 — 자막은 성우 음성과 맞춰져 있어요. 여기선 <b className="text-slate-400">타이밍·줄나눔·스타일</b>만.
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
              const eff = ln.style || defaultStyle;
              const hasOverride = ln.style != null;
              const active = i === activeIdx;
              return (
                <div
                  key={i}
                  ref={(el) => { rowRefs.current[i] = el; }}
                  onClick={(e) => {
                    // 입력 요소 클릭은 편집 — 줄 배경 클릭만 시크
                    if ((e.target as HTMLElement).closest("input,select,button,textarea,label")) return;
                    onSeek(ln.start);
                  }}
                  className={`mb-2 cursor-pointer rounded-xl border border-[var(--line)] px-3 py-2.5 transition ${
                    active ? "seg-active" : "bg-[var(--panel-2)] hover:bg-white/5"
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
                      {/* 단어 칩(표시용) */}
                      <div className="flex flex-wrap items-center gap-1">
                        {ln.text.split(/\s+/).filter(Boolean).map((w, wi) => (
                          <span key={wi} className="rounded-md border border-[var(--line)] bg-white/5 px-1.5 py-0.5 text-[12px] text-slate-200">
                            {w}
                          </span>
                        ))}
                      </div>

                      {/* 실제 자막 렌더(효과 적용 축소판 — 최종 영상과 동일 룩) */}
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500">
                        <Captions className="h-3 w-3 flex-none" />
                        <span style={{ ...styleToCss(eff), fontSize: Math.min(20, eff.size * 0.35) }}>
                          {ln.text ? emphasizeNodes(ln.text, eff) : "미리보기"}
                        </span>
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
                          onChange={(e) => patch(i, { text: e.target.value })}
                          className="field min-w-0 flex-1 rounded-lg px-3 py-1 text-sm outline-none"
                          placeholder="자막 내용"
                        />
                      </div>
                    </div>

                    {/* 우측: 줄 스타일 토글 + 삭제 */}
                    <div className="flex flex-none flex-col items-end gap-1">
                      {hasOverride ? (
                        <button
                          onClick={() => (editingIdx === i ? setEditingIdx(null) : setEditingIdx(i))}
                          className="rounded-lg bg-pink-500/15 px-2 py-1 text-[11px] font-semibold text-pink-400 ring-1 ring-pink-500/30 transition hover:bg-pink-500/25"
                          title="이 줄 전용 스타일 (펼치기/접기)"
                        >
                          스타일 {editingIdx === i ? "▴" : "▾"}
                        </button>
                      ) : (
                        <button
                          onClick={() => enableLineStyle(i)}
                          className="rounded-lg bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-400 ring-1 ring-[var(--line)] transition hover:bg-white/10 hover:text-pink-400"
                          title="이 줄만 다른 스타일 적용"
                        >
                          + 스타일
                        </button>
                      )}
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

                  {/* 줄별 스타일 인라인 편집 */}
                  {hasOverride && editingIdx === i && (
                    <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-white/5 p-3 ring-1 ring-[var(--line)] sm:grid-cols-4">
                      <label className="col-span-2 text-xs font-bold text-slate-300 sm:col-span-4">
                        이 줄 전용 스타일
                        <button
                          onClick={() => resetLineStyle(i)}
                          className="btn-ghost ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        >
                          기본 스타일로 되돌리기
                        </button>
                      </label>
                      <div className="col-span-2">
                        <div className="mb-1 text-[11px] text-slate-400">폰트</div>
                        <select
                          value={eff.font}
                          onChange={(e) => setLineStyle(i, "font", e.target.value)}
                          className="field w-full rounded-lg px-2 py-1 text-xs outline-none"
                          style={{ fontFamily: eff.font }}
                        >
                          {FONTS.map((f) => (
                            <option key={f.css} value={f.css} style={{ fontFamily: f.css }}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] text-slate-400">크기 {eff.size}</div>
                        <input
                          type="range"
                          min={16}
                          max={120}
                          value={eff.size}
                          onChange={(e) => setLineStyle(i, "size", +e.target.value)}
                          className="w-full accent-pink-500"
                        />
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] text-slate-400">글자색</div>
                        <input
                          type="color"
                          value={eff.color}
                          onChange={(e) => setLineStyle(i, "color", e.target.value)}
                          className="h-7 w-full cursor-pointer rounded border border-[var(--line)] bg-transparent"
                        />
                      </div>
                      <div className="col-span-2 flex flex-wrap gap-1.5 sm:col-span-4">
                        <Toggle on={eff.bold} onClick={() => setLineStyle(i, "bold", !eff.bold)} label="굵게" />
                        <Toggle on={eff.italic} onClick={() => setLineStyle(i, "italic", !eff.italic)} label="기울임" />
                        <Toggle on={eff.outline} onClick={() => setLineStyle(i, "outline", !eff.outline)} label="외곽선" />
                        <Toggle on={eff.shadow} onClick={() => setLineStyle(i, "shadow", !eff.shadow)} label="그림자" />
                        <Toggle on={eff.glow} onClick={() => setLineStyle(i, "glow", !eff.glow)} label="글로우" />
                        <Toggle on={eff.box} onClick={() => setLineStyle(i, "box", !eff.box)} label="박스" />
                        {eff.glow && (
                          <input
                            type="color"
                            value={eff.glowColor}
                            onChange={(e) => setLineStyle(i, "glowColor", e.target.value)}
                            className="h-7 w-9 cursor-pointer rounded border border-[var(--line)] bg-transparent"
                            title="글로우 색"
                          />
                        )}
                        {eff.box && (
                          <input
                            type="color"
                            value={eff.boxColor}
                            onChange={(e) => setLineStyle(i, "boxColor", e.target.value)}
                            className="h-7 w-9 cursor-pointer rounded border border-[var(--line)] bg-transparent"
                            title="박스 색"
                          />
                        )}
                      </div>
                      {/* 자막 세로 위치 */}
                      <div className="col-span-2 flex items-center gap-1.5 sm:col-span-4">
                        <span className="text-xs font-semibold text-slate-400">위치</span>
                        {([["top", "위"], ["middle", "중간"], ["bottom", "아래"]] as const).map(([v, lbl]) => (
                          <Toggle key={v} on={(eff.posV ?? "bottom") === v} onClick={() => setLineStyle(i, "posV", v)} label={lbl} />
                        ))}
                      </div>
                    </div>
                  )}
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
