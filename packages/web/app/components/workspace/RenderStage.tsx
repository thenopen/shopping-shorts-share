"use client";

import { Clapperboard, Download, Link2, Plus, X } from "lucide-react";
import { JobState } from "../../lib/types";
import { Spinner, Switch } from "../../ui";

// 렌더 스테이지 — CTA/자막 최종 옵션 확인 후 렌더, 완성본 다운로드·공유.
export function RenderStage({
  ctaList, cta, setCta, onAddCta, onDeleteCta,
  ctaOn, setCtaOn, ctaSize, setCtaSize, ctaPos, setCtaPos,
  captionsOn,
  onRender, busy, job, outputUrl, absUrl, estSec,
}: {
  ctaList: string[]; cta: string; setCta: (v: string) => void;
  onAddCta: () => void; onDeleteCta: (t: string) => void;
  ctaOn: boolean; setCtaOn: (b: boolean) => void;
  ctaSize: number; setCtaSize: (n: number) => void;
  ctaPos: number; setCtaPos: (n: number) => void;
  captionsOn: boolean;
  onRender: () => void; busy: boolean; job: JobState | null;
  outputUrl: string | null;
  absUrl: (rel: string) => string;
  estSec: number | null;   // 예상 최종 영상 길이(= 내레이션 예상 초)
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* CTA 자막 */}
      <section className="panel rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-100">CTA 자막</div>
            <div className="text-[11px] text-[var(--text-dim)]">영상 하단 고정 문구 (구매 유도)</div>
          </div>
          <Switch on={ctaOn} onToggle={() => setCtaOn(!ctaOn)} ariaLabel="CTA 자막 토글" />
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={cta}
            onChange={(e) => setCta(e.target.value)}
            disabled={!ctaOn}
            className="field h-11 min-w-0 flex-1 truncate rounded-lg px-3 text-[13px] outline-none disabled:opacity-40"
          >
            {ctaList.length === 0 && <option value="">(CTA 없음)</option>}
            {ctaList.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button onClick={onAddCta} disabled={!ctaOn} title="CTA 문구 추가" className="btn-ghost flex h-11 w-11 flex-none items-center justify-center rounded-lg disabled:opacity-40">
            <Plus className="h-4 w-4" />
          </button>
          {cta && ctaList.includes(cta) && (
            <button onClick={() => onDeleteCta(cta)} disabled={!ctaOn} title="선택한 문구 삭제" className="flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400 transition hover:bg-rose-500/20 disabled:opacity-40">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {ctaOn && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-[var(--text-mut)]">
              글자 크기 <span className="text-slate-100">{ctaSize}px</span>
              <input type="range" min={24} max={120} value={ctaSize} onChange={(e) => setCtaSize(+e.target.value)} className="mt-1.5 w-full accent-pink-500" />
            </label>
            <label className="text-xs font-medium text-[var(--text-mut)]">
              세로 위치 <span className="text-slate-100">{Math.round(ctaPos * 100)}%</span>
              <input type="range" min={0} max={100} value={Math.round(ctaPos * 100)} onChange={(e) => setCtaPos(+e.target.value / 100)} className="mt-1.5 w-full accent-pink-500" />
            </label>
          </div>
        )}
      </section>

      {/* 요약 + 렌더 */}
      <section className="panel rounded-2xl p-4">
        <div className="mb-3 text-sm font-semibold text-slate-100">최종 확인</div>
        <ul className="mb-4 flex flex-wrap gap-1.5 text-[11px] font-medium">
          <li className={`rounded-full px-2.5 py-1 ${captionsOn ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-slate-500"}`}>자동 자막 {captionsOn ? "ON" : "OFF"}</li>
          <li className={`rounded-full px-2.5 py-1 ${ctaOn ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-slate-500"}`}>CTA {ctaOn ? "ON" : "OFF"}</li>
          {estSec != null && (
            <li className="rounded-full bg-blue-500/10 px-2.5 py-1 text-blue-400 ring-1 ring-blue-500/25" title="최종 영상 길이 = 내레이션(TTS) 길이 — 대본 분량·말속도 기준 추정">
              예상 길이 ~{Math.round(estSec)}초
            </li>
          )}
        </ul>
        <button
          onClick={onRender}
          disabled={!job?.id || busy}
          title="TTS 더빙 → 영상 합성 → 자막 굽기까지 한 번에 실행돼요 (수 분)"
          className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm"
        >
          {busy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : <Clapperboard className="h-4 w-4" />}
          {busy ? `${job?.stage || "처리 중"}…` : "영상 생성"}
        </button>
        {!job?.id && <p className="mt-2 text-center text-[11px] text-[var(--text-dim)]">먼저 소스 단계에서 영상 링크를 분석하세요.</p>}
      </section>

      {/* 완성본 */}
      {outputUrl && (
        <section className="panel rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-emerald-400">✅ 영상 완성 — 왼쪽 프리뷰에서 확인</div>
            {job?.output_dur ? (
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300 ring-1 ring-[var(--line)]">
                실제 {Math.round(job.output_dur)}초
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={absUrl(outputUrl)}
              download
              target="_blank"
              rel="noopener"
              className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600"
            >
              <Download className="h-4 w-4" /> 다운로드
            </a>
            <button
              onClick={async () => {
                const link = absUrl(outputUrl);
                // 모바일 공유시트(가능하면) — 아니면 클립보드 복사
                const navAny = navigator as Navigator & { share?: (d: { title?: string; url?: string }) => Promise<void> };
                try {
                  if (navAny.share) { await navAny.share({ title: "쇼핑 쇼츠", url: link }); return; }
                  await navigator.clipboard.writeText(link);
                  alert("영상 링크를 복사했어요. 폰 브라우저에 붙여넣어 저장하세요.");
                } catch {}
              }}
              className="btn-ghost flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold"
            >
              <Link2 className="h-4 w-4" /> 공유 / 링크
            </button>
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-dim)]">아이폰은 프리뷰 영상을 길게 눌러 &quot;비디오 저장&quot;으로도 받을 수 있어요.</p>
        </section>
      )}
    </div>
  );
}
