"use client";

import { useRef, useState } from "react";
import CaptionEditor, { CaptionStyle, DEFAULT_STYLE } from "./CaptionEditor";

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

const CTAS = [
  { key: "comment", label: "제품 정보는 고정 댓글에서 확인하세요!" },
  { key: "profile", label: "구매처는 프로필 링크에 있어요." },
  { key: "link", label: "자세한 내용은 하단 링크를 눌러주세요." },
];

const API = "http://127.0.0.1:8000";

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
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [voice, setVoice] = useState("소담");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_STYLE);
  const [cta, setCta] = useState("profile");
  const [script, setScript] = useState("");
  const [rate, setRate] = useState(1.0);
  const [playing, setPlaying] = useState<string | null>(null);
  const [genderFilter, setGenderFilter] = useState<"all" | "F" | "M">("all");
  const [job, setJob] = useState<JobState | null>(null);
  const [busy, setBusy] = useState(false);
  const [scriptBusy, setScriptBusy] = useState(false);
  const [refineBusy, setRefineBusy] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentNotes, setAgentNotes] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPoll() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  function pollJob(id: string, stopStatuses: string[], done?: (j: JobState) => void) {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${API}/jobs/${id}`);
        const j: JobState = await r.json();
        setJob(j);
        if (j.script) setScript(j.script);
        if (stopStatuses.includes(j.status)) {
          stopPoll();
          setBusy(false);
          setScriptBusy(false);
          done?.(j);
        }
      } catch {}
    }, 1200);
  }

  async function analyze() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setJob(null);
    try {
      const r = await fetch(`${API}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const { job_id } = await r.json();
      pollJob(job_id, ["analyzed", "error"]);
    } catch {
      setBusy(false);
      alert("서버 연결 실패. 8000 포트 백엔드를 확인하세요.");
    }
  }

  async function genScript() {
    if (!job?.id || scriptBusy) return;
    setScriptBusy(true);
    try {
      await fetch(`${API}/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: job.id }),
      });
      pollJob(job.id, ["transcribed", "error"]);
    } catch {
      setScriptBusy(false);
      alert("자동 대본 생성 실패.");
    }
  }

  async function refineScript() {
    if (!script.trim() || refineBusy) return;
    setRefineBusy(true);
    try {
      const r = await fetch(`${API}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script }),
      });
      if (!r.ok) {
        alert("AI 가공 실패. GEMINI_API_KEY 또는 auth/gemini_key.txt가 필요합니다.");
      } else {
        const data = await r.json();
        if (data.script) setScript(data.script);
      }
    } catch {
      alert("AI 가공 실패.");
    } finally {
      setRefineBusy(false);
    }
  }

  async function agentRefineScript() {
    if (!script.trim() || agentBusy) return;
    setAgentBusy(true);
    setAgentNotes("");
    try {
      const r = await fetch(`${API}/agent/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, mode: "shopping_shorts" }),
      });
      if (!r.ok) {
        const msg = await r.text();
        alert(`Antigravity 검수 실패: ${msg}`);
      } else {
        const data = await r.json();
        if (data.script) setScript(data.script);
        if (data.notes) setAgentNotes(data.notes);
      }
    } catch {
      alert("Antigravity 검수 실패.");
    } finally {
      setAgentBusy(false);
    }
  }

  async function startRender() {
    if (!job?.id || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: job.id, script, voice, speaking_rate: rate, cta }),
      });
      const { job_id } = await r.json();
      pollJob(job_id, ["done", "error"]);
    } catch {
      setBusy(false);
      alert("렌더 요청 실패.");
    }
  }

  function toggleVoice(nick: string) {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (playing === nick) {
      setPlaying(null);
      return;
    }
    const audio = new Audio(`/voices/${encodeURIComponent(nick)}.mp3`);
    audioRef.current = audio;
    audio.onended = () => setPlaying(null);
    audio.play().catch(() => setPlaying(null));
    setPlaying(nick);
  }

  async function pasteFromClipboard() {
    try {
      setUrl(await navigator.clipboard.readText());
    } catch {}
  }

  const previewUrl = job?.output ? `${API}${job.output}` : job?.preview ? `${API}${job.preview}` : null;
  const visibleVoices = VOICES.filter((v) => genderFilter === "all" || v.gender === genderFilter);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white font-bold">S</div>
          <h1 className="text-xl font-extrabold tracking-tight">쇼핏 쇼츠 메이커</h1>
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-600">BETA</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="mb-2 block text-sm font-semibold text-slate-700">도우인 영상 링크</label>
          <div className="flex flex-col gap-2 md:flex-row">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && analyze()}
              placeholder="공유 텍스트 또는 링크를 붙여넣으세요"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <button onClick={pasteFromClipboard} className="rounded-lg bg-slate-800 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700">
              붙여넣기
            </button>
            <button
              onClick={analyze}
              disabled={busy || !url.trim()}
              className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow hover:bg-indigo-500 disabled:opacity-40"
            >
              {busy && job?.status !== "done" ? "분석 중..." : "분석"}
            </button>
          </div>

          {(busy || scriptBusy) && job?.status !== "done" && (
            <div className="mt-5 flex items-center gap-3 rounded-lg bg-slate-900 px-5 py-4 text-sm text-zinc-300">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-500 border-t-white" />
              {job?.stage || "준비 중"} · {job?.progress ?? 0}%
            </div>
          )}

          {job?.error && <p className="mt-3 rounded-lg bg-rose-50 px-4 py-2 text-xs text-rose-600">오류: {job.error}</p>}

          {previewUrl && (
            <div className="mt-6 flex flex-col items-center gap-2 rounded-xl bg-zinc-950 p-5">
              <div className="flex w-full items-center justify-between text-xs text-zinc-300">
                <span>{job?.output ? "완성 영상" : "자막 제거 미리보기"}</span>
                {busy && <span>{job?.stage} · {job?.progress}%</span>}
              </div>
              <video key={previewUrl} src={previewUrl} controls className="max-h-[440px] rounded-lg bg-black" style={{ aspectRatio: "9/16" }} />
            </div>
          )}

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-700">보이스</div>
              <div className="flex gap-1">
                {([
                  ["all", "전체"],
                  ["F", "여성"],
                  ["M", "남성"],
                ] as const).map(([g, lbl]) => (
                  <button key={g} onClick={() => setGenderFilter(g)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${genderFilter === g ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-500"}`}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
              {visibleVoices.map((v) => (
                <div
                  key={v.name}
                  onClick={() => setVoice(v.name)}
                  className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm ${voice === v.name ? "border-indigo-400 bg-indigo-50 font-semibold text-indigo-700" : "border-slate-200 hover:bg-slate-50"}`}
                >
                  <span className="flex items-center gap-1.5">
                    {v.name}
                    <span className={`text-[10px] ${v.gender === "F" ? "text-pink-400" : "text-sky-400"}`}>{v.gender === "F" ? "여" : "남"}</span>
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleVoice(v.name);
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs shadow hover:bg-indigo-100"
                    aria-label={`${v.name} 미리듣기`}
                  >
                    {playing === v.name ? "■" : "▶"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="CTA">
              <select value={cta} onChange={(e) => setCta(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                {CTAS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`배속 ${rate.toFixed(1)}x`}>
              <input type="range" min={0.5} max={2} step={0.1} value={rate} onChange={(e) => setRate(parseFloat(e.target.value))} className="w-full" />
            </Field>
            <Field label="중국어 자막 제거">
              <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">분석 단계에서 자동 처리</div>
            </Field>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-700">한국어 대본</label>
              <div className="flex gap-2">
                <button onClick={genScript} disabled={!job?.id || scriptBusy} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-40">
                  {scriptBusy ? "생성 중..." : "자동 대본 생성"}
                </button>
                <button onClick={refineScript} disabled={!script.trim() || refineBusy} className="rounded-lg border border-fuchsia-200 bg-fuchsia-50 px-3 py-1.5 text-xs font-semibold text-fuchsia-700 hover:bg-fuchsia-100 disabled:opacity-40">
                  {refineBusy ? "가공 중..." : "AI로 가공"}
                </button>
                <button onClick={agentRefineScript} disabled={!script.trim() || agentBusy} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-40">
                  {agentBusy ? "검수 중..." : "Antigravity 검수"}
                </button>
              </div>
            </div>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={5}
              placeholder="자동 대본 생성 버튼을 누르거나 직접 입력하세요."
              className="w-full rounded-lg border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            {agentNotes && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{agentNotes}</p>}
          </div>

          <div className="mt-6 flex items-center justify-between">
            <p className="text-xs text-slate-400">{job?.id ? "분석 완료 후 대본을 확인하고 작업을 시작하세요." : "먼저 링크를 분석하세요."}</p>
            <button onClick={startRender} disabled={!job?.id || busy} className="rounded-lg bg-indigo-600 px-8 py-3 text-sm font-bold text-white shadow hover:bg-indigo-500 disabled:opacity-40">
              {busy && job?.status !== "analyzed" ? `${job?.stage || "처리 중"}...` : "작업 시작"}
            </button>
          </div>
        </section>

        <div className="mt-8">
          <CaptionEditor value={captionStyle} onChange={setCaptionStyle} />
        </div>

        {job?.output && (
          <section className="mt-8 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-5">
            <div className="text-sm font-semibold text-emerald-700">영상 완성</div>
            <a href={`${API}${job.output}`} download className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-emerald-700">
              다운로드
            </a>
          </section>
        )}
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
      <div className="mb-2 text-xs font-semibold text-slate-500">{label}</div>
      {children}
    </div>
  );
}
