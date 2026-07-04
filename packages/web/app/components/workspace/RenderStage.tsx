"use client";

import { useState } from "react";
import { Clapperboard, Download, Link2, Plus, X, Sticker } from "lucide-react";
import { JobState, OverlayLib, OverlaySel, OverlayItem } from "../../lib/types";
import { apiBase } from "../../lib/api";
import { Spinner, Switch } from "../../ui";

// 오버레이 카테고리별 추가 기본값(말풍선=중앙상단, 트랜지션=풀스크린, 리액션=우하단 스티커)
function defaultSel(cat: "bubble" | "transition" | "reaction", it: OverlayItem): OverlaySel {
  const base = { id: it.id, cat, type: it.type, thumb_url: it.thumb_url };
  if (cat === "transition") return { ...base, x: 0.5, y: 0.5, scale: 1, start: 0, end: null, fullscreen: true };
  if (cat === "reaction") return { ...base, x: 0.72, y: 0.7, scale: 0.42, start: 0.5, end: null, fullscreen: false };
  return { ...base, x: 0.5, y: 0.32, scale: 0.62, start: 0, end: null, fullscreen: false };
}
const CAT_LABEL: Record<string, string> = { bubble: "말풍선", transition: "전환", reaction: "리액션" };

// 렌더 스테이지 — CTA/자막/오버레이 최종 옵션 확인 후 렌더, 완성본 다운로드·공유.
export function RenderStage({
  ctaList, cta, setCta, onAddCta, onDeleteCta,
  ctaOn, setCtaOn, ctaSize, setCtaSize, ctaPos, setCtaPos,
  captionsOn, overlayLib, overlays, setOverlays,
  onRender, busy, job, outputUrl, absUrl, estSec,
}: {
  ctaList: string[]; cta: string; setCta: (v: string) => void;
  onAddCta: () => void; onDeleteCta: (t: string) => void;
  ctaOn: boolean; setCtaOn: (b: boolean) => void;
  ctaSize: number; setCtaSize: (n: number) => void;
  ctaPos: number; setCtaPos: (n: number) => void;
  captionsOn: boolean;
  overlayLib: OverlayLib; overlays: OverlaySel[]; setOverlays: (f: (o: OverlaySel[]) => OverlaySel[]) => void;
  onRender: () => void; busy: boolean; job: JobState | null;
  outputUrl: string | null;
  absUrl: (rel: string) => string;
  estSec: number | null;   // 예상 최종 영상 길이(= 내레이션 예상 초)
}) {
  const [ovCat, setOvCat] = useState<"bubble" | "transition" | "reaction">("bubble");
  const catItems = overlayLib[ovCat] || [];
  const thumb = (u: string) => `${apiBase()}${u}`;
  const addOverlay = (it: OverlayItem) => setOverlays((o) => [...o, defaultSel(ovCat, it)]);
  const patchOverlay = (i: number, p: Partial<OverlaySel>) => setOverlays((o) => o.map((x, idx) => (idx === i ? { ...x, ...p } : x)));
  const removeOverlay = (i: number) => setOverlays((o) => o.filter((_, idx) => idx !== i));
  const hasLib = (overlayLib.bubble.length + overlayLib.transition.length + overlayLib.reaction.length) > 0;
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

      {/* 오버레이 — 말풍선·전환·리액션 스티커 */}
      {hasLib && (
        <section className="panel rounded-2xl p-4">
          <div className="mb-3 flex items-center gap-2">
            <Sticker className="h-4 w-4 text-pink-500" />
            <div className="text-sm font-semibold text-slate-100">효과 / 스티커</div>
            <span className="text-[11px] text-[var(--text-dim)]">말풍선·화면전환·리액션(ㅋㅋㅋ)</span>
          </div>
          {/* 카테고리 탭 */}
          <div className="mb-2 flex items-center gap-1 rounded-lg bg-[var(--panel-2)] p-1 text-[12px] font-medium">
            {(["bubble", "transition", "reaction"] as const).map((c) => (
              <button key={c} onClick={() => setOvCat(c)}
                className={`flex-1 rounded-md px-2 py-1 transition ${ovCat === c ? "bg-pink-500/15 text-pink-400 ring-1 ring-pink-500/30" : "text-slate-400 hover:bg-white/5"}`}>
                {CAT_LABEL[c]} <span className="opacity-60">{overlayLib[c].length}</span>
              </button>
            ))}
          </div>
          {/* 썸네일 그리드 → 클릭해 추가 */}
          <div className="thin-scroll grid max-h-44 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
            {catItems.map((it) => (
              <button key={it.id} onClick={() => addOverlay(it)} title="추가"
                className="group relative aspect-square overflow-hidden rounded-lg bg-[var(--panel-2)] ring-1 ring-[var(--line)] transition hover:ring-pink-500/50">
                <img src={thumb(it.thumb_url)} alt="" className="h-full w-full object-cover" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                  <Plus className="h-4 w-4 text-white" />
                </span>
              </button>
            ))}
          </div>
          {/* 선택된 오버레이 목록 + 컨트롤 */}
          {overlays.length > 0 && (
            <div className="mt-3 space-y-2">
              {overlays.map((o, i) => (
                <div key={i} className="flex items-center gap-2 rounded-xl bg-[var(--panel-2)] p-2 ring-1 ring-[var(--line)]">
                  <img src={thumb(o.thumb_url)} alt="" className="h-10 w-10 flex-none rounded object-cover" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span className="font-semibold text-slate-300">{CAT_LABEL[o.cat]}</span>
                      {!o.fullscreen && (
                        <>
                          <label className="flex items-center gap-1">크기
                            <input type="range" min={0.15} max={1} step={0.02} value={o.scale}
                              onChange={(e) => patchOverlay(i, { scale: +e.target.value })} className="w-16 accent-pink-500" />
                          </label>
                          <label className="flex items-center gap-1">위치
                            <input type="range" min={0.05} max={0.95} step={0.01} value={o.x}
                              onChange={(e) => patchOverlay(i, { x: +e.target.value })} className="w-12 accent-pink-500" title="가로" />
                            <input type="range" min={0.05} max={0.95} step={0.01} value={o.y}
                              onChange={(e) => patchOverlay(i, { y: +e.target.value })} className="w-12 accent-pink-500" title="세로" />
                          </label>
                        </>
                      )}
                      <label className="flex items-center gap-1">등장
                        <input type="number" min={0} step={0.5} value={o.start}
                          onChange={(e) => patchOverlay(i, { start: Math.max(0, +e.target.value) })}
                          className="field w-12 rounded px-1 py-0.5 text-[10px]" />초
                      </label>
                      {o.fullscreen && <span className="rounded bg-white/5 px-1.5 py-0.5">화면 전체</span>}
                    </div>
                  </div>
                  <button onClick={() => removeOverlay(i)} className="rounded p-1 text-slate-600 transition hover:bg-white/10 hover:text-rose-400" aria-label="제거">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

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
