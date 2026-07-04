"use client";

import { useState } from "react";
import {
  Check, CircleAlert, Copy, Eye, FileText, ImagePlus, Mic, MicOff,
  Pencil, Redo2, RefreshCw, ShoppingBag, Sparkles, Undo2, X, Zap,
} from "lucide-react";
import { Spinner } from "../../ui";
import { JobState } from "../../lib/types";
import { parsePoints } from "../../lib/format";

// 대본 AI 가공 8방향(8각 다이얼) — 백엔드 refine.SCRIPT_DIRECTIONS 키와 동일.
const REFINE_DIRECTIONS: { key: string; label: string; hint: string }[] = [
  { key: "hook",     label: "후킹",   hint: "첫 3초 시선 강탈형 도입으로" },
  { key: "impact",   label: "임팩트", hint: "짧고 강한 문장, 군더더기 제거" },
  { key: "urgency",  label: "긴박",   hint: "지금 봐야 할 이유 (없는 할인은 안 지어냄)" },
  { key: "humor",    label: "유머",   hint: "가벼운 위트 한 스푼" },
  { key: "story",    label: "스토리", hint: "직접 써본 경험담 흐름으로" },
  { key: "friendly", label: "친근",   hint: "친구가 알려주는 톤(반말 살짝)" },
  { key: "trust",    label: "신뢰",   hint: "담백한 정보·근거 중심" },
  { key: "concise",  label: "간결",   hint: "핵심만 남기고 압축" },
];

