"use client";

import { useState } from "react";

const VOICES = ["하은", "서연", "소담", "제니", "안나", "지연", "태형", "상호"];
// 폰트 표시명 → CSS font-family (globals.css의 @font-face와 일치)
const FONTS: { label: string; css: string }[] = [
  { label: "G마켓 산스", css: "GmarketSans" },
  { label: "프리텐다드", css: "Pretendard" },
  { label: "서울한강체", css: "SeoulHangang" },
  { label: "페이퍼로지", css: "Paperlogy" },
  { label: "티몬체", css: "TmonMonsori" },
  { label: "머니그라피", css: "MoneygraphyRounded" },
];
const CTAS = [
  { key: "comment", label: "제품 정보는 고정 댓글을 확인해주세요!" },
  { key: "profile", label: "구매처는 프로필 링크에 있어요!" },
  { key: "link", label: "자세한 내용은 하단 링크를 클릭하세요!" },
];

type Job = {
  no: number;
  url: string;
  status: "대기중" | "처리중" | "완료" | "오류";
  progress: number;
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [voice, setVoice] = useState("소담");
  const [font, setFont] = useState(FONTS[2]); // 서울한강체
  const [cta, setCta] = useState("profile");
  const [script, setScript] = useState("");
  const [rate, setRate] = useState(1.0);
  const [subMode, setSubMode] = useState<"bar" | "blur">("bar");
  const [jobs, setJobs] = useState<Job[]>([]);

  function addJob() {
    if (!url.trim()) return;
    setJobs((prev) => [
      ...prev,
      { no: prev.length + 1, url: url.trim(), status: "대기중", progress: 0 },
    ]);
    setUrl("");
  }

  // 성우 미리듣기 — public/voices/<성우>.mp3 재생
  function playVoice(nick: string) {
    const audio = new Audio(`/voices/${encodeURIComponent(nick)}.mp3`);
    audio.play().catch(() => {});
  }

  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      setUrl(t);
    } catch {
      /* 권한 거부시 무시 */
    }
  }

  // 데모: 실제 서버 연동 전까지 가짜 진행률
  function startJobs() {
    setJobs((prev) => prev.map((j) => ({ ...j, status: "처리중", progress: 1 })));
    // TODO: packages/server 의 /jobs API 호출로 교체
  }

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
              onKeyDown={(e) => e.key === "Enter" && addJob()}
              placeholder="https://www.douyin.com/video/..."
              className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <button
              onClick={pasteFromClipboard}
              className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700"
            >
              붙여넣기
            </button>
            <button
              onClick={addJob}
              className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold hover:bg-slate-50"
            >
              추가
            </button>
          </div>

          {/* 성우 — 선택 + 미리듣기 */}
          <div className="mt-6">
            <div className="mb-2 text-sm font-semibold text-slate-700">
              성우 <span className="text-xs font-normal text-slate-400">(▶ 눌러 미리듣기)</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {VOICES.map((v) => (
                <div
                  key={v}
                  onClick={() => setVoice(v)}
                  className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                    voice === v
                      ? "border-indigo-400 bg-indigo-50 font-semibold text-indigo-700"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <span>{v}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      playVoice(v);
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs shadow hover:bg-indigo-100"
                    aria-label={`${v} 미리듣기`}
                  >
                    ▶
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 자막 폰트 — 선택 + 미리보기 */}
          <div className="mt-6">
            <div className="mb-2 text-sm font-semibold text-slate-700">자막 폰트</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {FONTS.map((f) => (
                <button
                  key={f.css}
                  onClick={() => setFont(f)}
                  style={{ fontFamily: f.css }}
                  className={`rounded-lg border px-3 py-3 text-lg ${
                    font.css === f.css
                      ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  가나다 ABC
                  <span className="mt-1 block text-[11px] font-normal text-slate-400" style={{ fontFamily: "inherit" }}>
                    {f.label}
                  </span>
                </button>
              ))}
            </div>
            {/* 큰 미리보기 */}
            <div
              className="mt-3 flex items-center justify-center rounded-xl bg-slate-900 px-4 py-6 text-2xl font-bold text-white"
              style={{ fontFamily: font.css }}
            >
              이 제품 정말 좋아요! 지금 확인하세요
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
              한국어 대본 (비우면 원본 음성 유지)
            </label>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={3}
              placeholder="이 제품 정말 좋아요. 지금 바로 확인하세요..."
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          {/* 작업 시작 */}
          <div className="mt-6 flex items-center justify-between">
            <p className="text-xs text-slate-400">
              결과는 9:16 세로 쇼츠 mp4로 생성됩니다.
            </p>
            <button
              onClick={startJobs}
              disabled={jobs.length === 0}
              className="rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-200 transition hover:opacity-90 disabled:opacity-40"
            >
              작업 시작
            </button>
          </div>
        </section>

        {/* 작업 큐 */}
        <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-[60px_1fr_120px] gap-2 border-b border-slate-100 px-6 py-3 text-xs font-bold text-slate-500">
            <div>No</div>
            <div>URL</div>
            <div className="text-right">상태</div>
          </div>
          {jobs.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-slate-400">
              위에서 링크를 추가하세요. 여러 개를 한번에 처리할 수 있어요.
            </div>
          ) : (
            jobs.map((j) => (
              <div
                key={j.no}
                className="grid grid-cols-[60px_1fr_120px] items-center gap-2 border-b border-slate-50 px-6 py-3 text-sm"
              >
                <div className="text-slate-400">{j.no}</div>
                <div className="truncate text-slate-700">{j.url}</div>
                <div className="text-right">
                  <StatusBadge status={j.status} />
                </div>
              </div>
            ))
          )}
        </section>
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

function StatusBadge({ status }: { status: Job["status"] }) {
  const map: Record<Job["status"], string> = {
    대기중: "bg-slate-100 text-slate-500",
    처리중: "bg-amber-100 text-amber-700",
    완료: "bg-emerald-100 text-emerald-700",
    오류: "bg-rose-100 text-rose-700",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${map[status]}`}>
      {status}
    </span>
  );
}
