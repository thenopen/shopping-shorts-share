"use client";

import { useEffect, useRef, useState } from "react";
import CaptionEditor, { CaptionStyle, DEFAULT_STYLE } from "./CaptionEditor";
import CaptionTimeline, { CaptionLineData } from "./CaptionTimeline";

const VOICES: { name: string; gender: "F" | "M" }[] = [
  { name: "소담", gender: "F" },
  { name: "서연", gender: "F" },
  { name: "나윤", gender: "F" },
  { name: "지우", gender: "F" },
  { name: "수아", gender: "F" },
  { name: "하은", gender: "F" },
  { name: "예린", gender: "F" },
  { name: "가은", gender: "F" },
  { name: "리아", gender: "F" },
  { name: "채원", gender: "F" },
  { name: "유나", gender: "F" },
  { name: "민서", gender: "F" },
  { name: "태형", gender: "M" },
  { name: "준호", gender: "M" },
  { name: "현우", gender: "M" },
  { name: "시우", gender: "M" },
  { name: "도윤", gender: "M" },
  { name: "재민", gender: "M" },
  { name: "성호", gender: "M" },
  { name: "건우", gender: "M" },
  { name: "우진", gender: "M" },
  { name: "동현", gender: "M" },
  { name: "민준", gender: "M" },
];

// 기본 제공 CTA 문구(텍스트 자체를 값으로 사용 — 서버가 커스텀 문구도 그대로 받음)
const DEFAULT_CTAS = [
  "제품 정보는 고정 댓글에서 확인하세요!",
  "구매처는 프로필 링크에 있어요.",
  "자세한 내용은 하단 링크를 눌러주세요.",
];
const CTA_STORAGE_KEY = "custom_ctas";

function apiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE;
  if (typeof window === "undefined") return "http://127.0.0.1:8000";
  // 같은 출처("") → next.config rewrites가 8000으로 프록시 (터널/LAN/Tailscale 포트 하나로 통일)
  return "";
}

async function postJSON<T = any>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(msg || `요청 실패 (HTTP ${r.status})`);
  }
  return r.json();
}

type JobState = {
  id: string;
  status: string;
  progress: number;
  stage: string;
  script: string;
  preview: string | null;
  output: string | null;
  has_speech: boolean | null;
  error: string | null;
  subtitle_engine?: string | null;       // "propainter_modal" | "lama" | "lama_fallback" | "cached" | "none"
  subtitle_engine_note?: string | null;  // 폴백 사유 등
  subtitle_debug?: string[] | null;      // 자막제거 판단/폴백 과정(F12 콘솔용)
  douyin_diag?: string[] | null;         // 도우인 다운로드 미디어 후보/트랙 진단(F12 콘솔용)
};

type Usage = {
  gemini: { calls: number; tokens: number; model?: string | null; cooldown: number; limit: number; remaining: number; tpm_limit: number; reset: string };
  tts: { chars: number; calls: number; limit: number; remaining: number; reset: string };
  modal: { jobs: number; seconds: number; cost: number; gpu?: string | null; limit: number; remaining: number; reset: string; accounts: number };
};

// 리셋 시각/설명을 보여주는 (?) 도움말 아이콘 — 네이티브 title 툴팁(줄바꿈 포함).
function HelpDot({ title }: { title: string }) {
  return (
    <span
      title={title}
      className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full bg-[var(--ink-soft)]/25 text-[9px] font-bold leading-none text-[var(--ink-soft)]"
    >?</span>
  );
}

function fmtK(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return `${n}`;
}

// 소구포인트 텍스트("카테고리: X\n소구포인트:\n- p1\n- p2") → {카테고리, 포인트[]}. 파싱 실패해도 안전.
function parsePoints(t: string): { cat: string; points: string[] } {
  const cat = ((t || "").match(/카테고리[:：]\s*(.+)/) || [])[1]?.trim() || "";
  const points = (t || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-•*·]/.test(l))
    .map((l) => l.replace(/^[-•*·]\s*/, "").trim())
    .filter(Boolean);
  return { cat, points };
}

