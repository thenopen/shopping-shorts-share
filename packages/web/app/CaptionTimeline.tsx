"use client";

import { useState } from "react";
import { CaptionStyle, styleToCss, emphasizeNodes } from "./caption/style";
import { CaptionLineData } from "./caption/types";
import { FONTS } from "./data/fonts";
import { Spinner } from "./ui";
import { Toggle } from "./components/ui/Toggle";

// CaptionLineData 정의는 ./caption/types 로 이동. 기존 import 경로("./CaptionTimeline") 호환 위해 재노출.
export type { CaptionLineData } from "./caption/types";

// AI 자막 다듬기 방향. ai=false는 결정형(즉시·무료), ai=true는 Gemini 재작성.
const EDIT_DIRECTIONS: { key: string; label: string; ai: boolean; hint: string }[] = [
  { key: "shorter", label: "더 짧게", ai: false, hint: "규칙으로 즉시 더 짧게 재분할" },
  { key: "longer", label: "더 길게", ai: false, hint: "규칙으로 즉시 더 길게 재분할" },
  { key: "natural", label: "자연스럽게", ai: true, hint: "AI가 번역투를 자연스러운 구어체로" },
  { key: "impact", label: "임팩트", ai: true, hint: "AI가 짧고 강한 후킹 문장으로" },
  { key: "friendly", label: "친근하게", ai: true, hint: "AI가 친근한 구어체 톤으로" },
  { key: "concise", label: "핵심만", ai: true, hint: "AI가 핵심만 압축" },
];

function fmt(t: number) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}

