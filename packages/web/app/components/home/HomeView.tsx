"use client";

import { Clapperboard, Film, Play, Settings, Sparkles, Trash2 } from "lucide-react";
import { apiBase } from "../../lib/api";
import { fmtSec } from "../../lib/format";
import { LibraryEntry } from "../../lib/types";
import { StageBadges } from "../StageBadges";
import { QuotaBadge } from "../QuotaBadge";
import { ThemeToggle } from "../ThemeToggle";

// 홈(메인) 화면 — 실제 서비스형 랜딩: 새 프로젝트 시작 + 내 프로젝트(라이브러리) 그리드.
// 편집(워크스페이스)은 별도 view — 여기선 진입/이어하기만 담당하고 작업 상태는 page.tsx가 유지.
type ProjectMeta = { id: string; name: string; updated: number; source_url: string; n_captions: number; n_overlays: number };

export function HomeView(props: {
  entries: LibraryEntry[];
  projects: ProjectMeta[];             // 저장한 편집 프로젝트
  onLoadProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  hasWork: boolean;            // 편집 중이던 작업(링크/대본/job) 존재 → '편집 계속하기' 노출
  workLabel?: string;          // 편집 중 작업 라벨(제목/URL 요약)
  onNew: () => void;           // 새 프로젝트(초기화 후 편집 진입)
  onContinue: () => void;      // 진행 중 편집으로 복귀(상태 그대로)
  onResume: (url: string) => void;   // 라이브러리 항목 이어하기 → 편집 진입
  onDelete: (key: string) => void;
  onOpenSettings: () => void;
  usageRefresh: number;
  usageActive: boolean;
  deployN: number;
}) {
  const {
    entries, projects, onLoadProject, onDeleteProject,
    hasWork, workLabel, onNew, onContinue, onResume, onDelete,
    onOpenSettings, usageRefresh, usageActive, deployN,
  } = props;
  const sorted = [...entries].sort((a, b) => (b.downloaded_at || 0) - (a.downloaded_at || 0));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 홈 헤더 — 로고 + 사용량/테마/설정 */}
      <header className="flex h-14 flex-none items-center justify-between border-b border-[var(--line)] px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--brand)] to-[var(--blu)] font-bold text-white">
            S
          </div>
          <span className="font-semibold text-slate-100">쇼핑 쇼츠 메이커</span>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-400 ring-1 ring-[var(--line)]">
            BETA
          </span>
        </div>
        <div className="flex items-center gap-2">
          {deployN > 0 && (
            <button
              onClick={onOpenSettings}
              className="whitespace-nowrap rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-400 ring-1 ring-amber-400/30 hover:bg-amber-400/20"
            >
              Modal 배포중 {deployN}
            </button>
          )}
          <QuotaBadge refreshKey={usageRefresh} active={usageActive} />
          <ThemeToggle />
          <button onClick={onOpenSettings} aria-label="설정" className="btn-ghost flex h-9 w-9 items-center justify-center rounded-lg">
            <Settings className="h-4 w-4 text-slate-300" />
          </button>
        </div>
      </header>

      <main className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-6 py-10">
          {/* 히어로 — 새 프로젝트 시작 */}
          <section className="panel relative overflow-hidden rounded-3xl p-8 sm:p-10">
            <div
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{ background: "radial-gradient(600px 220px at 20% 0%, rgba(236,72,153,0.18), transparent), radial-gradient(500px 200px at 90% 100%, rgba(59,130,246,0.14), transparent)" }}
            />
            <div className="relative">
              <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-pink-400">
                <Sparkles className="h-3.5 w-3.5" /> 링크 한 줄이면 끝
              </div>
              <h1 className="text-2xl font-bold leading-snug text-slate-100 sm:text-3xl">
                상품 영상 링크로<br className="sm:hidden" /> 쇼핑 쇼츠를 만들어 보세요
              </h1>
              <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-slate-400">
                자막 제거 → AI 대본 → TTS 보이스 → 스타일 자막 → 렌더까지 한 흐름으로.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                <button onClick={onNew} className="btn-primary flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold">
                  <Clapperboard className="h-4 w-4" /> 새 쇼츠 만들기
                </button>
                {hasWork && (
                  <button onClick={onContinue} className="btn-ghost flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold" title={workLabel}>
                    <Play className="h-4 w-4 text-emerald-400" /> 편집 계속하기
                    {workLabel && <span className="max-w-40 truncate text-[11px] font-normal text-slate-500">{workLabel}</span>}
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* 저장한 프로젝트 — 편집 전체(자막·CTA·스티커)를 통째로 불러오기 */}
          {projects.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-3 text-sm font-bold text-slate-200">저장한 프로젝트 <span className="font-medium text-slate-500">({projects.length})</span></h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((p) => (
                  <div key={p.id} className="group panel flex items-center gap-3 rounded-2xl p-3 transition hover:ring-1 hover:ring-pink-500/40">
                    <button onClick={() => onLoadProject(p.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left" title="불러오기">
                      <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-pink-500/25 to-blue-500/20 text-pink-300"><Clapperboard className="h-5 w-5" /></span>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold text-slate-100">{p.name || "제목 없음"}</div>
                        <div className="truncate text-[10px] text-slate-500">
                          자막 {p.n_captions} · 효과 {p.n_overlays}
                          {p.updated ? ` · ${new Date(p.updated * 1000).toLocaleDateString()}` : ""}
                        </div>
                      </div>
                    </button>
                    <button onClick={() => onDeleteProject(p.id)} className="rounded p-1.5 text-slate-600 opacity-0 transition hover:bg-rose-500/10 hover:text-rose-400 group-hover:opacity-100" aria-label="삭제">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 받아둔 영상 — 다운로드 라이브러리(이어하기) */}
          <section className="mt-10">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-200">
                받아둔 영상 {sorted.length > 0 && <span className="font-medium text-slate-500">({sorted.length})</span>}
              </h2>
            </div>

            {sorted.length === 0 ? (
              <div className="panel-2 flex flex-col items-center gap-2.5 rounded-2xl px-6 py-12 text-center">
                <Film className="h-8 w-8 text-slate-600" />
                <p className="text-[13px] font-medium text-slate-400">아직 프로젝트가 없어요</p>
                <p className="text-[11px] text-slate-500">새 쇼츠를 만들면 받아둔 영상·대본이 여기에 쌓여요.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {sorted.map((e) => (
                  <div key={e.key} className="group panel flex flex-col overflow-hidden rounded-2xl transition hover:ring-1 hover:ring-pink-500/40">
                    {/* 썸네일(9:16) — 클릭 = 이어하기 */}
                    <button
                      onClick={() => onResume(e.url)}
                      className="relative aspect-[9/16] max-h-56 w-full overflow-hidden bg-black/40 text-left"
                      title="이어하기"
                    >
                      {e.has_thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`${apiBase()}/library/thumb/${e.key}`}
                          alt={e.title || "썸네일"}
                          className="h-full w-full object-cover transition group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Film className="h-6 w-6 text-slate-600" />
                        </div>
                      )}
                      {/* 호버 오버레이 — 이어하기 유도 */}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
                        <span className="flex items-center gap-1.5 rounded-full bg-pink-500 px-3.5 py-1.5 text-[11px] font-bold text-white">
                          <Play className="h-3 w-3" /> 이어하기
                        </span>
                      </div>
                      {e.duration ? (
                        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {fmtSec(e.duration)}
                        </span>
                      ) : null}
                    </button>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2.5">
                      <div className="line-clamp-2 text-[12px] font-semibold leading-snug text-slate-100">
                        {e.title || "제목 없음"}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                        <span className="rounded-full bg-white/5 px-1.5 py-0.5 font-semibold text-slate-400">{e.platform}</span>
                        {e.downloaded_at ? <span>{new Date(e.downloaded_at * 1000).toLocaleDateString()}</span> : null}
                      </div>
                      <StageBadges stages={e.stages} />
                      <div className="mt-auto flex items-center justify-end pt-1 opacity-0 transition group-hover:opacity-100">
                        <button
                          onClick={() => onDelete(e.key)}
                          className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-400"
                        >
                          <Trash2 className="h-3 w-3" /> 삭제
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