// 재사용 진입점 표시 — 원본/자막제거/대본 중 어디까지 캐시되어 있는지(✓/○).
function StageBadges({ stages }: { stages: Stages }) {
  const items: [keyof Stages, string][] = [["source", "원본"], ["nosub", "자막제거"], ["script", "대본"]];
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {items.map(([k, l]) => (
        <span key={k} className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${stages[k] ? "bg-emerald-100 text-emerald-700" : "bg-white/50 text-[var(--ink-soft)]/60"}`}>
          {stages[k] ? "✓" : "○"} {l}
        </span>
      ))}
    </div>
  );
}

// 헤더 우측 API 잔여 한도 배지 — /usage 8초 폴링. 무료티어는 잔여 quota API가 없어
// '한도 − 우리 사용량'으로 남은 양을 계산(이 키를 이 앱만 쓸 때 정확). 리셋시각은 (?)에.
function QuotaBadge({ refreshKey, active }: { refreshKey: number; active: boolean }) {
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
      cls: clr(g.remaining, g.limit),
      help: `Gemini 무료 한도: 하루 ${g.limit.toLocaleString()}요청.\n남은 = 한도 − 오늘 사용 ${g.calls}회 (${g.tokens.toLocaleString()}토큰).\n리셋: 매일 ${g.reset} (KST) · 태평양 자정 기준.\n정확한 잔여는 AI Studio / Cloud Console.`,
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

type SettingsStatus = {
  gemini: { set: boolean; masked: string };
  google_tts: { set: boolean; email: string };
  modal: { set: boolean; masked: string; profile: string | null };
  limits: { gemini_rpd: number; gemini_tpm: number; tts_chars: number; modal_credit: number };
  download_dir: string;
};

// URL 확인(미리보기) 결과 + 라이브러리 항목
type Stages = { source: boolean; nosub: boolean; script: boolean };
type PreviewInfo = {
  url: string; in_library: boolean; reused: boolean;
  title?: string | null; duration?: number | null; platform?: string;
  thumb?: string | null; thumbnail?: string | null; stages?: Stages;
  note?: string; error?: string;
};
type LibraryEntry = {
  key: string; url: string; title: string; duration?: number | null;
  platform: string; downloaded_at: number; size: number;
  has_thumb: boolean; stages: Stages;
};

type TestResult = { ok: boolean; msg: string } | "loading";
type ModalAcct = { label: string; masked: string; cost: number; remaining: number; deploy: string; deploy_msg: string };

// 설정 패널 — API 키/토큰/한도를 사이트에서 입력·저장. 키는 서버에만 저장되고
// 화면엔 마스킹(끝 4자리)만. 빈칸은 기존값 유지. 저장 시 배지도 갱신(onSaved).
function SettingsPanel({ onClose, onSaved, onDeploy }: { onClose: () => void; onSaved: () => void; onDeploy: () => void }) {
  const [st, setSt] = useState<SettingsStatus | null>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [ttsJson, setTtsJson] = useState("");
  const [modalId, setModalId] = useState("");
  const [modalSecret, setModalSecret] = useState("");
  const [lim, setLim] = useState({ gemini_rpd: "", tts_chars: "", modal_credit: "" });
  const [dlDir, setDlDir] = useState("");
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<Record<string, TestResult>>({});
  const [modalAccts, setModalAccts] = useState<ModalAcct[]>([]);       // Modal 로테이션 풀
  const [acctTotal, setAcctTotal] = useState(0);                       // 실효 계정수(풀+기존)
  const [defaultIncluded, setDefaultIncluded] = useState(false);       // 기존(대표) 자동 포함?
  const [newAcct, setNewAcct] = useState({ label: "", token_id: "", token_secret: "" });
  const [acctBusy, setAcctBusy] = useState(false);
  const [acctTest, setAcctTest] = useState<TestResult | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch(`${apiBase()}/settings`);
        if (!r.ok) return;
        const j: SettingsStatus = await r.json();
        if (!live) return;
        setSt(j);
        setLim({
          gemini_rpd: String(j.limits.gemini_rpd),
          tts_chars: String(j.limits.tts_chars),
          modal_credit: String(j.limits.modal_credit),
        });
        setDlDir(j.download_dir || "");
      } catch {}
    })();
    loadAccts();
    return () => { live = false; };
  }, []);

  // 배포 진행 중인 계정이 있으면 4초마다 상태 폴링(첫 배포는 이미지 빌드로 수 분).
  useEffect(() => {
    if (!modalAccts.some((a) => a.deploy === "deploying")) return;
    const id = setInterval(loadAccts, 4000);
    return () => clearInterval(id);
  }, [modalAccts]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAccts() {
    try {
      const r = await fetch(`${apiBase()}/modal/accounts`);
      if (!r.ok) return;
      const j = await r.json();
      setModalAccts(j.accounts || []);
      setAcctTotal(j.total ?? (j.accounts || []).length);
      setDefaultIncluded(!!j.default_included);
    } catch {}
  }
  async function addAcct() {
    if (!newAcct.token_id.trim() || !newAcct.token_secret.trim() || acctBusy) return;
    setAcctBusy(true);
    try {
      const j = await postJSON<{ accounts: ModalAcct[] }>("/modal/accounts/add", newAcct);
      setModalAccts(j.accounts || []);
      setNewAcct({ label: "", token_id: "", token_secret: "" });
      setAcctTest(null);
      onSaved();
      onDeploy();   // 추가 즉시 자동 배포 시작 → 헤더 배포중 감시

    } catch (e) {
      alert(e instanceof Error && e.message ? e.message : "계정 추가 실패");
    } finally {
      setAcctBusy(false);
    }
  }
  async function delAcct(i: number) {
    try {
      const r = await fetch(`${apiBase()}/modal/accounts/${i}`, { method: "DELETE" });
      const j = await r.json();
      setModalAccts(j.accounts || []);
      onSaved();
    } catch {}
  }
  async function deployAccount(i: number) {
    try {
      await postJSON("/modal/accounts/deploy", { index: i });
      loadAccts();  // 배포중 상태 반영 시작
      onDeploy();   // 헤더 배포중 감시 시작
    } catch (e) {
      alert(e instanceof Error && e.message ? e.message : "배포 시작 실패");
    }
  }
  async function testNewAcct() {
    if (!newAcct.token_id.trim() || !newAcct.token_secret.trim()) return;
    setAcctTest("loading");
    try {
      const r = await postJSON<{ ok: boolean; msg: string }>("/settings/test", {
        service: "modal", token_id: newAcct.token_id.trim(), token_secret: newAcct.token_secret.trim(),
      });
      setAcctTest(r);
    } catch (e) {
      setAcctTest({ ok: false, msg: e instanceof Error ? e.message : "실패" });
    }
  }

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        limits: {
          gemini_rpd: Number(lim.gemini_rpd) || undefined,
          tts_chars: Number(lim.tts_chars) || undefined,
          modal_credit: Number(lim.modal_credit) || undefined,
        },
      };
      if (geminiKey.trim()) body.gemini_key = geminiKey.trim();
      if (ttsJson.trim()) body.tts_json = ttsJson.trim();
      if (modalId.trim()) body.modal_token_id = modalId.trim();
      if (modalSecret.trim()) body.modal_token_secret = modalSecret.trim();
      body.download_dir = dlDir.trim();
      const r = await postJSON<{ ok: boolean; errors: Record<string, string>; status: SettingsStatus }>("/settings", body);
      setSt(r.status);
      setGeminiKey(""); setTtsJson(""); setModalId(""); setModalSecret("");
      if (!r.ok) alert("일부 저장 실패:\n" + Object.entries(r.errors).map(([k, v]) => `${k}: ${v}`).join("\n"));
      onSaved();
    } catch (e) {
      alert(e instanceof Error && e.message ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  async function runTest(svc: string) {
    setTest((t) => ({ ...t, [svc]: "loading" }));
    try {
      const r = await postJSON<{ ok: boolean; msg: string }>("/settings/test", { service: svc });
      setTest((t) => ({ ...t, [svc]: r }));
    } catch (e) {
      setTest((t) => ({ ...t, [svc]: { ok: false, msg: e instanceof Error ? e.message : "실패" } }));
    }
  }

  function onTtsFile(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => setTtsJson(String(rd.result || ""));
    rd.readAsText(f);
  }

  const badge = (set: boolean, info?: string) =>
    set ? <span className="text-emerald-600">✓ 저장됨 {info}</span> : <span className="text-rose-500">✗ 없음</span>;
  const TestView = ({ svc }: { svc: string }) => {
    const v = test[svc];
    if (!v) return null;
    if (v === "loading") return <span className="text-[var(--ink-soft)]">테스트 중…</span>;
    return <span className={v.ok ? "text-emerald-600" : "text-rose-500"}>{v.ok ? "✓ " : "✗ "}{v.msg}</span>;
  };
  const tBtn = "rounded-full bg-white/70 px-2.5 py-1 font-semibold text-[var(--ink)] hover:bg-white/90";
  const inp = "w-full rounded-xl bg-white/85 px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]/50";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="mt-8 mb-8 w-full max-w-lg rounded-3xl glass p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-[var(--ink)]">⚙️ 설정 · API 키 / 한도</h2>
          <button onClick={onClose} className="rounded-full bg-white/60 px-3 py-1 text-sm font-bold text-[var(--ink-soft)] hover:bg-white/90">닫기 ✕</button>
        </div>
        <p className="mb-4 rounded-xl bg-amber-50/70 px-3 py-2 text-[11px] leading-relaxed text-amber-700">🔒 키는 서버에만 저장되고 화면엔 끝 4자리만 보여요. 바꿀 때만 새로 입력(빈칸이면 기존 유지). 개인망(Tailscale) 신뢰 전제.</p>

        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-sm font-bold text-[var(--ink)]">
            <span>Gemini API 키</span>
            <span className="text-[11px] font-medium">{st ? badge(st.gemini.set, st.gemini.masked) : "…"}</span>
          </div>
          <input type="password" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} placeholder="AIza… (새 키 입력 시에만)" className={inp} />
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            <button onClick={() => runTest("gemini")} className={tBtn}>테스트</button>
            <span className="text-[var(--ink-soft)]/70">(요청 1회 소모)</span>
            <TestView svc="gemini" />
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-sm font-bold text-[var(--ink)]">
            <span>Google TTS 서비스계정 JSON</span>
            <span className="max-w-[55%] truncate text-[11px] font-medium">{st ? badge(st.google_tts.set, st.google_tts.email) : "…"}</span>
          </div>
          <textarea value={ttsJson} onChange={(e) => setTtsJson(e.target.value)} placeholder={'{ "type": "service_account", ... }  붙여넣기'} rows={3} className={`${inp} font-mono text-[11px]`} />
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            <label className={`${tBtn} cursor-pointer`}>📄 파일 선택<input type="file" accept="application/json,.json" className="hidden" onChange={(e) => { onTtsFile(e.target.files); e.target.value = ""; }} /></label>
            <button onClick={() => runTest("tts")} className={tBtn}>테스트</button>
            <TestView svc="tts" />
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-sm font-bold text-[var(--ink)]">
            <span>Modal 토큰 <span className="font-medium text-[var(--ink-soft)]">(대표·배포 계정)</span></span>
            <span className="text-[11px] font-medium">{st ? badge(st.modal.set, st.modal.masked) : "…"}</span>
          </div>
          <div className="flex gap-2">
            <input value={modalId} onChange={(e) => setModalId(e.target.value)} placeholder="token_id (ak-…)" className={inp} />
            <input type="password" value={modalSecret} onChange={(e) => setModalSecret(e.target.value)} placeholder="token_secret (as-…)" className={inp} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            <button onClick={() => runTest("modal")} className={tBtn}>테스트</button>
            <TestView svc="modal" />
          </div>
        </div>

        {/* Modal 계정 풀 — 여러 계정 로테이션(병렬 처리·크레딧 분산·페일오버) */}
        <div className="mb-4 rounded-2xl bg-white/40 p-3">
          <div className="mb-1 text-sm font-bold text-[var(--ink)]">Modal 계정 풀 · 로테이션 <span className="font-medium text-[var(--ink-soft)]">(여러 영상 병렬)</span></div>
          <p className="mb-2 text-[11px] leading-relaxed text-amber-700">⚠ 무료계정 다수로 크레딧 불리기는 ToS 멀티어카운팅 위반 소지(정지 위험). 계정 추가하면 그 계정에 자동 배포됨(첫 배포는 이미지 빌드로 수 분).</p>
          {modalAccts.length > 0 ? (
            <div className="mb-2 flex flex-col gap-1">
              {modalAccts.map((a, i) => {
                const dep = a.deploy;
                const depChip =
                  dep === "done" ? <span className="text-emerald-600">✓ 배포됨</span>
                    : dep === "deploying" ? <span className="flex items-center gap-1 text-amber-600"><span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-amber-400/50 border-t-amber-600" />배포중… (수 분)</span>
                      : dep === "error" ? <span className="text-rose-500" title={a.deploy_msg}>✗ 배포실패</span>
                        : <span className="text-[var(--ink-soft)]/70">미배포</span>;
                return (
                  <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-white/60 px-2.5 py-1.5 text-[11px]">
                    <span className="font-bold text-[var(--ink)]">{a.label || `계정 ${i + 1}`}</span>
                    <span className="text-[var(--ink-soft)]">{a.masked}</span>
                    {depChip}
                    <span className={`ml-auto font-semibold ${a.remaining <= 0 ? "text-rose-500" : "text-emerald-600"}`}>{`$${a.remaining} 남음`}</span>
                    <button onClick={() => deployAccount(i)} disabled={dep === "deploying"} className="font-semibold text-[var(--accent-deep)] hover:underline disabled:opacity-50">
                      {dep === "done" ? "재배포" : "배포"}
                    </button>
                    <button onClick={() => delAcct(i)} className="font-semibold text-rose-500 hover:underline">삭제</button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mb-2 text-[11px] text-[var(--ink-soft)]">등록된 계정 없음 — 비어있으면 대표 계정 1개로 동작.</p>
          )}
          {defaultIncluded && (
            <p className="mb-2 text-[11px] font-medium text-emerald-700">＋ 기존(대표) 계정도 로테이션·크레딧에 자동 포함 · <b>총 {acctTotal}계정</b> 합산</p>
          )}
          <div className="flex flex-col gap-1.5">
            <input value={newAcct.label} onChange={(e) => setNewAcct({ ...newAcct, label: e.target.value })} placeholder="라벨(선택, 예: acctA)" className={inp} />
            <div className="flex gap-1.5">
              <input value={newAcct.token_id} onChange={(e) => setNewAcct({ ...newAcct, token_id: e.target.value })} placeholder="token_id (ak-…)" className={inp} />
              <input type="password" value={newAcct.token_secret} onChange={(e) => setNewAcct({ ...newAcct, token_secret: e.target.value })} placeholder="token_secret (as-…)" className={inp} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <button onClick={testNewAcct} className={tBtn}>테스트</button>
              <button onClick={addAcct} disabled={acctBusy || !newAcct.token_id.trim() || !newAcct.token_secret.trim()} className="btn-grad rounded-full px-3 py-1 font-bold disabled:opacity-50">+ 추가</button>
              {acctTest && (acctTest === "loading" ? <span className="text-[var(--ink-soft)]">테스트 중…</span> : <span className={acctTest.ok ? "text-emerald-600" : "text-rose-500"}>{acctTest.ok ? "✓ " : "✗ "}{acctTest.msg}</span>)}
            </div>
          </div>
        </div>

        <div className="mb-5">
          <div className="mb-1.5 text-sm font-bold text-[var(--ink)]">API 한도 <span className="font-medium text-[var(--ink-soft)]">(배지 잔여 계산 기준)</span></div>
          <div className="grid grid-cols-3 gap-2 text-[11px] text-[var(--ink-soft)]">
            <label className="flex flex-col gap-1">Gemini 요청/일<input value={lim.gemini_rpd} onChange={(e) => setLim({ ...lim, gemini_rpd: e.target.value })} inputMode="numeric" className="rounded-lg bg-white/85 px-2 py-1.5 text-sm text-[var(--ink)] outline-none" /></label>
            <label className="flex flex-col gap-1">TTS 글자/월<input value={lim.tts_chars} onChange={(e) => setLim({ ...lim, tts_chars: e.target.value })} inputMode="numeric" className="rounded-lg bg-white/85 px-2 py-1.5 text-sm text-[var(--ink)] outline-none" /></label>
            <label className="flex flex-col gap-1">Modal $/월<input value={lim.modal_credit} onChange={(e) => setLim({ ...lim, modal_credit: e.target.value })} inputMode="numeric" className="rounded-lg bg-white/85 px-2 py-1.5 text-sm text-[var(--ink)] outline-none" /></label>
          </div>
        </div>

        <div className="mb-5">
          <div className="mb-1 text-sm font-bold text-[var(--ink)]">다운로드 폴더 <span className="font-medium text-[var(--ink-soft)]">(서버 경로 · 영상 재사용 보관 위치)</span></div>
          <input value={dlDir} onChange={(e) => setDlDir(e.target.value)} placeholder="비우면 기본값 (packages/core/downloads)" className={`${inp} font-mono text-[12px]`} />
        </div>

        <button onClick={save} disabled={saving} className="btn-grad w-full rounded-full py-3 text-sm font-bold transition disabled:opacity-50">{saving ? "저장 중…" : "저장"}</button>
      </div>
    </div>
  );
}

// 생성 파이프라인 진행 표시 — 단계 체크리스트 + 부드러운 크롤 보간 + 경과/ETA + GPU 대기.
const PIPE_STEPS = ["다운로드", "자막제거", "대본", "더빙", "합성", "자막"];
const STATUS_STEP: Record<string, number> = {
  queued: 0, downloading: 0,
  removing_subtitle: 1, analyzed: 1,
  transcribing: 2, transcribed: 2,
  face_cut: 3, dubbing: 3,
  composing: 4,
  captioning: 5, done: 5,
};
const STEP_NOMINAL = [15, 120, 70, 15, 25, 20]; // 단계별 대략 소요초(ETA 근사용)

function fmtSec(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function PipelineProgress({ job }: { job: JobState | null }) {
  const status = job?.status ?? "";
  const stage = job?.stage ?? "";
  const waiting = status === "waiting_gpu";

  const [disp, setDisp] = useState(0);
  const [, forceTick] = useState(0);          // disp가 정적일 때도 경과시간 갱신용 재렌더
  const jobIdRef = useRef<string | undefined>(undefined);
  const startRef = useRef(0);
  const stageStartRef = useRef(0);
  const lastStageRef = useRef("");
  const lastStepRef = useRef(0);
  const lastStatusRef = useRef("");

  const mapped = STATUS_STEP[status];
  const stepIdx = mapped !== undefined ? mapped : lastStepRef.current;

  // 새 job → 크롤/타이머 리셋
  useEffect(() => {
    if (job?.id !== jobIdRef.current) {
      jobIdRef.current = job?.id;
      setDisp(0);
      startRef.current = Date.now();
      stageStartRef.current = Date.now();
      lastStageRef.current = stage;
    }
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 단계(status) 전환 → 진행바를 '그 단계 0'에서 다시 시작 + 단계 타이머 리셋.
  // status 기준(stage 텍스트는 %마다 바뀌므로 리셋 트리거로 못 씀).
  useEffect(() => {
    if (status !== lastStatusRef.current) {
      lastStatusRef.current = status;
      setDisp(job?.progress ?? 0);   // 현재 단계 0~100 시작점
      stageStartRef.current = Date.now();
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mapped !== undefined) lastStepRef.current = mapped;
  }, [mapped]);

  // 크롤 보간: 목표까지 이징 → 목표 정적이면 살살 전진(안 멈춰 보이게) → 대기 중엔 정지.
  useEffect(() => {
    const id = setInterval(() => {
      forceTick((n) => (n + 1) & 1023);
      setDisp((d) => {
        const t = job?.progress ?? 0;
        if (waiting) return d;
        if (t > d) return Math.min(100, d + Math.max(0.5, (t - d) * 0.2));  // 실제 진행 따라감
        // 백엔드 실측 없는 단계(ProPainter·합성 등): 현재 단계 0~92 살살 크롤.
        const idle = !!status && !["done", "analyzed", "transcribed", "error", "waiting_gpu"].includes(status);
        if (idle && d < 92) return Math.min(d + 0.25, 92);
        return d;
      });
    }, 200);
    return () => clearInterval(id);
  }, [job?.progress, status, waiting]);

  if (startRef.current === 0) startRef.current = Date.now(); // 최초 렌더 안전망
  const elapsed = (Date.now() - startRef.current) / 1000;
  const stageElapsed = (Date.now() - stageStartRef.current) / 1000;
  const etaLeft = (STEP_NOMINAL[stepIdx] ?? 30) - stageElapsed;
  const pct = Math.min(100, Math.round(disp));

  return (
    <div className="mt-5 overflow-hidden rounded-2xl glass-soft">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-3 text-[12px] font-semibold">
        {PIPE_STEPS.map((label, i) => {
          const done = status === "done" || i < stepIdx;
          const active = i === stepIdx && !done;
          return (
            <span key={label} className={done ? "text-[var(--accent-deep)]" : active ? "text-[var(--ink)]" : "text-[var(--ink-soft)]/50"}>
              {done ? "✓" : active ? "⟳" : "○"} {label}
            </span>
          );
        })}
      </div>
      <div className="flex items-center gap-3 px-5 py-2.5 text-sm font-medium text-[var(--ink)]">
        <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 ${waiting ? "border-amber-400/50 border-t-amber-500" : "border-[var(--accent)]/40 border-t-[var(--accent-deep)]"}`} />
        {waiting ? (
          <span className="text-amber-600">GPU 대기 중 · 앞 작업이 끝나면 시작돼요</span>
        ) : (
          <span>
            {stage || "준비 중"} · {pct}%
            <span className="ml-2 text-xs font-normal text-[var(--ink-soft)]">
              {fmtSec(elapsed)} 경과{etaLeft > 3 ? ` · ~${fmtSec(etaLeft)} 남음` : stepIdx < 5 ? " · 마무리 중" : ""}
            </span>
          </span>
        )}
      </div>
      <div className="h-1.5 w-full bg-white/40">
        <div className={`h-full transition-all duration-300 ${waiting ? "bg-amber-300" : "btn-grad"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [voice, setVoice] = useState("소담");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_STYLE);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [faceCutOn, setFaceCutOn] = useState(false);  // 얼굴 전체샷 컷 제거(opt-in)
  // 자막제거는 클라우드(Modal)만 사용 — 로컬 GPU 옵션은 제품에서 제외(아래 토글 주석처리).
  // 디버깅 때만 setter 복원 + 백엔드 env ALLOW_LOCAL_GPU=1. 값은 항상 "modal".
  const [subtitleBackend] = useState<"local" | "modal">("modal");
  // 타임라인 편집기서 만든/수정한 자막 줄들. 비어있으면 render때 서버가 자동생성.
  const [captionLines, setCaptionLines] = useState<CaptionLineData[]>([]);
  const [capBusy, setCapBusy] = useState(false);
  const [capEditBusy, setCapEditBusy] = useState(false);            // AI 자막 다듬기 진행중
  const [capEditPrev, setCapEditPrev] = useState<CaptionLineData[] | null>(null); // 다듬기 직전(되돌리기용)
  // CTA 문구 목록(기본3 + 사용자 추가 통합. 기본도 삭제 가능). localStorage 저장.
  const [ctaList, setCtaList] = useState<string[]>(DEFAULT_CTAS);
  const [cta, setCta] = useState(DEFAULT_CTAS[1]); // 선택된 CTA 문구(텍스트)
  const [ctaOn, setCtaOn] = useState(true);        // CTA 넣기/빼기
  const [ctaSize, setCtaSize] = useState(56);      // CTA 글자 크기(px)
  const [ctaPos, setCtaPos] = useState(0.88);      // CTA 세로 위치(0~1)
  const [usageRefresh, setUsageRefresh] = useState(0);  // API 사용량 배지 즉시 새로고침 트리거
  const bumpUsage = () => setUsageRefresh((n) => n + 1);
  const [settingsOpen, setSettingsOpen] = useState(false);  // 설정 패널(키/한도) 열림
  const [deployN, setDeployN] = useState(0);      // Modal 배포중 계정 수(헤더 표시용)
  const [deployWatch, setDeployWatch] = useState(0);  // 배포 감시 폴링 트리거
  const [preview, setPreview] = useState<PreviewInfo | null>(null);  // '확인' 미리보기(제목·썸네일)
  const [previewBusy, setPreviewBusy] = useState(false);
  const [libEntries, setLibEntries] = useState<LibraryEntry[]>([]);  // 최근 다운로드(재사용)
  // 자막 제거 품질 확인 — 군데군데 원본 vs 제거본 프레임
  const [qFrames, setQFrames] = useState<{ t: number; source: string | null; nosub: string | null }[]>([]);
  const [qBusy, setQBusy] = useState(false);
  const [qEngine, setQEngine] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CTA_STORAGE_KEY);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) {
          const list = arr.filter((s) => typeof s === "string");
          setCtaList(list);
          setCta(list[0] ?? "");
        }
      }
    } catch {}
  }, []);
  // 언마운트 시 폴링 인터벌 정리(메모리 누수/유령 폴링 방지).
  useEffect(() => stopPoll, []);
  function persistCtas(list: string[]) {
    setCtaList(list);
    try { localStorage.setItem(CTA_STORAGE_KEY, JSON.stringify(list)); } catch {}
  }
  function addCustomCta() {
    const v = window.prompt("추가할 CTA 문구를 입력하세요");
    const t = (v || "").trim();
    if (!t) return;
    if (!ctaList.includes(t)) persistCtas([...ctaList, t]);
    setCta(t);
  }
  function deleteCta(text: string) {
    const next = ctaList.filter((c) => c !== text);
    persistCtas(next);
    if (cta === text) setCta(next[0] ?? "");
  }
  const [script, setScript] = useState("");
  // 대본 버전기록(되돌리기/다시실행). past=이전버전들, future=redo스택.
  const [scriptPast, setScriptPast] = useState<string[]>([]);
  const [scriptFuture, setScriptFuture] = useState<string[]>([]);
  // 사용자가 대본을 건드렸으면(타이핑/AI수정) 폴링이 서버값으로 덮어쓰지 않음.
  const scriptDirtyRef = useRef(false);
  // textarea focus 시점 대본(blur 때 비교해 변경됐으면 1버전으로 기록).
  const lastSnapshotRef = useRef("");
  const [rate, setRate] = useState(1.0);
  const [renderSeq, setRenderSeq] = useState(0); // 재렌더 시 결과영상 캐시버스터 카운터
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsUrl, setTtsUrl] = useState("");      // 대본 전체 TTS 미리듣기 mp3

  // 현재 대본 + 선택 voice로 TTS 생성해 들어보기. voice 바꿔 다시 누르면 새로 생성.
  async function previewTts() {
    if (!script.trim() || ttsBusy) return;  // 분석 전이어도 대본만 있으면 들어보기 가능
    setTtsBusy(true);
    try {
      const d = await postJSON<{ audio?: string }>("/tts/preview", { job_id: job?.id ?? "", script, voice, speaking_rate: rate });
      if (d.audio) {
        const u = `${apiBase()}${d.audio}?t=${renderSeq}-${voice}`;
        setTtsUrl(u);
        const el = audioRef.current;
        if (el) { el.pause(); el.src = u; el.currentTime = 0; el.play().catch(() => {}); }
      } else {
        alert("음성 생성 실패.");
      }
    } catch {
      alert("음성 생성 실패. 서버 상태를 확인하세요.");
    } finally {
      setTtsBusy(false);
    }
  }

  // 제품 소구포인트: 상세페이지 URL / 캡처이미지 여러 장(파일·Ctrl+V) → 대본 결합
  const [productUrl, setProductUrl] = useState("");
  const [productImages, setProductImages] = useState<string[]>([]); // dataURL[]
  const [sellingPoints, setSellingPoints] = useState("");
  const [productBusy, setProductBusy] = useState(false);
  const [productErr, setProductErr] = useState("");
  const [productStage, setProductStage] = useState("");   // 제품 분석 진행 힌트(크롤 수십 초)
  const [pointsEdit, setPointsEdit] = useState(false);    // 소구포인트 편집/보기 토글
  useEffect(() => {
    if (!productBusy) { setProductStage(""); return; }
    const steps = ["🔎 상세페이지 여는 중…", "📄 내용 읽는 중…", "✨ 소구포인트 뽑는 중…", "✍️ 대본 작성 중…"];
    let i = 0;
    setProductStage(steps[0]);
    const id = setInterval(() => { i = Math.min(i + 1, steps.length - 1); setProductStage(steps[i]); }, 7000);
    return () => clearInterval(id);
  }, [productBusy]);

  function addImageFiles(files: FileList | File[] | null) {
    const list = Array.from(files || []).filter((f) => f.type.startsWith("image/"));
    list.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => setProductImages((prev) => [...prev, String(reader.result || "")]);
      reader.readAsDataURL(file);
    });
  }

  // 클립보드 캡처 Ctrl+V 붙여넣기(여러 장 누적)
  function onProductPaste(e: React.ClipboardEvent) {
    const imgs = Array.from(e.clipboardData.items)
      .filter((it) => it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (imgs.length) {
      e.preventDefault();
      addImageFiles(imgs);
    }
  }

  // opts.fromPoints=true → 재크롤 없이 이미 뽑은 소구포인트(sellingPoints)로 대본만 다시.
  async function generateProductScript(opts?: { fromPoints?: boolean }) {
    if (productBusy) return;
    const fromPoints = !!opts?.fromPoints && !!sellingPoints.trim();
    if (!fromPoints && !productUrl.trim() && productImages.length === 0) {
      setProductErr("제품 링크 또는 캡처 이미지를 올려주세요.");
      return;
    }
    setProductBusy(true);
    setProductErr("");
    try {
      const body = fromPoints
        ? { manual_points: sellingPoints, video_content: script, combine: true }
        : { product_url: productUrl.trim(), product_images: productImages, video_content: script, combine: true };
      const d = await postJSON<any>("/script/product", body);
      if (d.debug?.length) console.log("[제품대본 DEBUG] 전 과정 ↓\n" + d.debug.join("\n"));
      if (d.error) {
        setProductErr(d.error);
        if (d.selling_points) setSellingPoints(d.selling_points);
      } else {
        setSellingPoints(d.selling_points || "");
        if (d.script) commitScript(d.script);
      }
    } catch (e) {
      setProductErr(e instanceof Error && e.message ? e.message : "대본 생성 실패. 서버 상태를 확인하세요.");
    } finally {
      setProductBusy(false);
    }
  }

  // 현재 대본을 기록에 push하고 새 값으로 교체(되돌리기 가능). future는 초기화.
  function commitScript(next: string) {
    setScriptPast((p) => (script === next ? p : [...p, script].slice(-50)));
    if (script !== next) setScriptFuture([]);
    scriptDirtyRef.current = true;
    setScript(next);
  }

  function undoScript() {
    setScriptPast((p) => {
      if (!p.length) return p;
      const prev = p[p.length - 1];
      setScriptFuture((f) => [script, ...f].slice(0, 50));
      setScript(prev);
      scriptDirtyRef.current = true;
      return p.slice(0, -1);
    });
  }

  function redoScript() {
    setScriptFuture((f) => {
      if (!f.length) return f;
      const nextVal = f[0];
      setScriptPast((p) => [...p, script].slice(-50));
      setScript(nextVal);
      scriptDirtyRef.current = true;
      return f.slice(1);
    });
  }
  const [playing, setPlaying] = useState<string | null>(null);
  const [loadingVoice, setLoadingVoice] = useState<string | null>(null);
  const [genderFilter, setGenderFilter] = useState<"all" | "F" | "M">("all");
  const [job, setJob] = useState<JobState | null>(null);
  const [busy, setBusy] = useState(false);
  const [scriptBusy, setScriptBusy] = useState(false);
  const [refineBusy, setRefineBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loggedEngineRef = useRef<string | null>(null);  // 자막제거 엔진 콘솔 1회 기록용
  const loggedDouyinRef = useRef(false);                // 도우인 다운로드 진단 콘솔 1회 기록용
  const loggedDebugRef = useRef(false);                 // 자막제거 판단/폴백 DEBUG 1회 기록용

  function stopPoll() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  function pollJob(id: string, stopStatuses: string[], done?: (j: JobState) => void) {
    if (!id) {
      stopPoll();
      setBusy(false); setScriptBusy(false);
      alert("작업 ID를 받지 못했습니다. 백엔드 로그를 확인하세요.");
      return;
    }
    stopPoll();
    let fails = 0;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${apiBase()}/jobs/${id}`);
        if (!r.ok) {
          if (r.status === 404) {
            stopPoll();
            setBusy(false); setScriptBusy(false);
            alert("작업을 찾을 수 없습니다. 서버가 재시작되었을 수 있습니다.");
            return;
          }
          throw new Error(`HTTP ${r.status}`);
        }
        fails = 0;
        const j: JobState = await r.json();
        setJob(j);
        // 자막제거에 실제로 쓰인 엔진을 브라우저 콘솔에 1회 기록.
        if (j.subtitle_engine && loggedEngineRef.current !== j.subtitle_engine) {
          loggedEngineRef.current = j.subtitle_engine;
          const label: Record<string, string> = {
            propainter: "ProPainter (시간축 복원)",
            propainter_local: "ProPainter · 로컬 GPU (시간축 복원)",
            propainter_modal: "ProPainter · 클라우드 Modal (시간축 복원)",
            lama: "LaMa (프레임 인페인팅)",
            lama_fallback: "LaMa (ProPainter 실패 → 폴백)",
            none: "고정박스 제거 (자막 미감지)",
          };
          console.log(
            `[자막제거 엔진] ${label[j.subtitle_engine] ?? j.subtitle_engine}` +
              (j.subtitle_engine_note ? ` | 사유: ${j.subtitle_engine_note}` : "")
          );
        }
        // 자막제거 판단/폴백 전체 과정을 콘솔에 1회 기록(왜 그 엔진이 됐는지).
        if (j.subtitle_debug && j.subtitle_debug.length && j.subtitle_engine && !loggedDebugRef.current) {
          loggedDebugRef.current = true;
          console.log("[자막제거 DEBUG] 판단·폴백 과정 ↓\n" + j.subtitle_debug.join("\n"));
        }
        // 도우인 다운로드 미디어 후보/트랙 진단을 브라우저 콘솔에 1회 기록.
        // diag는 다운로드 중 점진적으로 쌓이므로(요약 → 후보별 ffprobe 결과 순),
        // 다운로드 단계가 끝난 뒤(status가 downloading/queued를 벗어남) 찍어야 전체가 나옴.
        if (
          j.douyin_diag && j.douyin_diag.length &&
          j.status !== "queued" && j.status !== "downloading" &&
          !loggedDouyinRef.current
        ) {
          loggedDouyinRef.current = true;
          console.log(
            "[Douyin 다운로드 진단] 캡처된 미디어 후보 ↓\n" + j.douyin_diag.join("\n")
          );
        }
        // 서버 대본은 사용자가 아직 안 건드렸을 때만 채움(타이핑 덮어쓰기 방지).
        if (j.script && !scriptDirtyRef.current) {
          setScript(j.script);
          scriptDirtyRef.current = true;
        }
        if (stopStatuses.includes(j.status)) {
          stopPoll();
          setBusy(false);
          setScriptBusy(false);
          done?.(j);
        }
      } catch {
        // 일시적 네트워크 오류는 관용 — 연속 실패가 누적되면 폴링 중단.
        fails += 1;
        if (fails >= 5) {
          stopPoll();
          setBusy(false);
          setScriptBusy(false);
          alert("서버 연결이 끊겼습니다.");
        }
      }
    }, 1200);
  }

  // 다운로드 라이브러리(최근 재사용 목록) 로드
  async function loadLibrary() {
    try {
      const r = await fetch(`${apiBase()}/library`);
      if (!r.ok) return;
      const j = await r.json();
      setLibEntries(j.entries || []);
    } catch {}
  }
  useEffect(() => { loadLibrary(); }, []);

  // Modal 계정 배포 감시 — 마운트 시 1회 + 배포 트리거(deployWatch) 시 폴링. 배포중 0되면 멈춤.
  useEffect(() => {
    let live = true;
    let done = false;
    const poll = async () => {
      try {
        const r = await fetch(`${apiBase()}/modal/accounts`);
        if (!r.ok) return;
        const j = await r.json();
        const n = (j.accounts || []).filter((a: { deploy: string }) => a.deploy === "deploying").length;
        if (!live) return;
        setDeployN(n);
        if (n === 0) done = true;
      } catch {}
    };
    poll();
    const id = setInterval(() => { if (done) { clearInterval(id); return; } poll(); }, 5000);
    return () => { live = false; clearInterval(id); };
  }, [deployWatch]);

  // '확인' — 다운로드 없이 제목/썸네일 미리보기. 이미 받은 영상이면 재사용·단계 표시.
  async function checkUrl(u?: string) {
    const target = (u ?? url).trim();
    if (!target || previewBusy) return;
    setPreviewBusy(true);
    setPreview(null);
    try {
      const p = await postJSON<PreviewInfo>("/preview_url", { url: target });
      setPreview(p);
    } catch (e) {
      setPreview({ url: target, in_library: false, reused: false, error: e instanceof Error ? e.message : "확인 실패" });
    } finally {
      setPreviewBusy(false);
    }
  }

  // '이어하기' — 라이브러리 보관본을 새 job으로 즉시 불러와 그 단계부터 이어서 진행.
  async function resumeFromLibrary(target: string) {
    const t = (target || "").trim();
    if (!t) return;
    try {
      const r = await postJSON<{ job_id: string; loaded: string; script: string }>(
        "/library/load", { url: t });
      const jr = await fetch(`${apiBase()}/jobs/${r.job_id}`);
      if (jr.ok) {
        const j: JobState = await jr.json();
        setJob(j);
        if (j.script) { setScript(j.script); scriptDirtyRef.current = true; }
      }
      const lbl: Record<string, string> = { source: "원본", nosub: "자막제거본", script: "대본" };
      setPreview(null);
      // 결과 영상/대본이 아래에 바로 뜸 — 이어서 대본생성/렌더 진행
      alert(`이어하기 완료 · ${lbl[r.loaded] || r.loaded}까지 불러왔어요. 아래에서 이어서 진행하세요.`);
    } catch (e) {
      alert(e instanceof Error && e.message ? e.message : "이어하기 실패");
    }
  }

  // 자막 제거 품질 확인 — 여러 지점에서 원본/제거본 프레임 추출해 비교
  async function checkQuality() {
    if (!job?.id || qBusy) return;
    setQBusy(true);
    try {
      const r = await postJSON<{ frames: typeof qFrames; engine: string | null }>(
        "/quality/frames", { job_id: job.id, count: 8 });
      setQFrames(r.frames || []);
      setQEngine(r.engine ?? null);
    } catch (e) {
      alert(e instanceof Error && e.message ? e.message : "품질 확인 실패");
    } finally {
      setQBusy(false);
    }
  }

  // opts.reuseNosub=false → 다운로드는 재사용하되 자막제거만 다시 실행(캐시 무시).
  // opts.url → 그 URL로 분석(재실행이 미리보기 URL을 정확히 쓰게).
  async function analyze(opts?: { reuseNosub?: boolean; url?: string }) {
    const target = (opts?.url ?? url).trim();
    if (!target || busy) return;
    if (opts?.url) setUrl(opts.url);
    setBusy(true);
    setJob(null);
    setQFrames([]);                   // 새 분석 → 이전 품질 프레임 비움
    loggedEngineRef.current = null;   // 새 분석 → 엔진 로그 다시 찍히게
    loggedDouyinRef.current = false;  // 새 분석 → 도우인 진단 다시 찍히게
    loggedDebugRef.current = false;   // 새 분석 → 자막제거 DEBUG 다시 찍히게
    try {
      const { job_id } = await postJSON<{ job_id?: string }>("/analyze", {
        url: target, subtitle_backend: subtitleBackend,
        reuse_nosub: opts?.reuseNosub ?? true,
      });
      if (!job_id) { setBusy(false); alert("작업 ID를 받지 못했습니다. 백엔드 로그를 확인하세요."); return; }
      // 분석 끝나면 라이브러리 갱신(새 다운로드/자막제거본 등록 반영) + 미리보기 갱신
      pollJob(job_id, ["analyzed", "error"], () => { loadLibrary(); checkUrl(url); });
    } catch {
      setBusy(false);
      alert("서버 연결 실패. 8000 포트 백엔드를 확인하세요.");
    }
  }

  async function genScript() {
    if (!job?.id || scriptBusy) return;
    setScriptBusy(true);
    try {
      await postJSON("/transcribe", { job_id: job.id });
      pollJob(job.id, ["transcribed", "error"]);
    } catch {
      setScriptBusy(false);
      alert("자동 대본 생성 실패.");
    }
  }

  // 대본 → 서버서 TTS 돌려 자동자막 줄(타임코드) 받아 타임라인 편집기에 채움.
  async function genCaptions() {
    if (!job?.id || !script.trim() || capBusy) return;
    setCapBusy(true);
    try {
      const r = await fetch(`${apiBase()}/captions/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: job.id,
          script,
          voice,
          speaking_rate: rate,
          caption_style: captionStyle,
        }),
      });
      if (!r.ok) {
        const msg = await r.text();
        alert(`자동 자막 생성 실패: ${msg}`);
        return;
      }
      const data = await r.json();
      const lines: CaptionLineData[] = (data.lines || []).map((l: CaptionLineData) => ({
        text: l.text,
        start: l.start,
        end: l.end,
        style: l.style ?? null,
      }));
      setCaptionLines(lines);
      setCapEditPrev(null);
    } catch {
      alert("자동 자막 생성 실패. 서버 연결을 확인하세요.");
    } finally {
      setCapBusy(false);
      bumpUsage();
    }
  }

  // AI/규칙 기반 자막 다듬기 — 방향(shorter/longer/natural/impact/friendly/concise)을
  // 서버 /captions/edit로 보내 변환된 줄로 교체. 직전 상태는 되돌리기용으로 보관.
  async function editCaptions(direction: string) {
    if (!captionLines.length || capEditBusy) return;
    setCapEditBusy(true);
    const prev = captionLines;
    try {
      const d = await postJSON<{ lines: CaptionLineData[] }>("/captions/edit", {
        lines: captionLines,
        direction,
        caption_style: captionStyle,
      });
      const next: CaptionLineData[] = (d.lines || []).map((l: CaptionLineData) => ({
        text: l.text,
        start: l.start,
        end: l.end,
        style: l.style ?? null,
      }));
      if (!next.length) { alert("다듬기 결과가 비었습니다."); return; }
      setCapEditPrev(prev);
      setCaptionLines(next);
    } catch (e) {
      alert(e instanceof Error && e.message ? e.message : "자막 다듬기 실패.");
    } finally {
      setCapEditBusy(false);
      bumpUsage();
    }
  }

  function undoCaptionEdit() {
    if (!capEditPrev) return;
    setCaptionLines(capEditPrev);
    setCapEditPrev(null);
  }

  async function refineScript() {
    if (!script.trim() || refineBusy) return;
    setRefineBusy(true);
    try {
      const r = await fetch(`${apiBase()}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script }),
      });
      if (!r.ok) {
        alert("AI 가공 실패. GEMINI_API_KEY 또는 auth/gemini_key.txt가 필요합니다.");
      } else {
        const data = await r.json();
        if (data.script) commitScript(data.script);
      }
    } catch {
      alert("AI 가공 실패.");
    } finally {
      setRefineBusy(false);
      bumpUsage();
    }
  }


  async function startRender() {
    if (!job?.id || busy) return;
    setRenderSeq((n) => n + 1); // 결과 영상 캐시버스터 — 재렌더 시 브라우저가 새 영상 받게
    setBusy(true);
    try {
      const { job_id } = await postJSON<{ job_id?: string }>("/render", {
        job_id: job.id, script, voice, speaking_rate: rate, cta,
        cta_on: ctaOn, cta_size: ctaSize, cta_pos: ctaPos,
        captions: captionsOn,
        caption_style: captionStyle,
        // 타임라인 편집기서 손댄 줄이 있으면 그대로, 없으면 null(서버 자동생성)
        caption_lines: captionLines.length ? captionLines : null,
        face_cut: faceCutOn,
      });
      if (!job_id) { setBusy(false); alert("렌더 작업 ID를 받지 못했습니다."); return; }
      pollJob(job_id, ["done", "error"]);
    } catch {
      setBusy(false);
      alert("렌더 요청 실패.");
    }
  }

  function toggleVoice(nick: string) {
    const el = audioRef.current;
    if (!el) return;
    if (playing === nick) {       // 같은 보이스 다시 누르면 정지
      el.pause();
      setPlaying(null);
      return;
    }
    // iOS/인앱브라우저: play()는 사용자 제스처 안에서 동기 호출돼야 한다.
    // load() 호출하면 진행중 play()가 AbortError로 취소됨 → src만 바꾸고 play().
    const src = `${window.location.origin}/voices/${encodeURIComponent(nick)}.mp3`;
    if (!el.src.endsWith(encodeURIComponent(nick) + ".mp3")) el.src = src;
    el.currentTime = 0;
    setLoadingVoice(nick);       // 클릭 즉시 로딩 표시
    setPlaying(nick);
    el.play()
      .then(() => setLoadingVoice(null))
      .catch((err: unknown) => {
        const name = err instanceof Error ? err.name : "";
        if (name === "AbortError") return; // 다른 보이스로 빠르게 전환 시 정상 — 무시
        setLoadingVoice(null);
        setPlaying(null);
        alert(`미리듣기 재생 실패: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  async function pasteFromClipboard() {
    try {
      setUrl(await navigator.clipboard.readText());
    } catch {}
  }

  const previewUrl = job?.output ? `${apiBase()}${job.output}?v=${renderSeq}` : job?.preview ? `${apiBase()}${job.preview}` : null;
  // 상대경로 → 절대경로(외부 기기/공유시 동작). 다운로드·공유 링크에만 적용.
  const absUrl = (rel: string) => (typeof window !== "undefined" ? new URL(rel, window.location.origin).href : rel);
  const visibleVoices = VOICES.filter((v) => genderFilter === "all" || v.gender === genderFilter);

  return (
    <div className="min-h-screen text-[var(--ink)]">
      {/* 보이스 미리듣기용 단일 오디오 엘리먼트(iOS 인앱브라우저 호환) */}
      <audio ref={audioRef} onEnded={() => setPlaying(null)} preload="auto" className="hidden" />
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 pt-7 pb-2 sm:px-6">
        <div className="flex items-center gap-4">
          {/* S 박스: 제목+설명 2줄 높이에 맞춘 정사각형(고정). 커진 만큼 옆 텍스트는 gap으로 우측에 */}
          <div className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl grad-anim text-2xl font-black">S</div>
          <div className="flex min-w-0 flex-col justify-center leading-tight">
            <div className="flex w-full items-center justify-between gap-2 rounded-xl grad-box px-3 py-1">
              <h1 className="whitespace-nowrap text-lg font-extrabold tracking-tight text-[var(--ink)]">쇼핑 쇼츠 메이커</h1>
              <span className="shrink-0 rounded-full bg-white/60 px-2 py-0.5 text-[11px] font-bold text-[var(--accent-deep)]">BETA</span>
            </div>
            <p className="mt-1 whitespace-nowrap text-xs text-[var(--ink-soft)]">유튜브·인스타·틱톡·도우인 링크를 한국어 쇼츠로</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {deployN > 0 && (
            <button
              onClick={() => setSettingsOpen(true)}
              title="Modal 계정 배포 중 — 클릭해 설정에서 상태 보기"
              className="flex items-center gap-1.5 rounded-full bg-amber-100/80 px-2.5 py-1 text-[11px] font-bold text-amber-700 backdrop-blur transition hover:bg-amber-100"
            >
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-400/50 border-t-amber-600" />
              Modal 배포중 {deployN}
            </button>
          )}
          <QuotaBadge refreshKey={usageRefresh} active={busy || scriptBusy} />
          <button
            onClick={() => setSettingsOpen(true)}
            title="설정 · API 키/한도"
            aria-label="설정"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white/60 text-lg backdrop-blur transition hover:bg-white/90"
          >⚙️</button>
        </div>
      </header>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} onSaved={bumpUsage} onDeploy={() => setDeployWatch((w) => w + 1)} />}

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-4 sm:px-6">
        <section className="glass rounded-[28px] p-5 sm:p-8">
          <label className="mb-3 block text-sm font-bold text-[var(--ink)]">영상 링크</label>
          <div className="flex flex-col gap-2.5 md:flex-row">
            <div className="grad-ring min-w-0 flex-1">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && analyze()}
                placeholder="공유 텍스트 또는 링크를 붙여넣으세요"
                className="h-full w-full rounded-full bg-white/85 px-5 py-3 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]/60"
              />
            </div>
            <button onClick={pasteFromClipboard} className="rounded-full bg-white/70 px-5 py-3 text-sm font-semibold text-[var(--ink)] backdrop-blur transition hover:bg-white/90">
              붙여넣기
            </button>
            <button
              onClick={() => checkUrl()}
              disabled={previewBusy || !url.trim()}
              className="rounded-full bg-white/70 px-5 py-3 text-sm font-semibold text-[var(--ink)] backdrop-blur transition hover:bg-white/90 disabled:opacity-50"
            >
              {previewBusy ? "확인 중..." : "확인"}
            </button>
            <button
              onClick={() => analyze()}
              disabled={busy || !url.trim()}
              className="btn-grad rounded-full px-7 py-3 text-sm font-bold transition"
            >
              {busy && job?.status !== "done" ? "분석 중..." : "분석"}
            </button>
          </div>

          {/* 확인(미리보기) 카드 — 제목·썸네일. 이미 받은 영상이면 재사용·단계 표시 */}
          {preview && (
            <div className="mt-3 flex gap-3 rounded-2xl glass-soft p-3">
              {preview.thumb || preview.thumbnail ? (
                <img
                  src={preview.thumb ? `${apiBase()}${preview.thumb}` : preview.thumbnail || ""}
                  alt="썸네일"
                  className="h-24 w-auto flex-none rounded-lg bg-black/20 object-cover"
                  style={{ aspectRatio: "9/16" }}
                />
              ) : (
                <div className="flex h-24 w-14 flex-none items-center justify-center rounded-lg bg-white/40 text-2xl">🎬</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {preview.in_library && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">♻ 이미 다운로드됨 · 재사용</span>}
                  {preview.platform && <span className="rounded-full bg-white/60 px-2 py-0.5 text-[10px] font-semibold text-[var(--ink-soft)]">{preview.platform}</span>}
                </div>
                <div className="mt-1 line-clamp-2 text-sm font-bold text-[var(--ink)]">
                  {preview.title || (preview.error ? "확인 실패" : preview.note ? "미리보기 제한" : "제목 없음")}
                </div>
                {preview.duration ? <div className="text-[11px] text-[var(--ink-soft)]">{fmtSec(preview.duration)}</div> : null}
                {preview.stages && <StageBadges stages={preview.stages} />}
                {preview.in_library && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => resumeFromLibrary(preview.url)}
                      className="btn-grad rounded-full px-4 py-1.5 text-xs font-bold transition"
                    >
                      ▶ 이어하기 {preview.stages ? `(${preview.stages.script ? "대본까지" : preview.stages.nosub ? "자막제거본까지" : "원본"} 불러오기)` : ""}
                    </button>
                    {preview.stages?.nosub && (
                      <button
                        onClick={() => analyze({ reuseNosub: false, url: preview.url })}
                        disabled={busy}
                        title="다운로드는 재사용하고 자막제거만 다시 실행(지금은 ProPainter). 캐시 덮어씀"
                        className="rounded-full bg-white/70 px-4 py-1.5 text-xs font-semibold text-[var(--ink)] transition hover:bg-white/90 disabled:opacity-50"
                      >
                        🔄 자막제거 다시
                      </button>
                    )}
                  </div>
                )}
                {preview.note && <div className="mt-1 text-[11px] text-amber-600">{preview.note}</div>}
                {preview.error && <div className="mt-1 text-[11px] text-rose-500">{preview.error}</div>}
              </div>
            </div>
          )}

          {/* 최근 다운로드 — 클릭하면 URL 채우고 확인(재사용). 단계 캐시는 확인 카드에 표시 */}
          {libEntries.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-[var(--ink-soft)]">📁 최근 다운로드 · 클릭해 재사용 ({libEntries.length})</summary>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {libEntries.map((e) => (
                  <button key={e.key} onClick={() => { setUrl(e.url); checkUrl(e.url); }} title={e.title || e.url} className="flex-none transition hover:opacity-80">
                    {e.has_thumb ? (
                      <img src={`${apiBase()}/library/thumb/${e.key}`} alt="" className="h-20 w-[45px] rounded-lg object-cover ring-1 ring-white/50" style={{ aspectRatio: "9/16" }} />
                    ) : (
                      <div className="flex h-20 w-[45px] items-center justify-center rounded-lg bg-white/40 text-lg">🎬</div>
                    )}
                  </button>
                ))}
              </div>
            </details>
          )}

          {/* [로컬 GPU 자막제거 제거 — 서비스는 Modal만 사용. 디버깅 시 이 토글 복원 + setSubtitleBackend 복원 + 백엔드 env ALLOW_LOCAL_GPU=1]
          <div className="mt-3 flex items-center gap-2.5 text-[13px]">
            <span className="font-semibold text-[var(--ink-soft)]">자막 제거 모델</span>
            <div className="inline-flex rounded-full bg-white/55 p-1 backdrop-blur">
              <button
                onClick={() => setSubtitleBackend("local")}
                className={`rounded-full px-4 py-1.5 font-semibold transition ${subtitleBackend === "local" ? "bg-white text-[var(--ink)] shadow" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"}`}
              >
                로컬 GPU <span className="font-normal opacity-70">(개발)</span>
              </button>
              <button
                onClick={() => setSubtitleBackend("modal")}
                className={`rounded-full px-4 py-1.5 font-semibold transition ${subtitleBackend === "modal" ? "bg-white text-[var(--ink)] shadow" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"}`}
              >
                클라우드 <span className="font-normal opacity-70">(Modal)</span>
              </button>
            </div>
          </div>
          */}

          {/* 제품 소구포인트 — 상세페이지 링크/캡처/수동 → 대본 결합 */}
          <div className="mt-6 rounded-2xl glass-soft p-5" onPaste={onProductPaste}>
            <label className="mb-1 block text-sm font-bold text-[var(--ink)]">제품 링크 <span className="font-medium text-[var(--ink-soft)]">(선택 · 영상에 맞는 상품 상세페이지)</span></label>
            <p className="mb-3 text-[13px] text-[var(--ink-soft)]">상세페이지를 읽고 소구포인트를 뽑아 영상 내용에 맞는 대본을 만들어요. 제품명은 직접 말하지 않아요.</p>
            <div className="flex flex-col gap-2.5 md:flex-row">
              <div className="grad-ring min-w-0 flex-1">
                <input
                  value={productUrl}
                  onChange={(e) => setProductUrl(e.target.value)}
                  placeholder="스마트스토어 / 올리브영 / 쿠팡 상품 링크"
                  className="h-full w-full rounded-full bg-white/85 px-5 py-3 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]/60"
                />
              </div>
              <button
                onClick={() => generateProductScript()}
                disabled={productBusy}
                className="btn-grad flex items-center justify-center gap-2 rounded-full px-7 py-3 text-sm font-bold transition disabled:opacity-50"
              >
                {productBusy && <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {productBusy ? "분석 중..." : "소구포인트 → 대본"}
              </button>
            </div>

            {productBusy && productStage && (
              <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-white/55 px-3 py-2 text-[13px] font-medium text-[var(--ink)]">
                <span className="inline-block h-3.5 w-3.5 flex-none animate-spin rounded-full border-2 border-[var(--accent)]/40 border-t-[var(--accent-deep)]" />
                {productStage} <span className="text-[var(--ink-soft)]">· 상세페이지가 크면 수십 초 걸려요</span>
              </div>
            )}

            {/* 캡처 업로드(여러 장) — 파일 선택 또는 Ctrl+V 붙여넣기. 쿠팡 등 차단 사이트 폴백 */}
            <div className="mt-2.5">
              {/* 캡쳐 버튼: 모바일선 위 '소구포인트→대본' 버튼과 같은 full-width */}
              <label className={`flex w-full cursor-pointer items-center justify-center whitespace-nowrap rounded-full bg-white/70 px-7 py-3 text-sm font-bold text-[var(--ink)] backdrop-blur transition hover:bg-white/90 md:w-auto md:justify-start md:py-2 md:text-[13px] md:font-semibold ${productErr && productImages.length === 0 ? "ring-2 ring-amber-400" : ""}`}>
                📷 캡쳐 이미지 올리기
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addImageFiles(e.target.files); e.target.value = ""; }} />
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2.5">
                <span className="text-[13px] text-[var(--ink-soft)]">또는 캡쳐 후 이 영역에서 <kbd className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[11px]">Ctrl+V</kbd> 붙여넣기</span>
                {productImages.length > 0 && (
                  <button onClick={() => setProductImages([])} className="text-xs font-semibold text-rose-500 hover:underline">전체 제거</button>
                )}
              </div>
              {productImages.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {productImages.map((src, i) => (
                    <span key={i} className="group relative">
                      <img src={src} alt={`제품 캡처 ${i + 1}`} className="h-16 w-16 rounded-lg border border-white/60 object-cover" />
                      <button
                        onClick={() => setProductImages((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[11px] font-bold text-white shadow"
                        title="제거"
                      >×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {productErr && <p className="mt-3 rounded-xl bg-rose-100/70 px-4 py-2.5 text-xs font-medium text-rose-600">⚠ {productErr}</p>}
            {sellingPoints && (() => {
              const { cat, points } = parsePoints(sellingPoints);
              return (
                <div className="mt-3 rounded-xl bg-emerald-50/70 px-4 py-3 text-xs text-emerald-900">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold">추출된 소구포인트</span>
                    <div className="flex flex-wrap gap-1.5">
                      <button onClick={() => setPointsEdit((v) => !v)} className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 transition hover:bg-white">
                        {pointsEdit ? "👁 보기" : "✏️ 편집"}
                      </button>
                      <button onClick={() => navigator.clipboard?.writeText(sellingPoints).catch(() => {})} className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 transition hover:bg-white">
                        📋 복사
                      </button>
                      <button
                        onClick={() => generateProductScript({ fromPoints: true })}
                        disabled={productBusy}
                        title="재크롤 없이 이 소구포인트로 대본만 다시 생성"
                        className="rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        🔄 대본 다시
                      </button>
                    </div>
                  </div>
                  {pointsEdit ? (
                    <textarea
                      value={sellingPoints}
                      onChange={(e) => setSellingPoints(e.target.value)}
                      rows={6}
                      className="w-full rounded-lg bg-white/70 px-3 py-2 font-sans text-xs leading-relaxed text-emerald-950 outline-none"
                    />
                  ) : points.length ? (
                    <>
                      {cat && <span className="mb-1.5 inline-block rounded-full bg-emerald-600/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">{cat}</span>}
                      <ul className="space-y-1">
                        {points.map((p, i) => (
                          <li key={i} className="flex gap-1.5"><span className="mt-px flex-none text-emerald-500">✓</span><span className="leading-relaxed">{p}</span></li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <pre className="whitespace-pre-wrap font-sans leading-relaxed">{sellingPoints}</pre>
                  )}
                </div>
              );
            })()}

            {/* 음성 생성 전 대본 확인 및 수정 */}
            <details className="mt-3" open={!!script}>
              <summary className="cursor-pointer text-xs font-semibold text-[var(--ink-soft)]">음성 생성 전 대본 확인 및 수정 ▾</summary>
              <textarea
                value={script}
                onChange={(e) => commitScript(e.target.value)}
                placeholder="여기서 대본을 확인하고 음성 생성 전에 자유롭게 수정하세요."
                rows={5}
                className="mt-2 w-full rounded-xl bg-white/85 px-4 py-2.5 text-sm leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]/60"
              />
            </details>
          </div>

          {(busy || scriptBusy) && job?.status !== "done" && <PipelineProgress job={job} />}

          {job?.error && <p className="mt-3 rounded-2xl bg-rose-100/70 px-4 py-3 text-xs font-medium text-rose-600 backdrop-blur">오류: {job.error}</p>}

          {previewUrl && (
            <div className="mt-6 flex flex-col items-center gap-2.5 rounded-3xl glass-soft p-5">
              <div className="flex w-full items-center justify-between text-xs font-semibold text-[var(--ink-soft)]">
                <span>{job?.output ? "✨ 완성 영상" : "자막 제거 미리보기"}</span>
                {busy && <span>{job?.stage} · {job?.progress}%</span>}
              </div>
              <video key={previewUrl} src={previewUrl} controls className="max-h-[440px] rounded-2xl bg-black/80 shadow-lg" style={{ aspectRatio: "9/16" }} />

              {/* 자막 제거 품질 확인 — 군데군데 원본 vs 제거본 비교(잔상·번짐 눈으로 잡기) */}
              {job?.id && (
                <div className="w-full">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={checkQuality}
                      disabled={qBusy}
                      className="rounded-full bg-white/70 px-4 py-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-white/90 disabled:opacity-50"
                    >
                      {qBusy ? "프레임 추출 중…" : "🔍 자막 제거 품질 확인 (군데군데)"}
                    </button>
                    {qEngine && <span className="text-[11px] text-[var(--ink-soft)]">엔진: {qEngine}</span>}
                  </div>
                  {qFrames.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                      {qFrames.map((f, i) => (
                        <div key={i} className="rounded-xl bg-white/40 p-1.5">
                          <div className="mb-1 text-center text-[10px] font-semibold text-[var(--ink-soft)]">{fmtSec(f.t)}</div>
                          <div className="grid grid-cols-2 gap-1">
                            <figure className="m-0">
                              {f.source ? <img src={`${apiBase()}${f.source}`} alt="원본" className="w-full rounded" /> : <div className="rounded bg-black/20" style={{ aspectRatio: "9/16" }} />}
                              <figcaption className="mt-0.5 text-center text-[9px] text-[var(--ink-soft)]">원본</figcaption>
                            </figure>
                            <figure className="m-0">
                              {f.nosub ? <img src={`${apiBase()}${f.nosub}`} alt="제거본" className="w-full rounded" /> : <div className="rounded bg-black/20" style={{ aspectRatio: "9/16" }} />}
                              <figcaption className="mt-0.5 text-center text-[9px] font-semibold text-emerald-600">제거</figcaption>
                            </figure>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-7">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-bold text-[var(--ink)]">보이스</div>
              <div className="flex gap-1.5">
                {([
                  ["all", "전체"],
                  ["F", "여성"],
                  ["M", "남성"],
                ] as const).map(([g, lbl]) => (
                  <button key={g} onClick={() => setGenderFilter(g)} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${genderFilter === g ? "btn-grad" : "bg-white/60 text-[var(--ink-soft)] hover:bg-white/80"}`}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <div className="thin-scroll grid max-h-56 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
              {visibleVoices.map((v) => (
                <div
                  key={v.name}
                  onClick={() => setVoice(v.name)}
                  className={`flex cursor-pointer items-center justify-between rounded-2xl border px-3 py-2.5 text-sm transition ${voice === v.name ? "border-transparent bg-white/90 font-bold text-[var(--accent-deep)] shadow-[0_8px_20px_-10px_rgba(106,92,255,0.5)]" : "border-white/50 bg-white/40 hover:bg-white/70"}`}
                >
                  <span className="flex items-center gap-1.5">
                    {v.name}
                    <span className={`text-[10px] font-bold ${v.gender === "F" ? "text-pink-400" : "text-sky-400"}`}>{v.gender === "F" ? "여" : "남"}</span>
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleVoice(v.name);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs text-[var(--accent-deep)] shadow transition hover:bg-[var(--c-lilac)]"
                    aria-label={`${v.name} 미리듣기`}
                  >
                    {loadingVoice === v.name ? (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent)]/40 border-t-[var(--accent-deep)]" />
                    ) : playing === v.name ? "■" : "▶"}
                  </button>
                </div>
              ))}
            </div>
            {/* 선택한 보이스 + 현재 대본으로 전체 음성 미리듣기 — 맘에 안 들면 보이스 바꿔 다시 */}
            <button
              onClick={previewTts}
              disabled={!script.trim() || ttsBusy}
              className="mt-3 w-full rounded-full bg-white/70 px-5 py-2.5 text-sm font-bold text-[var(--accent-deep)] backdrop-blur transition hover:bg-white/90 disabled:opacity-40"
            >
              {ttsBusy ? "음성 생성 중..." : `🔊 '${voice}' 목소리로 대본 들어보기`}
            </button>
            {ttsUrl && <p className="mt-1.5 text-center text-[11px] text-[var(--ink-soft)]">보이스를 바꾼 뒤 다시 누르면 새 음성으로 들려줘요.</p>}
          </div>

          <div className="mt-7">
            <div className="rounded-2xl border border-white/50 bg-white/40 p-3.5 backdrop-blur">
              {/* CTA 넣기/빼기 체크박스 */}
              <label className="mb-2 flex cursor-pointer items-center gap-2 px-1 text-xs font-bold text-[var(--ink-soft)]">
                <input type="checkbox" checked={ctaOn} onChange={(e) => setCtaOn(e.target.checked)} className="h-4 w-4 accent-[var(--accent-deep)]" />
                CTA 자막 넣기
              </label>
              <div className="flex items-center gap-1.5">
                <select value={cta} onChange={(e) => setCta(e.target.value)} disabled={!ctaOn} className="h-12 min-w-0 flex-1 truncate rounded-xl border border-white/50 bg-white/70 px-3 text-[13px] text-[var(--ink)] outline-none disabled:opacity-40" style={{ fontFamily: "ChosunGu, system-ui, sans-serif", lineHeight: "normal" }}>
                  {ctaList.length === 0 && <option value="">(CTA 없음)</option>}
                  {ctaList.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <button onClick={addCustomCta} disabled={!ctaOn} title="CTA 문구 추가" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70 text-lg font-bold text-[var(--accent-deep)] transition hover:bg-white/90 disabled:opacity-40">+</button>
                {cta && ctaList.includes(cta) && (
                  <button onClick={() => deleteCta(cta)} disabled={!ctaOn} title="선택한 문구 삭제" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100/70 text-sm font-bold text-rose-600 transition hover:bg-rose-200/70 disabled:opacity-40">×</button>
                )}
              </div>
              {ctaOn && (
                <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <label className="px-1 text-xs font-bold text-[var(--ink-soft)]">
                    글자 크기 {ctaSize}px
                    <input type="range" min={24} max={120} value={ctaSize} onChange={(e) => setCtaSize(+e.target.value)} className="mt-1 w-full accent-[var(--accent-deep)]" />
                  </label>
                  <label className="px-1 text-xs font-bold text-[var(--ink-soft)]">
                    세로 위치 {Math.round(ctaPos * 100)}%
                    <input type="range" min={0} max={100} value={Math.round(ctaPos * 100)} onChange={(e) => setCtaPos(+e.target.value / 100)} className="mt-1 w-full accent-[var(--accent-deep)]" />
                  </label>
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label={`배속 ${rate.toFixed(1)}x`}>
              <input type="range" min={0.5} max={2} step={0.1} value={rate} onChange={(e) => setRate(parseFloat(e.target.value))} className="mt-1.5 w-full accent-[var(--accent-deep)]" />
            </Field>
            <Field label="중국어 자막 제거">
              <div className="rounded-xl bg-emerald-100/60 px-3 py-2 text-xs font-semibold text-emerald-700">분석 단계에서 자동 처리</div>
            </Field>
          </div>

          <div className="mt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-bold text-[var(--ink)]">한국어 대본</label>
              <div className="flex flex-wrap gap-2">
                <button onClick={genScript} disabled={!job?.id || scriptBusy} className="flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-[var(--accent-deep)] backdrop-blur transition hover:bg-white/90 disabled:opacity-40">
                  {scriptBusy && <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent)]/40 border-t-[var(--accent-deep)]" />}
                  {scriptBusy ? "생성 중..." : "자동 대본 생성"}
                </button>
                <button onClick={refineScript} disabled={!script.trim() || refineBusy} className="flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-fuchsia-600 backdrop-blur transition hover:bg-white/90 disabled:opacity-40">
                  {refineBusy && <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-fuchsia-300 border-t-fuchsia-600" />}
                  {refineBusy ? "가공 중..." : "AI로 가공"}
                </button>
                <button onClick={undoScript} disabled={!scriptPast.length} title="되돌리기 (Ctrl+Z)" className="rounded-full bg-white/50 px-3 py-1.5 text-xs font-bold text-[var(--ink-soft)] backdrop-blur transition hover:bg-white/80 disabled:opacity-30">
                  ↶ 되돌리기
                </button>
                <button onClick={redoScript} disabled={!scriptFuture.length} title="다시실행 (Ctrl+Shift+Z)" className="rounded-full bg-white/50 px-3 py-1.5 text-xs font-bold text-[var(--ink-soft)] backdrop-blur transition hover:bg-white/80 disabled:opacity-30">
                  ↷ 다시실행
                </button>
              </div>
            </div>
            {job?.status === "transcribed" && job?.has_speech === false && (
              <div className="mb-2 rounded-xl bg-amber-50/70 px-3 py-2 text-[13px] font-medium text-amber-700">
                🔇 이 영상엔 음성이 없어요. 대본을 직접 입력하거나 아래 <b>제품 링크</b>로 만들어보세요.
              </div>
            )}
            <textarea
              value={script}
              onChange={(e) => { scriptDirtyRef.current = true; setScript(e.target.value); }}
              onFocus={() => { lastSnapshotRef.current = script; }}
              onBlur={() => { if (lastSnapshotRef.current !== script) { setScriptPast((p) => [...p, lastSnapshotRef.current].slice(-50)); setScriptFuture([]); } }}
              onKeyDown={(e) => {
                const mod = e.ctrlKey || e.metaKey;
                if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undoScript(); }
                else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redoScript(); }
              }}
              rows={5}
              placeholder="자동 대본 생성 버튼을 누르거나 직접 입력하세요."
              className="w-full rounded-2xl border border-white/50 bg-white/75 px-4 py-3 text-sm leading-relaxed text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-soft)]/60 focus:bg-white/90 focus:ring-2 focus:ring-[var(--accent)]/30"
            />
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-medium text-[var(--ink-soft)]">{job?.id ? "분석 완료 후 대본을 확인하고 작업을 시작하세요." : "먼저 링크를 분석하세요."}</p>
            <button onClick={startRender} disabled={!job?.id || busy} className="btn-grad rounded-full px-9 py-3 text-sm font-bold transition">
              {busy && job?.status !== "analyzed" ? `${job?.stage || "처리 중"}...` : "작업 시작 ✨"}
            </button>
          </div>
        </section>

        <div className="mt-8">
          <div className="mb-4 flex items-center justify-between rounded-3xl glass px-6 py-4">
            <div>
              <div className="text-sm font-bold text-[var(--ink)]">얼굴샷 컷 제거</div>
              <div className="text-xs text-[var(--ink-soft)]">인물 얼굴이 크게 잡힌 구간을 자동으로 잘라내고 제품샷 위주로 이어붙입니다. (남길 분량이 너무 짧으면 자동으로 컷을 생략합니다.)</div>
            </div>
            <button
              onClick={() => setFaceCutOn((v) => !v)}
              className={`relative h-7 w-12 flex-none rounded-full transition-colors ${faceCutOn ? "btn-grad" : "bg-white/60"}`}
              aria-label="얼굴샷 컷 제거 토글"
            >
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${faceCutOn ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
          <div className="mb-8 flex items-center justify-between rounded-3xl glass px-6 py-4">
            <div>
              <div className="text-sm font-bold text-[var(--ink)]">자동 자막</div>
              <div className="text-xs text-[var(--ink-soft)]">TTS 대본을 타임코드에 맞춰 자막으로 입힙니다. 아래는 기본 스타일이며, 타임라인에서 줄별로 바꿀 수 있습니다.</div>
            </div>
            <button
              onClick={() => setCaptionsOn((v) => !v)}
              className={`relative h-7 w-12 flex-none rounded-full transition-colors ${captionsOn ? "btn-grad" : "bg-white/60"}`}
              aria-label="자동 자막 토글"
            >
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${captionsOn ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
          <CaptionEditor value={captionStyle} onChange={setCaptionStyle} />
          <div className="mt-4">
            <CaptionTimeline
              lines={captionLines}
              onChange={setCaptionLines}
              defaultStyle={captionStyle}
              onGenerate={genCaptions}
              generating={capBusy}
              hasScript={!!job?.id && !!script.trim()}
              onAiEdit={editCaptions}
              aiEditBusy={capEditBusy}
              onUndoEdit={undoCaptionEdit}
              canUndoEdit={!!capEditPrev}
            />
          </div>
        </div>

        {job?.output && (
          <section className="mt-7 flex flex-col gap-3 rounded-3xl glass px-5 py-5 sm:px-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-bold text-emerald-600">✅ 영상 완성</div>
              <div className="flex flex-wrap gap-2">
                <a href={absUrl(previewUrl ?? `${apiBase()}${job.output}`)} download target="_blank" rel="noopener" className="rounded-full bg-emerald-500 px-6 py-2.5 text-sm font-bold text-white shadow-[0_12px_24px_-10px_rgba(16,185,129,0.6)] transition hover:bg-emerald-600">
                  다운로드
                </a>
                <button
                  onClick={async () => {
                    const link = absUrl(previewUrl ?? `${apiBase()}${job!.output}`);
                    // 모바일 공유시트(가능하면) — 아니면 클립보드 복사
                    const navAny = navigator as Navigator & { share?: (d: { title?: string; url?: string }) => Promise<void> };
                    try {
                      if (navAny.share) { await navAny.share({ title: "쇼핑 쇼츠", url: link }); return; }
                      await navigator.clipboard.writeText(link);
                      alert("영상 링크를 복사했어요. 폰 브라우저에 붙여넣어 저장하세요.");
                    } catch {}
                  }}
                  className="rounded-full bg-white/70 px-6 py-2.5 text-sm font-bold text-[var(--accent-deep)] backdrop-blur transition hover:bg-white/90"
                >
                  공유 / 링크
                </button>
              </div>
            </div>
            {/* iOS는 download가 무시됨 — 아래 영상 길게 눌러 "비디오 저장"으로도 받을 수 있음 */}
            <video src={previewUrl ?? `${apiBase()}${job.output}`} controls playsInline className="mx-auto max-h-[460px] rounded-2xl bg-black/80" style={{ aspectRatio: "9/16" }} />
            <p className="text-center text-[11px] text-[var(--ink-soft)]">아이폰은 위 영상을 길게 눌러 &quot;비디오 저장&quot;으로도 받을 수 있어요.</p>
          </section>
        )}
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/50 bg-white/40 p-3.5 backdrop-blur">
      {/* 라벨 좌측 들여쓰기 — 아래 내용 박스(px-3)와 시작점 맞춤 */}
      <div className="mb-2 px-1 text-xs font-bold text-[var(--ink-soft)]">{label}</div>
      {children}
    </div>
  );
}
