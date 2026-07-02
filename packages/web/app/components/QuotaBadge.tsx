"use client";

import { useEffect, useState } from "react";
import { apiBase } from "../lib/api";
import { Usage } from "../lib/types";
import { fmtK } from "../lib/format";
import { HelpDot } from "./HelpDot";

// 헤더 우측 API 잔여 한도 배지 — /usage 8초 폴링. 무료티어는 잔여 quota API가 없어
// '한도 − 우리 사용량'으로 남은 양을 계산(이 키를 이 앱만 쓸 때 정확). 리셋시각은 (?)에.
export function QuotaBadge({ refreshKey, active }: { refreshKey: number; active: boolean }) {
  const [u, setU] = useState<Usage | null>(null);
  const [cool, setCool] = useState(0);
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
  const clr = (rem: number, lim: number) =>
    rem <= 0 ? "text-rose-500" : rem < lim * 0.1 ? "text-amber-600" : "text-[var(--ink)]";

  const rows = [
    {
      key: "gemini", icon: "🔹", label: "Gemini",
      value: `${g.remaining.toLocaleString()}/${g.limit.toLocaleString()}`, unit: "요청",
      // 색은 일일·분당 중 더 빡빡한 쪽 기준(분당이 무료 등급 실제 병목).
      cls: clr(Math.min(g.remaining / Math.max(1, g.limit), g.rpm_remaining / Math.max(1, g.rpm_limit)), 1),
      help: `Gemini 무료 실제 한도 기준(설정값은 이 실제 한도로 캡됨).\n· 하루 ${g.limit.toLocaleString()}요청 — 오늘 ${g.calls}회 사용, ${g.remaining.toLocaleString()} 남음.\n· 분당 ${g.rpm_limit}요청 — 최근 1분 ${g.rpm}회, ${g.rpm_remaining} 남음. ← 무료 등급 실제 병목(몰아 쓰면 여기서 429).\n일일 잔여 남아도 분당 초과하면 막혀요. 리셋: 매일 ${g.reset} (KST). 실시간 정확값은 AI Studio/Cloud Console.`,
    },
    {
      key: "tts", icon: "🔸", label: "TTS",
      value: `${fmtK(t.remaining)}/${fmtK(t.limit)}`, unit: "자",
      cls: clr(t.remaining, t.limit),
      help: `Google TTS(Chirp3-HD) 무료 한도: 월 ${t.limit.toLocaleString()}자.\n남은 = 한도 − 이번달 사용 ${t.chars.toLocaleString()}자.\n리셋: 매월 1일 ${t.reset} (KST).\n정확한 잔여는 Cloud Console 할당량.`,
    },
    {
      key: "modal", icon: "☁️", label: m.accounts > 1 ? `Modal×${m.accounts}` : "Modal",
      value: `$${m.remaining}/$${m.limit}`, unit: "",
      cls: clr(m.remaining, m.limit),
      help: `Modal 무료 크레딧: 월 $${m.limit}${m.accounts > 1 ? ` (${m.accounts}계정 합산 · 계정당 $${(m.limit / m.accounts).toFixed(0)})` : ""}.\n남은 = 총한도 − 이번달 추정사용 $${m.cost} (자막제거 ${m.jobs}건, GPU ${Math.round(m.seconds)}s${m.gpu ? `, ${m.gpu}` : ""}).\nGPU초×단가 추정치 — 정확한 잔여는 Modal 대시보드.\n리셋: 매월 1일 ${m.reset} (KST).`,
    },
  ];

  return (
    <div className="hidden flex-col items-end gap-1 text-[11px] font-semibold sm:flex">
      {cool > 0 && (
        <span className="rounded-full bg-rose-100/80 px-2.5 py-1 text-rose-600 backdrop-blur">
          ⚠ Gemini 한도 소진 · {cool}s 후 재시도
        </span>
      )}
      <div className="flex flex-col gap-0.5 rounded-xl bg-white/55 px-3 py-1.5 text-[var(--ink-soft)] backdrop-blur">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-end gap-1.5 whitespace-nowrap">
            <span>{r.icon} {r.label}</span>
            <span className={`font-bold ${r.cls}`}>{r.value}</span>
            <span>{r.unit ? `${r.unit} 남음` : "남음"}</span>
            <HelpDot title={r.help} />
          </div>
        ))}
      </div>
    </div>
  );
}
