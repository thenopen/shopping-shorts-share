"use client";

import { Film, ClipboardPaste, Search, Play, X, FolderOpen, ScanSearch } from "lucide-react";
import { Spinner } from "../../ui";
import { apiBase } from "../../lib/api";
import { fmtSec } from "../../lib/format";
import { JobState, PreviewInfo, LibraryEntry } from "../../lib/types";
import { StageBadges } from "../StageBadges";

// 소스 단계 — 영상 링크 입력/확인 카드/최근 다운로드/자막제거 품질 확인.
// 로직은 전부 props로 주입(page.tsx의 checkUrl/analyze/resumeFromLibrary 등) — 여기선 표시만.
export function SourceStage(props: {
  url: string; setUrl: (v: string) => void;
  onPasteClipboard: () => void;
  onCheck: () => void; previewBusy: boolean;
  onAnalyze: () => void; busy: boolean;
  preview: PreviewInfo | null;
  libEntries: LibraryEntry[];
  onPickLibrary: (url: string) => void;      // setUrl+checkUrl
  onResume: (url: string) => void;           // 이어하기
  onDeleteLibrary: (key: string) => void;    // 다운로드 기록 항목 삭제
  job: JobState | null;
  qFrames: { t: number; source: string | null; nosub: string | null }[];
  qBusy: boolean; qEngine: string | null; onCheckQuality: () => void;
}) {
  const {
    url, setUrl, onPasteClipboard, onCheck, previewBusy, onAnalyze, busy,
    preview, libEntries, onPickLibrary, onResume, onDeleteLibrary,
    job, qFrames, qBusy, qEngine, onCheckQuality,
  } = props;

  return (
    <div className="flex flex-col gap-4">
      {/* 영상 링크 입력 + 확인/분석 */}
      <section className="panel rounded-2xl p-4">
        <label className="mb-2 block text-sm font-semibold text-slate-100">영상 링크</label>
        <div className="flex flex-col gap-2 md:flex-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAnalyze()}
            placeholder="공유 텍스트 또는 링크를 붙여넣으세요"
            className="field min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={onPasteClipboard}
              className="btn-ghost flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium"
            >
              <ClipboardPaste className="h-4 w-4 text-slate-400" /> 붙여넣기
            </button>
            <button
              onClick={onCheck}
              disabled={previewBusy || !url.trim()}
              title="다운로드 없이 제목·썸네일·보관 여부만 미리 확인"
              className="btn-ghost flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium"
            >
              <Search className="h-4 w-4 text-slate-400" />
              {previewBusy ? "확인 중..." : "확인"}
            </button>
            <button
              onClick={onAnalyze}
              disabled={busy || !url.trim()}
              title="영상 다운로드 + 원본 자막 제거까지 실행 (수십 초~수 분)"
              className="btn-primary flex items-center gap-2 whitespace-nowrap rounded-lg px-5 py-2 text-sm"
            >
              {busy && job?.status !== "done" && <Spinner className="h-3.5 w-3.5 border-white/40 border-t-white" />}
              {busy && job?.status !== "done" ? "분석 중..." : "분석"}
            </button>
          </div>
        </div>

        {/* 확인(미리보기) 카드 — 제목·썸네일. 이미 받은 영상이면 재사용·단계 표시 */}
        {preview && (
          <div className="panel-2 mt-3 flex gap-3 rounded-2xl p-3">
            {preview.thumb || preview.thumbnail ? (
              <img
                src={preview.thumb ? `${apiBase()}${preview.thumb}` : preview.thumbnail || ""}
                alt="썸네일"
                className="h-24 w-auto flex-none rounded-lg bg-black/40 object-cover ring-1 ring-white/10"
                style={{ aspectRatio: "9/16" }}
              />
            ) : (
              <div className="flex h-24 w-14 flex-none items-center justify-center rounded-lg bg-white/5">
                <Film className="h-5 w-5 text-slate-500" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {preview.in_library && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">♻ 재사용</span>
                )}
                {preview.platform && (
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-400">{preview.platform}</span>
                )}
              </div>
              <div className="mt-1 line-clamp-2 text-sm font-semibold text-slate-100">
                {preview.title || (preview.error ? "확인 실패" : preview.note ? "미리보기 제한" : "제목 없음")}
              </div>
              {preview.duration ? <div className="text-[11px] text-slate-400">{fmtSec(preview.duration)}</div> : null}
              {preview.stages && <StageBadges stages={preview.stages} />}
              {preview.in_library && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    onClick={() => onResume(preview.url)}
                    className="btn-primary flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs"
                  >
                    <Play className="h-3.5 w-3.5" />
                    이어하기
                  </button>
                </div>
              )}
              {preview.note && <div className="mt-1 text-[11px] text-amber-400">{preview.note}</div>}
              {preview.error && <div className="mt-1 text-[11px] text-rose-400">{preview.error}</div>}
            </div>
          </div>
        )}

        {/* 최근 다운로드 — 클릭하면 URL 채우고 확인(재사용). 단계 캐시는 확인 카드에 표시 */}
        {libEntries.length > 0 && (
          <details className="mt-3">
            <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-300">
              <FolderOpen className="h-3.5 w-3.5" />
              최근 다운로드 · 클릭해 재사용 ({libEntries.length})
            </summary>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {libEntries.map((e) => (
                <div key={e.key} className="group relative flex-none">
                  <button
                    onClick={() => onPickLibrary(e.url)}
                    title={e.title || e.url}
                    className="block transition hover:opacity-80"
                  >
                    {e.has_thumb ? (
                      <img
                        src={`${apiBase()}/library/thumb/${e.key}`}
                        alt=""
                        className="h-20 w-[45px] rounded-lg object-cover ring-1 ring-white/10"
                        style={{ aspectRatio: "9/16" }}
                      />
                    ) : (
                      <div className="flex h-20 w-[45px] items-center justify-center rounded-lg bg-white/5">
                        <Film className="h-4 w-4 text-slate-500" />
                      </div>
                    )}
                  </button>
                  {/* 항목별 삭제 — 호버 시 노출 */}
                  <button
                    onClick={() => onDeleteLibrary(e.key)}
                    title="이 기록 삭제"
                    aria-label="다운로드 기록 삭제"
                    className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 text-slate-200 opacity-0 transition hover:bg-rose-500/80 hover:text-white group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* 자막 제거 품질 확인 — 군데군데 원본 vs 제거본 비교(잔상·번짐 눈으로 잡기) */}
      {job?.id && job?.preview && (
        <section className="panel rounded-2xl p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onCheckQuality}
              disabled={qBusy}
              className="btn-ghost flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold"
            >
              {qBusy
                ? <Spinner className="h-3 w-3 border-pink-500/40 border-t-pink-500" />
                : <ScanSearch className="h-3.5 w-3.5 text-slate-400" />}
              {qBusy ? "프레임 추출 중…" : "자막 제거 품질 확인"}
            </button>
            <span className="text-[11px] text-slate-500">여러 구간의 원본↔제거본 프레임을 나란히 비교해요</span>
            {qEngine && <span className="text-[11px] text-slate-500">엔진: {qEngine}</span>}
          </div>
          {qFrames.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {qFrames.map((f, i) => (
                <div key={i} className="panel-2 rounded-xl p-1.5">
                  <div className="mb-1 text-center text-[10px] font-semibold text-slate-400">{fmtSec(f.t)}</div>
                  <div className="grid grid-cols-2 gap-1">
                    <figure className="m-0">
                      {f.source
                        ? <img src={`${apiBase()}${f.source}`} alt="원본" className="w-full rounded" />
                        : <div className="rounded bg-black/40" style={{ aspectRatio: "9/16" }} />}
                      <figcaption className="mt-0.5 text-center text-[9px] text-slate-500">원본</figcaption>
                    </figure>
                    <figure className="m-0">
                      {f.nosub
                        ? <img src={`${apiBase()}${f.nosub}`} alt="제거본" className="w-full rounded" />
                        : <div className="rounded bg-black/40" style={{ aspectRatio: "9/16" }} />}
                      <figcaption className="mt-0.5 text-center text-[9px] font-semibold text-emerald-400">제거</figcaption>
                    </figure>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