// 대본 스테이지 — 소스(제품 링크 · 영상 받아쓰기 · 직접 입력) → 소구포인트 → 대본 에디터.
// API 호출/상태 로직은 전부 props 주입(useProductScript·useScriptHistory 반환 그대로) — 여기선 표시만.
export function ScriptStage(props: {
  script: string;
  onChangeScript: (v: string) => void;   // dirty 마킹 포함된 핸들러
  onFocusScript: () => void; onBlurScript: () => void;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
  onRefine: (direction?: string) => void; refineBusy: boolean;
  onGenFromVideo: () => void; scriptBusy: boolean;   // 영상 음성→대본(transcribe)
  job: JobState | null;
  // 목표 길이(duration-first) + 예상 발화 길이 미터
  estSec: number | null;                 // 현재 대본 예상 길이(초, rate 반영)
  rate: number;
  cpsNote: string;                       // CPS 보정 상태(툴팁) — 추정vs실측 불일치 이유 안내
  targetSec: number | null;              // 명시 목표(초). null = 원본 영상 길이에 맞춤
  setTargetSec: (n: number | null) => void;
  videoDur: number | null;               // 원본 영상 길이(자동 옵션 라벨용)
  onFitLength: () => void;               // AI로 목표 초수에 맞게 줄이기/맞추기
  // 훅(첫 문장) 후보 택1
  hookCands: string[]; hooksBusy: boolean;
  onFetchHooks: () => void; onApplyHook: (h: string) => void; onClearHooks: () => void;
  // 제품 소구포인트(useProductScript 반환 그대로)
  productUrl: string; setProductUrl: (v: string) => void;
  productImages: string[]; setProductImages: React.Dispatch<React.SetStateAction<string[]>>;
  sellingPoints: string; setSellingPoints: (v: string) => void;
  productBusy: boolean; productErr: string; productMsg: string; productStage: string;
  pointsEdit: boolean; setPointsEdit: (b: boolean) => void;
  addImageFiles: (f: FileList | File[] | null) => void;
  onProductPaste: (e: React.ClipboardEvent) => void;
  onGenerateProduct: (opts?: { fromPoints?: boolean }) => void;
}) {
  const {
    script, onChangeScript, onFocusScript, onBlurScript,
    canUndo, canRedo, onUndo, onRedo,
    onRefine, refineBusy, onGenFromVideo, scriptBusy, job,
    productUrl, setProductUrl, productImages, setProductImages,
    sellingPoints, setSellingPoints, productBusy, productErr, productMsg, productStage,
    pointsEdit, setPointsEdit, addImageFiles, onProductPaste, onGenerateProduct,
    estSec, rate, cpsNote, targetSec, setTargetSec, videoDur, onFitLength,
    hookCands, hooksBusy, onFetchHooks, onApplyHook, onClearHooks,
  } = props;
  // 목표 대비 예상 길이 상태: ok(±10%) / over / under — 미터 색과 '맞추기' 버튼 노출 결정
  const effTarget = targetSec ?? videoDur ?? null;
  const lenState = estSec == null || effTarget == null
    ? "none"
    : estSec > effTarget * 1.1 ? "over" : estSec < effTarget * 0.85 ? "under" : "ok";
  const [productOpen, setProductOpen] = useState(true);  // 소스 기본 = 제품 링크 패널 열림
  const [dialOpen, setDialOpen] = useState(false);       // AI 가공 8각 다이얼 팝오버
  const [hovered, setHovered] = useState<string | null>(null);  // 다이얼 hover 방향(힌트 표시)
  const { cat, points } = parsePoints(sellingPoints);
  const hoveredDir = REFINE_DIRECTIONS.find((d) => d.key === hovered);

  const pickDirection = (key?: string) => {
    setDialOpen(false);
    onRefine(key);
  };

  // 목표 길이 칩 — 생성(제품 패널)과 에디터(미터 행) 두 곳에서 공용. 같은 targetSec 상태.
  const targetChips = (
    <>
      {[20, 30, 45].map((s) => (
        <button
          key={s}
          onClick={() => setTargetSec(targetSec === s ? null : s)}
          title={`대본 생성·줄이기가 약 ${s}초 분량을 목표로 해요`}
          className={`rounded-full px-2.5 py-1 transition ${
            targetSec === s
              ? "bg-pink-500/15 text-pink-400 ring-1 ring-pink-500/30"
              : "bg-white/5 text-slate-400 ring-1 ring-[var(--line)] hover:bg-white/10"
          }`}
        >
          {s}초
        </button>
      ))}
      <button
        onClick={() => setTargetSec(null)}
        title="원본 영상 길이에 맞춤"
        className={`rounded-full px-2.5 py-1 transition ${
          targetSec == null
            ? "bg-pink-500/15 text-pink-400 ring-1 ring-pink-500/30"
            : "bg-white/5 text-slate-400 ring-1 ring-[var(--line)] hover:bg-white/10"
        }`}
      >
        영상 길이{videoDur ? ` (${Math.round(videoDur)}초)` : ""}
      </button>
    </>
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {/* 헤더 + 대본 소스 선택(제품 링크 / 영상 받아쓰기 / 직접 입력은 아래 에디터) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-100">대본 만들기</h2>
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium">
          <button
            onClick={() => setProductOpen((v) => !v)}
            title="상품 상세페이지 링크·캡처에서 소구포인트를 뽑아 대본을 만들어요"
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition ${
              productOpen
                ? "bg-pink-500/15 text-pink-400 ring-1 ring-pink-500/30"
                : "btn-ghost text-slate-300"
            }`}
          >
            <ShoppingBag className="h-3.5 w-3.5" /> 제품 링크로
          </button>
          <button
            onClick={onGenFromVideo}
            disabled={scriptBusy || !job?.id}
            title={
              job?.id
                ? "영상에 한국어/중국어 음성이 있을 때만 유용해요 (무음·BGM만이면 빈 대본)"
                : "먼저 소스 단계에서 영상 링크를 분석하세요"
            }
            className="btn-ghost flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
          >
            {scriptBusy ? <Spinner className="h-3.5 w-3.5 border-pink-500/40 border-t-pink-500" /> : <Mic className="h-3.5 w-3.5 text-blue-400" />}
            {scriptBusy ? "받아쓰는 중…" : "영상 음성 받아쓰기"}
          </button>
        </div>
      </div>

      {/* 제품 소구포인트 — 상세페이지 링크/캡처 → 대본 결합. Ctrl+V 캡처 붙여넣기 지원 */}
      {productOpen && (
        <div className="panel rounded-2xl p-4" onPaste={onProductPaste}>
          <div className="mb-1 text-[13px] font-semibold text-slate-100">
            제품 링크 <span className="font-normal text-slate-500">(선택 · 영상에 맞는 상품 상세페이지)</span>
          </div>
          <p className="mb-3 text-[12px] leading-relaxed text-slate-400">
            {script.trim()
              ? "영상 내용 + 제품 소구포인트를 결합해 대본을 만들어요. 제품명은 직접 말하지 않아요."
              : "제품 소구포인트만으로 대본을 만들어요. (영상을 먼저 분석하면 영상 내용과 결합돼요.) 제품명은 직접 말하지 않아요."}
          </p>
          <div className="flex flex-col gap-2 md:flex-row">
            <input
              value={productUrl}
              onChange={(e) => setProductUrl(e.target.value)}
              placeholder="스마트스토어 / 올리브영 / 쿠팡 상품 링크"
              className="field min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
            />
            <button
              onClick={() => onGenerateProduct()}
              disabled={productBusy}
              className="btn-primary flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm"
            >
              {productBusy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
              {productBusy ? "분석 중…" : "소구포인트 → 대본"}
            </button>
          </div>

          {/* 대본 길이 설정 — 생성 시점에 정함(분량 역산). 에디터의 목표 길이와 같은 상태 */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
            <span className="text-slate-500">대본 길이</span>
            {targetChips}
            <span className="text-slate-600">— 이 분량에 맞춰 생성돼요</span>
          </div>

          {/* 진행 힌트 칩 — 크롤이 수십 초 걸릴 수 있어 단계 문구 순환 */}
          {productBusy && productStage && (
            <div className="mt-2.5 flex items-center gap-2 rounded-lg panel-2 px-3 py-2 text-[12px] font-medium text-slate-300">
              <Spinner className="h-3.5 w-3.5 flex-none border-pink-500/40 border-t-pink-500" />
              {productStage} <span className="text-slate-500">· 상세페이지가 크면 수십 초 걸려요</span>
            </div>
          )}

          {/* 캡처 업로드(여러 장) — 파일 선택 또는 Ctrl+V. 쿠팡 등 크롤 차단 사이트 폴백 */}
          <div className="mt-2.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <label
                className={`btn-ghost flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium ${
                  productErr && productImages.length === 0 ? "ring-2 ring-amber-400/60" : ""
                }`}
              >
                <ImagePlus className="h-3.5 w-3.5 text-slate-400" /> 캡처 이미지 올리기
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => { addImageFiles(e.target.files); e.target.value = ""; }}
                />
              </label>
              <span className="text-[11px] text-slate-500">
                또는 캡처 후 이 영역에서 <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">Ctrl+V</kbd> 붙여넣기
              </span>
              {productImages.length > 0 && (
                <button onClick={() => setProductImages([])} className="text-[11px] font-semibold text-rose-400 hover:underline">
                  전체 제거
                </button>
              )}
            </div>
            {productImages.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {productImages.map((src, i) => (
                  <span key={i} className="relative">
                    <img src={src} alt={`제품 캡처 ${i + 1}`} className="h-16 w-16 rounded-lg object-cover ring-1 ring-[var(--line)]" />
                    <button
                      onClick={() => setProductImages((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white shadow"
                      title="제거"
                      aria-label={`캡처 ${i + 1} 제거`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {productErr && (
            <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-rose-500/10 px-3 py-2 text-[12px] font-medium text-rose-400">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 flex-none" /> {productErr}
            </p>
          )}
          {productMsg && !productErr && (
            <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-[12px] font-semibold text-emerald-400">{productMsg}</p>
          )}
        </div>
      )}

      {/* 소구포인트 결과 — 카테고리 칩 + 체크리스트. 편집/복사/대본 다시 */}
      {sellingPoints && (
        <div className="panel rounded-2xl p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-slate-100">추출된 소구포인트</span>
            <div className="flex flex-wrap gap-1.5 text-[11px] font-medium">
              <button onClick={() => setPointsEdit(!pointsEdit)} className="btn-ghost flex items-center gap-1 rounded-lg px-2.5 py-1">
                {pointsEdit ? <Eye className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                {pointsEdit ? "보기" : "편집"}
              </button>
              <button
                onClick={() => navigator.clipboard?.writeText(sellingPoints).catch(() => {})}
                className="btn-ghost flex items-center gap-1 rounded-lg px-2.5 py-1"
              >
                <Copy className="h-3 w-3" /> 복사
              </button>
              <button
                onClick={() => onGenerateProduct({ fromPoints: true })}
                disabled={productBusy}
                title="재크롤 없이 이 소구포인트로 대본만 다시 생성"
                className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1 font-semibold text-emerald-400 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/25 disabled:opacity-40"
              >
                <RefreshCw className="h-3 w-3" /> 대본 다시
              </button>
            </div>
          </div>
          {pointsEdit ? (
            <textarea
              value={sellingPoints}
              onChange={(e) => setSellingPoints(e.target.value)}
              rows={6}
              className="field w-full rounded-lg px-3 py-2 text-xs leading-relaxed outline-none"
            />
          ) : points.length ? (
            <>
              {cat && (
                <span className="mb-2 inline-block rounded-full bg-blue-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-blue-400">{cat}</span>
              )}
              <ul className="space-y-1 text-[12px] text-slate-300">
                {points.map((p, i) => (
                  <li key={i} className="flex gap-1.5">
                    <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-400" />
                    <span className="leading-relaxed">{p}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-slate-300">{sellingPoints}</pre>
          )}
        </div>
      )}

      {/* 한국어 대본 에디터 — AI 가공 + 되돌리기/다시실행(Ctrl+Z / Ctrl+Y·Ctrl+Shift+Z) */}
      <div className="panel rounded-2xl p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-100">
            <FileText className="h-4 w-4 text-pink-500" /> 한국어 대본
          </span>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
            {/* AI 가공 — 8각 다이얼: 방향을 골라 그 톤으로 재작성 (중앙 = 기본 다듬기) */}
            <div className="relative">
              <button
                onClick={() => setDialOpen((v) => !v)}
                disabled={!script.trim() || refineBusy}
                className="flex items-center gap-1 rounded-lg bg-pink-500/15 px-2.5 py-1.5 text-pink-400 ring-1 ring-pink-500/30 transition hover:bg-pink-500/25 disabled:opacity-40"
              >
                {refineBusy ? <Spinner className="h-3 w-3 border-pink-500/40 border-t-pink-400" /> : <Sparkles className="h-3.5 w-3.5" />}
                {refineBusy ? "가공 중…" : "AI로 가공"}
              </button>
              {dialOpen && (
                <>
                  {/* 바깥 클릭 닫기 */}
                  <div className="fixed inset-0 z-20" onClick={() => setDialOpen(false)} />
                  <div className="panel absolute right-0 top-[calc(100%+8px)] z-30 w-[264px] rounded-2xl p-3 shadow-2xl">
                    <p className="mb-1 text-center text-[11px] font-semibold text-slate-300">어느 방향으로 바꿀까요?</p>
                    {/* 8각 다이얼 — 12시부터 시계방향 45° 간격 */}
                    <div className="relative mx-auto" style={{ width: 220, height: 220 }}>
                      {REFINE_DIRECTIONS.map((d, i) => {
                        const ang = (-90 + i * 45) * (Math.PI / 180);
                        const x = 110 + 84 * Math.cos(ang);
                        const y = 110 + 84 * Math.sin(ang);
                        return (
                          <button
                            key={d.key}
                            onClick={() => pickDirection(d.key)}
                            onMouseEnter={() => setHovered(d.key)}
                            onMouseLeave={() => setHovered(null)}
                            title={d.hint}
                            className="absolute flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/5 text-[11px] font-bold text-slate-200 ring-1 ring-[var(--line)] transition hover:bg-pink-500/20 hover:text-pink-300 hover:ring-pink-500/50"
                            style={{ left: x, top: y }}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                      {/* 중앙 = 기본 다듬기(번역투 정리) */}
                      <button
                        onClick={() => pickDirection()}
                        onMouseEnter={() => setHovered("__base")}
                        onMouseLeave={() => setHovered(null)}
                        className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full bg-pink-500/15 text-[10px] font-bold text-pink-400 ring-1 ring-pink-500/40 transition hover:bg-pink-500/25"
                      >
                        <Sparkles className="mb-0.5 h-4 w-4" />
                        기본
                      </button>
                    </div>
                    <p className="mt-1 h-8 text-center text-[11px] leading-snug text-slate-400">
                      {hovered === "__base"
                        ? "번역투 정리 + 자연스러운 구어체 (기본)"
                        : hoveredDir?.hint ?? "방향을 고르면 그 톤으로 대본을 다시 써요. 마음에 안 들면 ↶ 되돌리기."}
                    </p>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={onFetchHooks}
              disabled={!script.trim() || hooksBusy}
              title="첫 문장(훅) 대안 3개를 만들어 골라 교체 — 훅이 조회수의 절반"
              className="btn-ghost flex items-center gap-1 rounded-lg px-2.5 py-1.5"
            >
              {hooksBusy ? <Spinner className="h-3 w-3 border-pink-500/40 border-t-pink-400" /> : <Zap className="h-3.5 w-3.5 text-amber-400" />}
              {hooksBusy ? "훅 뽑는 중…" : "훅 바꾸기"}
            </button>
            <button
              onClick={onUndo}
              disabled={!canUndo}
              title="되돌리기 (Ctrl+Z)"
              aria-label="되돌리기"
              className="btn-ghost rounded-lg p-1.5 text-slate-300"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              title="다시실행 (Ctrl+Y 또는 Ctrl+Shift+Z)"
              aria-label="다시실행"
              className="btn-ghost rounded-lg p-1.5 text-slate-300"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {/* 목표 길이 + 예상 발화 길이 미터 — 길이는 대본 분량으로 정하고 속도는 미세조정(업계 관행) */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
          <span className="text-slate-500">목표 길이</span>
          {targetChips}
          {estSec != null && (
            <span
              className={`ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ring-1 ${
                lenState === "over" ? "bg-amber-400/10 text-amber-300 ring-amber-400/30"
                  : lenState === "ok" ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/25"
                    : "bg-white/5 text-slate-400 ring-[var(--line)]"
              }`}
              title={`공백 제외 글자수 ÷ 성우 말속도 추정.\n${cpsNote}`}
            >
              예상 {estSec >= 60 ? `${Math.floor(estSec / 60)}분 ${Math.round(estSec % 60)}초` : `${Math.round(estSec)}초`} @ {rate.toFixed(1)}x
              {lenState === "over" && effTarget != null && ` · 목표보다 +${Math.round(estSec - effTarget)}초`}
            </span>
          )}
          {lenState === "over" && (
            <button
              onClick={onFitLength}
              disabled={refineBusy}
              title={`AI가 핵심을 유지하며 약 ${Math.round(effTarget ?? 0)}초 분량으로 압축해요`}
              className="rounded-full bg-amber-400/15 px-2.5 py-1 font-semibold text-amber-300 ring-1 ring-amber-400/30 transition hover:bg-amber-400/25 disabled:opacity-40"
            >
              {refineBusy ? "줄이는 중…" : `${Math.round(effTarget ?? 0)}초에 맞게 줄이기`}
            </button>
          )}
        </div>

        {/* 훅 후보 택1 — 클릭하면 대본 첫 문장 교체(Ctrl+Z로 복구 가능) */}
        {hookCands.length > 0 && (
          <div className="mb-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3">
            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold">
              <span className="flex items-center gap-1 text-amber-300"><Zap className="h-3 w-3" /> 훅 후보 — 클릭하면 첫 문장 교체</span>
              <button onClick={onClearHooks} className="text-slate-500 hover:text-slate-300">닫기</button>
            </div>
            <div className="flex flex-col gap-1.5">
              {hookCands.map((h, i) => (
                <button
                  key={i}
                  onClick={() => onApplyHook(h)}
                  className="rounded-lg bg-white/5 px-3 py-2 text-left text-[13px] text-slate-200 ring-1 ring-[var(--line)] transition hover:bg-amber-400/10 hover:ring-amber-400/40"
                >
                  {h}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-slate-500">마음에 안 들면 <b>훅 바꾸기</b>를 다시 눌러 새 후보를 받아요. 교체 후 Ctrl+Z로 복구 가능.</p>
          </div>
        )}

        {job?.status === "transcribed" && job?.has_speech === false && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-amber-400/10 px-3 py-2 text-[12px] font-medium text-amber-400">
            <MicOff className="h-3.5 w-3.5 flex-none" />
            이 영상엔 음성이 없어요 — 대본을 직접 입력하거나 위 <b>제품 링크</b>로 만들어보세요.
          </div>
        )}
        <textarea
          value={script}
          onChange={(e) => onChangeScript(e.target.value)}
          onFocus={onFocusScript}
          onBlur={onBlurScript}
          onKeyDown={(e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (!mod) return;
            const k = e.key.toLowerCase();
            if (k === "z" && !e.shiftKey) { e.preventDefault(); onUndo(); }
            else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); onRedo(); }
          }}
          rows={10}
          placeholder="제품 링크·영상 받아쓰기로 만들거나 직접 입력하세요."
          className="field w-full rounded-xl px-4 py-3 text-sm leading-relaxed outline-none"
        />
      </div>
    </div>
  );
}
