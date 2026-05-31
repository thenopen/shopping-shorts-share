"use client";

import { useRef, useState } from "react";
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

const CTAS = [
  { key: "comment", label: "제품 정보는 고정 댓글에서 확인하세요!" },
  { key: "profile", label: "구매처는 프로필 링크에 있어요." },
  { key: "link", label: "자세한 내용은 하단 링크를 눌러주세요." },
];

const API_PORT = process.env.NEXT_PUBLIC_API_PORT || "8000";

function apiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE;
  if (typeof window === "undefined") return "http://127.0.0.1:8000";
  return `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
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
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [voice, setVoice] = useState("소담");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_STYLE);
  const [captionsOn, setCaptionsOn] = useState(true);
  // 타임라인 편집기서 만든/수정한 자막 줄들. 비어있으면 render때 서버가 자동생성.
  const [captionLines, setCaptionLines] = useState<CaptionLineData[]>([]);
  const [capBusy, setCapBusy] = useState(false);
  const [cta, setCta] = useState("profile");
  const [script, setScript] = useState("");
  // 대본 버전기록(되돌리기/다시실행). past=이전버전들, future=redo스택.
  const [scriptPast, setScriptPast] = useState<string[]>([]);
  const [scriptFuture, setScriptFuture] = useState<string[]>([]);
  // 사용자가 대본을 건드렸으면(타이핑/AI수정) 폴링이 서버값으로 덮어쓰지 않음.
  const scriptDirtyRef = useRef(false);
  // textarea focus 시점 대본(blur 때 비교해 변경됐으면 1버전으로 기록).
  const lastSnapshotRef = useRef("");
  const [rate, setRate] = useState(1.0);

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
        const r = await fetch(`${apiBase()}/jobs/${id}`);
        const j: JobState = await r.json();
        setJob(j);
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
      } catch {}
    }, 1200);
  }

  async function analyze() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setJob(null);
    try {
      const r = await fetch(`${apiBase()}/analyze`, {
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
      await fetch(`${apiBase()}/transcribe`, {
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
    } catch {
      alert("자동 자막 생성 실패. 서버 연결을 확인하세요.");
    } finally {
      setCapBusy(false);
    }
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
    }
  }

  async function agentRefineScript() {
    if (!script.trim() || agentBusy) return;
    setAgentBusy(true);
    setAgentNotes("");
    try {
      const r = await fetch(`${apiBase()}/agent/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, mode: "shopping_shorts" }),
      });
      if (!r.ok) {
        const msg = await r.text();
        alert(`Antigravity 검수 실패: ${msg}`);
      } else {
        const data = await r.json();
        if (data.script) commitScript(data.script);
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
      const r = await fetch(`${apiBase()}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: job.id, script, voice, speaking_rate: rate, cta,
          captions: captionsOn,
          caption_style: captionStyle,
          // 타임라인 편집기서 손댄 줄이 있으면 그대로, 없으면 null(서버 자동생성)
          caption_lines: captionLines.length ? captionLines : null,
        }),
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

  const previewUrl = job?.output ? `${apiBase()}${job.output}` : job?.preview ? `${apiBase()}${job.preview}` : null;
  const visibleVoices = VOICES.filter((v) => genderFilter === "all" || v.gender === genderFilter);

  return (
    <div className="min-h-screen text-[var(--ink)]">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 pt-7 pb-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl btn-grad text-lg font-black">S</div>
          <div className="leading-tight">
            <h1 className="text-xl font-extrabold tracking-tight">쇼핑 쇼츠 메이커</h1>
            <p className="text-xs text-[var(--ink-soft)]">유튜브·인스타·틱톡·도우인 링크를 한국어 쇼츠로</p>
          </div>
          <span className="ml-1 rounded-full bg-white/60 px-2.5 py-0.5 text-[11px] font-bold text-[var(--accent-deep)] backdrop-blur">BETA</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-16 pt-4">
        <section className="glass rounded-[28px] p-7 sm:p-8">
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
              onClick={analyze}
              disabled={busy || !url.trim()}
              className="btn-grad rounded-full px-7 py-3 text-sm font-bold transition"
            >
              {busy && job?.status !== "done" ? "분석 중..." : "분석"}
            </button>
          </div>

          {(busy || scriptBusy) && job?.status !== "done" && (
            <div className="mt-5 overflow-hidden rounded-2xl glass-soft">
              <div className="flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-[var(--ink)]">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)]/40 border-t-[var(--accent-deep)]" />
                {job?.stage || "준비 중"} · {job?.progress ?? 0}%
              </div>
              <div className="h-1.5 w-full bg-white/40">
                <div className="h-full btn-grad transition-all duration-500" style={{ width: `${job?.progress ?? 0}%` }} />
              </div>
            </div>
          )}

          {job?.error && <p className="mt-3 rounded-2xl bg-rose-100/70 px-4 py-3 text-xs font-medium text-rose-600 backdrop-blur">오류: {job.error}</p>}

          {previewUrl && (
            <div className="mt-6 flex flex-col items-center gap-2.5 rounded-3xl glass-soft p-5">
              <div className="flex w-full items-center justify-between text-xs font-semibold text-[var(--ink-soft)]">
                <span>{job?.output ? "✨ 완성 영상" : "자막 제거 미리보기"}</span>
                {busy && <span>{job?.stage} · {job?.progress}%</span>}
              </div>
              <video key={previewUrl} src={previewUrl} controls className="max-h-[440px] rounded-2xl bg-black/80 shadow-lg" style={{ aspectRatio: "9/16" }} />
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
                    {playing === v.name ? "■" : "▶"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-7 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="CTA">
              <select value={cta} onChange={(e) => setCta(e.target.value)} className="w-full rounded-xl border border-white/50 bg-white/70 px-3 py-2 text-sm text-[var(--ink)] outline-none">
                {CTAS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
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
                <button onClick={genScript} disabled={!job?.id || scriptBusy} className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-[var(--accent-deep)] backdrop-blur transition hover:bg-white/90 disabled:opacity-40">
                  {scriptBusy ? "생성 중..." : "자동 대본 생성"}
                </button>
                <button onClick={refineScript} disabled={!script.trim() || refineBusy} className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-fuchsia-600 backdrop-blur transition hover:bg-white/90 disabled:opacity-40">
                  {refineBusy ? "가공 중..." : "AI로 가공"}
                </button>
                <button onClick={agentRefineScript} disabled={!script.trim() || agentBusy} className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-amber-600 backdrop-blur transition hover:bg-white/90 disabled:opacity-40">
                  {agentBusy ? "검수 중..." : "Antigravity 검수"}
                </button>
                <button onClick={undoScript} disabled={!scriptPast.length} title="되돌리기 (Ctrl+Z)" className="rounded-full bg-white/50 px-3 py-1.5 text-xs font-bold text-[var(--ink-soft)] backdrop-blur transition hover:bg-white/80 disabled:opacity-30">
                  ↶ 되돌리기
                </button>
                <button onClick={redoScript} disabled={!scriptFuture.length} title="다시실행 (Ctrl+Shift+Z)" className="rounded-full bg-white/50 px-3 py-1.5 text-xs font-bold text-[var(--ink-soft)] backdrop-blur transition hover:bg-white/80 disabled:opacity-30">
                  ↷ 다시실행
                </button>
              </div>
            </div>
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
            {agentNotes && <p className="mt-2 rounded-2xl bg-amber-100/60 px-3 py-2 text-xs font-medium text-amber-700 backdrop-blur">{agentNotes}</p>}
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-medium text-[var(--ink-soft)]">{job?.id ? "분석 완료 후 대본을 확인하고 작업을 시작하세요." : "먼저 링크를 분석하세요."}</p>
            <button onClick={startRender} disabled={!job?.id || busy} className="btn-grad rounded-full px-9 py-3 text-sm font-bold transition">
              {busy && job?.status !== "analyzed" ? `${job?.stage || "처리 중"}...` : "작업 시작 ✨"}
            </button>
          </div>
        </section>

        <div className="mt-7">
          <div className="mb-4 flex items-center justify-between rounded-3xl glass px-6 py-4">
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
            />
          </div>
        </div>

        {job?.output && (
          <section className="mt-7 flex flex-wrap items-center justify-between gap-3 rounded-3xl glass px-7 py-5">
            <div className="text-sm font-bold text-emerald-600">✅ 영상 완성</div>
            <a href={`${apiBase()}${job.output}`} download className="rounded-full bg-emerald-500 px-7 py-2.5 text-sm font-bold text-white shadow-[0_12px_24px_-10px_rgba(16,185,129,0.6)] transition hover:bg-emerald-600">
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
    <div className="rounded-2xl border border-white/50 bg-white/40 p-3.5 backdrop-blur">
      <div className="mb-2 text-xs font-bold text-[var(--ink-soft)]">{label}</div>
      {children}
    </div>
  );
}
