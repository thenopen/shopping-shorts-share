"use client";

import { useState, useRef } from "react";
import CaptionEditor, { CaptionStyle, DEFAULT_STYLE } from "./CaptionEditor";

const VOICES: { name: string; gender: "F" | "M" }[] = [
  { name: "소담", gender: "F" }, { name: "서연", gender: "F" }, { name: "하은", gender: "F" },
  { name: "지우", gender: "F" }, { name: "수아", gender: "F" }, { name: "나윤", gender: "F" },
  { name: "예린", gender: "F" }, { name: "가은", gender: "F" }, { name: "리아", gender: "F" },
  { name: "채원", gender: "F" }, { name: "유나", gender: "F" }, { name: "민서", gender: "F" },
  { name: "태형", gender: "M" }, { name: "준호", gender: "M" }, { name: "도윤", gender: "M" },
  { name: "시우", gender: "M" }, { name: "재민", gender: "M" }, { name: "우진", gender: "M" },
  { name: "성호", gender: "M" }, { name: "건우", gender: "M" }, { name: "현우", gender: "M" },
  { name: "동현", gender: "M" }, { name: "민준", gender: "M" },
];
const CTAS = [
  { key: "comment", label: "제품 정보는 고정 댓글을 확인해주세요!" },
  { key: "profile", label: "구매처는 프로필 링크에 있어요!" },
  { key: "link", label: "자세한 내용은 하단 링크를 클릭하세요!" },
];

const API = "http://127.0.0.1:8000";