export default function CaptionTimeline({
  lines,
  onChange,
  defaultStyle,
  onGenerate,
  generating,
  hasScript,
  onAiEdit,
  aiEditBusy,
  onUndoEdit,
  canUndoEdit,
}: {
  lines: CaptionLineData[];
  onChange: (lines: CaptionLineData[]) => void;
  defaultStyle: CaptionStyle;
  onGenerate: () => void;
  generating: boolean;
  hasScript: boolean;
  onAiEdit?: (direction: string) => void;
  aiEditBusy?: boolean;
  onUndoEdit?: () => void;
  canUndoEdit?: boolean;
}) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

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
    <div className="glass rounded-[28px] p-7 sm:p-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-[var(--ink)]">자막 타임라인 편집기</div>
          <div className="text-xs text-[var(--ink-soft)]">
            ① <b>자동 자막 생성</b>으로 6~10자 의미단위 자막을 만들고 → ② 아래 <b>AI 다듬기</b>로 방향만 고르거나 → ③ 줄별로 직접 손보세요.
          </div>
        </div>
        <button
          onClick={onGenerate}
          disabled={!hasScript || generating}
          className="btn-grad flex items-center gap-1.5 rounded-full px-5 py-2.5 text-xs font-bold transition disabled:opacity-40"
          title={hasScript ? "" : "먼저 대본을 입력하세요"}
        >
          {generating && <Spinner className="h-3.5 w-3.5 border-white/40 border-t-white" />}
          {generating ? "자막 생성 중..." : lines.length ? "자막 다시 생성" : "자동 자막 생성"}
        </button>
      </div>

      {lines.length > 0 && onAiEdit && (
        <div className="mb-4 rounded-2xl border border-[var(--accent)]/30 bg-white/45 p-3 backdrop-blur">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[var(--ink-soft)]">AI 다듬기 · 방향 선택</span>
            {canUndoEdit && onUndoEdit && (
              <button
                onClick={onUndoEdit}
                disabled={aiEditBusy}
                className="rounded-full bg-white/70 px-3 py-1 text-[11px] font-bold text-[var(--ink-soft)] transition hover:bg-white/90 disabled:opacity-40"
                title="직전 자막으로 되돌리기"
              >
                ↶ 직전으로
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {EDIT_DIRECTIONS.map((d) => (
              <button
                key={d.key}
                onClick={() => onAiEdit(d.key)}
                disabled={aiEditBusy}
                title={d.hint}
                className={`rounded-full px-3 py-1.5 text-xs font-bold transition disabled:opacity-40 ${
                  d.ai ? "bg-[var(--accent-deep)]/10 text-[var(--accent-deep)] hover:bg-[var(--accent-deep)]/20" : "bg-white/70 text-[var(--ink-soft)] hover:bg-white/90"
                }`}
              >
                {d.ai ? "✨ " : ""}{d.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--ink-soft)]">
            {aiEditBusy && <Spinner className="h-3 w-3 flex-none border-[var(--accent)]/40 border-t-[var(--accent-deep)]" />}
            {aiEditBusy ? "자막 다듬는 중…" : "✨ = AI가 문장을 다시 씀(Gemini) · 나머지는 즉시 재분할. 시간/구간은 유지됩니다."}
          </div>
        </div>
      )}

      {lines.length === 0 ? (
        <p className="rounded-2xl bg-white/40 px-4 py-8 text-center text-xs text-[var(--ink-soft)] backdrop-blur">
          아직 자막이 없습니다. <b>자동 자막 생성</b>을 누르면 대본이 타임코드에 맞춰
          줄 단위로 분할됩니다. 이후 각 줄을 수정할 수 있어요.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {lines.map((ln, i) => {
            const eff = ln.style || defaultStyle;
            const hasOverride = ln.style != null;
            return (
              <div
                key={i}
                className="rounded-2xl border border-white/50 bg-white/55 p-3 backdrop-blur"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {/* 시간 조정 */}
                  <div className="flex items-center gap-1 rounded-full bg-white/70 px-2 py-1 text-xs font-semibold text-[var(--ink-soft)]">
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      value={ln.start}
                      onChange={(e) => patch(i, { start: +e.target.value })}
                      className="w-14 rounded bg-transparent text-right outline-none"
                      aria-label="시작 시간(초)"
                    />
                    <span className="opacity-50">→</span>
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      value={ln.end}
                      onChange={(e) => patch(i, { end: +e.target.value })}
                      className="w-14 rounded bg-transparent outline-none"
                      aria-label="끝 시간(초)"
                    />
                    <span className="ml-1 rounded-full bg-[var(--c-violet)]/40 px-1.5 text-[10px] text-[var(--ink)]">
                      {Math.max(0, ln.end - ln.start).toFixed(1)}s
                    </span>
                  </div>

                  {/* 텍스트 내용 수정 */}
                  <input
                    value={ln.text}
                    onChange={(e) => patch(i, { text: e.target.value })}
                    className="min-w-0 flex-1 rounded-xl border border-white/50 bg-white/80 px-3 py-1.5 text-sm text-[var(--ink)] outline-none focus:bg-white"
                    placeholder="자막 내용"
                  />

                  {/* 줄별 스타일 토글 */}
                  {hasOverride ? (
                    <button
                      onClick={() => (editingIdx === i ? setEditingIdx(null) : setEditingIdx(i))}
                      className="rounded-full bg-[var(--accent-deep)] px-3 py-1.5 text-xs font-bold text-white"
                      title="이 줄 전용 스타일 (펼치기/접기)"
                    >
                      스타일 {editingIdx === i ? "▴" : "▾"}
                    </button>
                  ) : (
                    <button
                      onClick={() => enableLineStyle(i)}
                      className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-[var(--accent-deep)] hover:bg-white/90"
                      title="이 줄만 다른 스타일 적용"
                    >
                      + 스타일
                    </button>
                  )}

                  <button
                    onClick={() => delLine(i)}
                    className="rounded-full px-2 py-1.5 text-xs text-[var(--ink-soft)] hover:bg-rose-100/70 hover:text-rose-500"
                    title="줄 삭제"
                  >
                    ✕
                  </button>
                </div>

                {/* 줄 미리보기(효과 적용 — 실제 영상 자막과 동일 룩) */}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] text-[var(--ink-soft)]">미리보기</span>
                  <div className="flex flex-1 items-center justify-center overflow-hidden rounded-lg py-3" style={{ background: "#3a3f4a" }}>
                    <span style={{ ...styleToCss(eff), fontSize: Math.min(40, Math.max(22, eff.size / 1.7)) }}>
                      {ln.text ? emphasizeNodes(ln.text, eff) : "미리보기"}
                    </span>
                  </div>
                </div>

                {/* 줄별 스타일 인라인 편집 */}
                {hasOverride && editingIdx === i && (
                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-white/50 p-3 sm:grid-cols-4">
                    <label className="col-span-2 text-xs font-bold text-[var(--ink-soft)] sm:col-span-4">
                      이 줄 전용 스타일
                      <button
                        onClick={() => resetLineStyle(i)}
                        className="ml-2 rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-[var(--ink-soft)] hover:bg-white/90"
                      >
                        기본 스타일로 되돌리기
                      </button>
                    </label>
                    <div className="col-span-2">
                      <div className="mb-1 text-[11px] text-[var(--ink-soft)]">폰트</div>
                      <select
                        value={eff.font}
                        onChange={(e) => setLineStyle(i, "font", e.target.value)}
                        className="w-full rounded-lg border border-white/50 bg-white/80 px-2 py-1 text-xs"
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
                      <div className="mb-1 text-[11px] text-[var(--ink-soft)]">크기 {eff.size}</div>
                      <input
                        type="range"
                        min={16}
                        max={120}
                        value={eff.size}
                        onChange={(e) => setLineStyle(i, "size", +e.target.value)}
                        className="w-full accent-[var(--accent-deep)]"
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] text-[var(--ink-soft)]">글자색</div>
                      <input
                        type="color"
                        value={eff.color}
                        onChange={(e) => setLineStyle(i, "color", e.target.value)}
                        className="h-7 w-full cursor-pointer rounded border border-white/60"
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
                          className="h-7 w-9 cursor-pointer rounded border border-white/60"
                          title="글로우 색"
                        />
                      )}
                      {eff.box && (
                        <input
                          type="color"
                          value={eff.boxColor}
                          onChange={(e) => setLineStyle(i, "boxColor", e.target.value)}
                          className="h-7 w-9 cursor-pointer rounded border border-white/60"
                          title="박스 색"
                        />
                      )}
                    </div>
                    {/* 자막 세로 위치 */}
                    <div className="col-span-2 flex items-center gap-1.5 sm:col-span-4">
                      <span className="text-xs font-semibold text-[var(--ink-soft)]">위치</span>
                      {([["top", "위"], ["middle", "중간"], ["bottom", "아래"]] as const).map(([v, lbl]) => (
                        <Toggle key={v} on={(eff.posV ?? "bottom") === v} onClick={() => setLineStyle(i, "posV", v)} label={lbl} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <button
            onClick={addLine}
            className="mt-1 rounded-2xl border border-dashed border-[var(--accent)]/50 bg-white/30 py-2.5 text-xs font-bold text-[var(--accent-deep)] transition hover:bg-white/60"
          >
            + 줄 추가
          </button>
        </div>
      )}
    </div>
  );
}

