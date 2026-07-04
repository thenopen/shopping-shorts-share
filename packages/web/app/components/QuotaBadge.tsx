"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Cloud, ExternalLink, Mic, Sparkles } from "lucide-react";
import { apiBase } from "../lib/api";
import { Usage } from "../lib/types";
import { fmtK } from "../lib/format";

// 헤더 우측 사용량 배지 — /usage 8초 폴링(작업 중 2.5s).
// 표시 철학(업계 리서치 기반, Descript식): 단위가 제각각인 3축(LLM 호출/일 · TTS 문자/월 ·
// GPU 크레딧 $/월)을 통합 크레딧으로 뭉개지 않고, 배지에선 "남은 %" 게이지로 정규화해
// 직관을 주고, 클릭하면 원단위 상세(토큰·RPM·리셋·콘솔 링크) 패널을 연다.
// 무료티어는 잔량 조회 API가 없어(Gemini/GCP TTS 공통) 로컬 카운팅 근사치가 진실의 원천.
function QuotaBadgeImpl({ refreshKey, active }: { refreshKey: number; active: boolean }) {
  const [u, setU] = useState<Usage | null>(null);
  const [cool, setCool] = useState(0);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch(`${apiBase()}/usage`);
        if (!r.ok) return;
        const j: Usage = await r.json();
        if (!live) return;
        setU(j);
        setCool(j.gemini?.cooldown ?? 0);
      } catch {}
    };
    load();  // 마운트·active 토글·버튼(refreshKey) 시 1회 로드(완료 직후 최종 사용량 반영)
    // 사용량은 작업 중에만 변함 → 처리 중(active)에만 2.5s 폴링. 유휴 땐 폴링 안 함.
    const id = active ? setInterval(load, 2500) : null;
    return () => { live = false; if (id) clearInterval(id); };
  }, [refreshKey, active]);

  // 소진 쿨다운은 1초씩 로컬 감소(폴링 사이에도 부드럽게).
  useEffect(() => {
    if (cool <= 0) return;
    const id = setInterval(() => setCool((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cool > 0]);

  if (!u) return null;
  const g = u.gemini, t = u.tts, m = u.modal;

  // 남은 비율(0~1). Gemini는 일일·분당 중 빡빡한 쪽(분당이 무료티어 실제 병목).
  const pct = (rem: number, lim: number) => Math.max(0, Math.min(1, rem / Math.max(1, lim)));
  const axes = [
    {
      key: "gemini", label: "AI 대본 (Gemini)",
      icon: <Sparkles className="h-3.5 w-3.5 text-pink-400" />,
      p: Math.min(pct(g.remaining, g.limit), pct(g.rpm_remaining, g.rpm_limit)),
      summary: `${g.remaining.toLocaleString()}/${g.limit.toLocaleString()}회`,
      detail: [
        ["오늘 호출", `${g.calls.toLocaleString()}회 · 남음 ${g.remaining.toLocaleString()}/${g.limit.toLocaleString()}`],
        ["오늘 토큰", `${fmtK(g.tokens)}${g.model ? ` (${g.model})` : ""} · 분당 한도 ${fmtK(g.tpm_limit)}`],
        ["분당(RPM)", `최근 1분 ${g.rpm}회 · 남음 ${g.rpm_remaining}/${g.rpm_limit} — 무료티어 실제 병목`],
        ["리셋", `매일 ${g.reset} (KST)`],
      ] as [string, string][],
      console: ["AI Studio", "https://aistudio.google.com/usage"],
    },
    {
      key: "tts", label: "보이스 (TTS)",
      icon: <Mic className="h-3.5 w-3.5 text-blue-400" />,
      p: pct(t.remaining, t.limit),
      summary: `${fmtK(t.remaining)}/${fmtK(t.limit)}자`,
      detail: [
        ["이번달 사용", `${t.chars.toLocaleString()}자 (${t.calls}회)`],
        ["남음", `${t.remaining.toLocaleString()} / 월 ${t.limit.toLocaleString()}자`],
        ["리셋", `매월 1일 ${t.reset} (KST)`],
      ] as [string, string][],
      console: ["Cloud Console", "https://console.cloud.google.com/iam-admin/quotas"],
    },
    {
      key: "modal", label: "자막제거 GPU (Modal 크레딧)",
      icon: <Cloud className="h-3.5 w-3.5 text-slate-400" />,
      p: pct(m.remaining, m.limit),
      summary: `$${m.remaining}/$${m.limit}`,
      detail: [
        ["이번달 사용", `$${m.cost} — 자막제거 ${m.jobs}건, GPU ${Math.round(m.seconds)}s${m.gpu ? ` (${m.gpu})` : ""}`],
        ["크레딧", `남음 $${m.remaining} / 월 $${m.limit}${m.accounts > 1 ? ` (${m.accounts}계정 합산)` : ""}`],
        ["리셋", `매월 1일 ${m.reset} (KST)`],
      ] as [string, string][],
      console: ["Modal 대시보드", "https://modal.com/settings/usage"],
    },
  ];

  // 게이지 색 — 남은 비율 기준. 25%↑ 초록, 5~25% 주황, 5%↓ 빨강(소진 임박).
  const barCls = (p: number) => (p <= 0.05 ? "bg-rose-400" : p < 0.25 ? "bg-amber-400" : "bg-emerald-400");
  const txtCls = (p: number) => (p <= 0.05 ? "text-rose-400" : p < 0.25 ? "text-amber-400" : "text-slate-300");
  const worst = Math.min(...axes.map((a) => a.p));

  return (
    <>
      {cool > 0 && (
        <span className="hidden items-center whitespace-nowrap rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-semibold text-rose-400 ring-1 ring-rose-500/30 md:inline-flex">
          Gemini 한도 소진 · {cool}s 후 재시도
        </span>
      )}
      <div ref={wrapRef} className="relative hidden md:block">
        {/* 배지: 3축 미니 게이지 + 남은 % — 클릭하면 원단위 상세 패널 */}
        <button
          onClick={() => setOpen((v) => !v)}
          title="API 사용량 · 크레딧 — 클릭해 상세"
          className={`flex items-center gap-2.5 rounded-lg panel-2 px-3 py-1.5 text-[11px] font-medium transition hover:bg-white/5 ${worst <= 0.05 ? "ring-1 ring-rose-500/40" : ""}`}
        >
          {axes.map((a) => (
            <span key={a.key} className="flex items-center gap-1.5 whitespace-nowrap">
              {a.icon}
              <span className="h-1 w-9 overflow-hidden rounded-full bg-white/10">
                <span className={`block h-full rounded-full ${barCls(a.p)}`} style={{ width: `${Math.round(a.p * 100)}%` }} />
              </span>
              <b className={txtCls(a.p)}>{Math.round(a.p * 100)}%</b>
            </span>
          ))}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="panel absolute right-0 top-[calc(100%+8px)] z-50 w-[360px] rounded-2xl p-4 shadow-2xl">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-bold text-slate-100">사용량 · 크레딧</span>
                <span className="text-[10px] text-slate-500">로컬 집계 근사치 — 정확값은 각 콘솔</span>
              </div>
              <div className="flex flex-col gap-3">
                {axes.map((a) => (
                  <div key={a.key} className="panel-2 rounded-xl p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-200">
                        {a.icon}{a.label}
                      </span>
                      <span className={`text-[12px] font-bold ${txtCls(a.p)}`}>{a.summary} <span className="font-medium text-slate-500">({Math.round(a.p * 100)}%)</span></span>
                    </div>
                    <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <span className={`block h-full rounded-full ${barCls(a.p)}`} style={{ width: `${Math.round(a.p * 100)}%` }} />
                    </div>
                    <dl className="space-y-0.5 text-[11px]">
                      {a.detail.map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <dt className="w-16 flex-none text-slate-500">{k}</dt>
                          <dd className="min-w-0 text-slate-300">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    <a
                      href={a.console[1]} target="_blank" rel="noopener"
                      className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-blue-400 hover:underline"
                    >
                      {a.console[0]}에서 정확한 값 보기 <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                Gemini·TTS는 잔량 조회 API가 없어 이 앱이 호출을 직접 세요(이 키를 이 앱만 쓸 때 정확).
                Modal은 GPU초×단가 추정. 한도는 설정 패널에서 조정.
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export const QuotaBadge = memo(QuotaBadgeImpl);