type JobState = {
  id: string;
  status: string;
  progress: number;
  stage: string;
  script: string;
  preview: string | null;   // 자막제거 영상 경로
  output: string | null;    // 최종 영상 경로
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
  const [subMode, setSubMode] = useState<"bar" | "blur">("bar");
  const [playing, setPlaying] = useState<string | null>(null);
  const [genderFilter, setGenderFilter] = useState<"all" | "F" | "M">("all");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [job, setJob] = useState<JobState | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 작업 상태 폴링
  function pollJob(id: string, onAnalyzed: (j: JobState) => void) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${API}/jobs/${id}`);
        const j: JobState = await r.json();
        setJob(j);
        if (j.status === "analyzed") {
          clearInterval(pollRef.current!);
          setBusy(false);
          if (j.script) setScript(j.script);
          onAnalyzed(j);
        } else if (j.status === "done" || j.status === "error") {
          clearInterval(pollRef.current!);
          setBusy(false);
        }
      } catch {}
    }, 1500);
  }

  // 1단계: 분석 (다운로드 + 자막제거 + 자동대본)
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
      pollJob(job_id, () => {});
    } catch {
      setBusy(false);
      alert("서버 연결 실패. 서버가 켜져있는지 확인하세요 (포트 8000).");
    }
  }

  // 2단계: 작업시작 (대본+설정 → 최종 렌더)
  async function startRender() {
    if (!job?.id || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: job.id, script, voice,
          speaking_rate: rate, cta,
        }),
      });
      const { job_id } = await r.json();
      pollJob(job_id, () => {});
    } catch {
      setBusy(false);
      alert("렌더 요청 실패.");
    }
  }

  // 성우 미리듣기 — 재생/정지 토글. 다른 성우 누르면 이전건 멈춤.
  function toggleVoice(nick: string) {
    // 재생중인 거 정지
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    // 같은 거 다시 누르면 정지만
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
      const t = await navigator.clipboard.readText();
      setUrl(t);
    } catch {
      /* 권한 거부시 무시 */
    }
  }

  const previewUrl = job?.output
    ? `${API}${job.output}`
    : job?.preview
    ? `${API}${job.preview}`
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 text-slate-900">
      {/* 헤더 */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white/80 px-8 py-5 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white font-bold">
            S
          </div>
          <h1 className="text-xl font-extrabold tracking-tight">쇼핑쇼츠 메이커</h1>
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-600">
            BETA
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50">
            로그인
          </button>
          <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            구독
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* 링크 입력 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="mb-2 block text-sm font-semibold text-slate-700">
            도우인 영상 링크
          </label>
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && analyze()}
              placeholder="공유 텍스트 통째로 붙여넣어도 됩니다 (도우인 링크 자동추출)"
              className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <button
              onClick={pasteFromClipboard}
              className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700"
            >
              붙여넣기
            </button>
            <button
              onClick={analyze}
              disabled={busy || !url.trim()}
              className="rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-6 py-3 text-sm font-bold text-white shadow hover:opacity-90 disabled:opacity-40"
            >
              {busy && job?.status !== "done" ? "처리중..." : "분석"}
            </button>
          </div>

          {/* 미리보기 — 자막제거 영상 / 최종 결과 */}
          {(previewUrl || (busy && !job?.output)) && (
            <div className="mt-5 flex flex-col items-center gap-3 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-950 p-5">
              <div className="flex w-full items-center justify-between text-xs text-zinc-300">
                <span>{job?.output ? "✅ 완성 영상" : "미리보기 (중국어 자막 제거됨)"}</span>
                {job && <span>{job.stage} · {job.progress}%</span>}
              </div>
              {previewUrl ? (
                <video
                  key={previewUrl}
                  src={previewUrl}
                  controls
                  className="max-h-[420px] rounded-xl"
                  style={{ aspectRatio: "9/16" }}
                />
              ) : (
                <div className="flex h-72 w-40 items-center justify-center rounded-xl bg-zinc-800 text-sm text-zinc-400">
                  처리중...
                </div>
              )}
              {job?.has_speech !== null && job?.status === "analyzed" && (
                <p className="text-xs text-zinc-400">
                  {job?.has_speech
                    ? "🎤 음성 감지 → 번역 대본 자동작성됨 (아래에서 수정 가능)"
                    : "🎵 음악만 있는 영상 → 아래에 대본을 직접 입력하세요"}
                </p>
              )}
              {job?.error && <p className="text-xs text-rose-400">오류: {job.error}</p>}
            </div>
          )}

          {/* 성우 — 선택 + 재생/정지 미리듣기 */}
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-700">
                성우 <span className="text-xs font-normal text-slate-400">({VOICES.length}종 · ▶ 미리듣기)</span>
              </div>
              <div className="flex gap-1">
                {([["all", "전체"], ["F", "여성"], ["M", "남성"]] as const).map(([g, lbl]) => (
                  <button
                    key={g}
                    onClick={() => setGenderFilter(g)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                      genderFilter === g ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
              {VOICES.filter((v) => genderFilter === "all" || v.gender === genderFilter).map((v) => (
                <div
                  key={v.name}
                  onClick={() => setVoice(v.name)}
                  className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                    voice === v.name
                      ? "border-indigo-400 bg-indigo-50 font-semibold text-indigo-700"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {v.name}
                    <span className={`text-[10px] ${v.gender === "F" ? "text-pink-400" : "text-sky-400"}`}>
                      {v.gender === "F" ? "여" : "남"}
                    </span>
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

          {/* 설정 카드들 */}
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="CTA (마지막 멘트)">
              <select
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {CTAS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={`배속 (${rate.toFixed(1)}x)`}>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={rate}
                onChange={(e) => setRate(parseFloat(e.target.value))}
                className="w-full"
              />
            </Field>

            <Field label="중국어 자막 제거">
              <div className="flex gap-2">
                {(["bar", "blur"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setSubMode(m)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                      subMode === m
                        ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                        : "border-slate-200"
                    }`}
                  >
                    {m === "bar" ? "자막바 덮기" : "블러"}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {/* 대본 */}
          <div className="mt-4">
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              한국어 대본
              {job?.has_speech === false && (
                <span className="ml-2 text-xs font-normal text-amber-600">음악만 있는 영상 — 직접 입력</span>
              )}
              {job?.has_speech === true && (
                <span className="ml-2 text-xs font-normal text-emerald-600">번역 대본 자동작성됨 — 수정 가능</span>
              )}
            </label>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={3}
              placeholder="비우면 원본 음성 유지. 분석하면 번역 대본이 자동으로 채워집니다."
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          {/* 작업 시작 */}
          <div className="mt-6 flex items-center justify-between">
            <p className="text-xs text-slate-400">
              {job?.id ? "분석 완료. 설정 확인 후 작업 시작하세요." : "먼저 링크를 분석하세요."}
            </p>
            <button
              onClick={startRender}
              disabled={!job?.id || busy}
              className="rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-200 transition hover:opacity-90 disabled:opacity-40"
            >
              {busy && job?.status !== "analyzed" ? `${job?.stage || "처리중"}...` : "작업 시작"}
            </button>
          </div>
        </section>

        {/* 자막 스타일 편집기 */}
        <div className="mt-8">
          <CaptionEditor value={captionStyle} onChange={setCaptionStyle} />
        </div>

        {/* 완성 결과 다운로드 */}
        {job?.output && (
          <section className="mt-8 flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-5">
            <div className="text-sm font-semibold text-emerald-700">✅ 영상 완성!</div>
            <a
              href={`${API}${job.output}`}
              download
              className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
            >
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
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
      <div className="mb-2 text-xs font-semibold text-slate-500">{label}</div>
      {children}
    </div>
  );
}

