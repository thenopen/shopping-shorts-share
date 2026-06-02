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
  // CTA 문구 목록(기본3 + 사용자 추가 통합. 기본도 삭제 가능). localStorage 저장.
  const [ctaList, setCtaList] = useState<string[]>(DEFAULT_CTAS);
  const [cta, setCta] = useState(DEFAULT_CTAS[1]); // 선택된 CTA 문구(텍스트)

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

  // 제품 소구포인트: 상세페이지 URL / 캡처이미지 여러 장(파일·Ctrl+V) → 대본 결합
  const [productUrl, setProductUrl] = useState("");
  const [productImages, setProductImages] = useState<string[]>([]); // dataURL[]
  const [sellingPoints, setSellingPoints] = useState("");
  const [productBusy, setProductBusy] = useState(false);
  const [productErr, setProductErr] = useState("");

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

  async function generateProductScript() {
    if (productBusy) return;
    if (!productUrl.trim() && productImages.length === 0) {
      setProductErr("제품 링크 또는 캡처 이미지를 올려주세요.");
      return;
    }
    setProductBusy(true);
    setProductErr("");
    try {
      const r = await fetch(`${apiBase()}/script/product`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_url: productUrl.trim(),
          product_images: productImages,
          video_content: script, // 현재 대본/영상내용과 결합
          combine: true,
        }),
      });
      const d = await r.json();
      if (d.error) {
        setProductErr(d.error);
        if (d.selling_points) setSellingPoints(d.selling_points);
      } else {
        setSellingPoints(d.selling_points || "");
        if (d.script) commitScript(d.script);
      }
    } catch {
      setProductErr("대본 생성 실패. 서버 상태를 확인하세요.");
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
    setRenderSeq((n) => n + 1); // 결과 영상 캐시버스터 — 재렌더 시 브라우저가 새 영상 받게
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
      </header>

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
              onClick={analyze}
              disabled={busy || !url.trim()}
              className="btn-grad rounded-full px-7 py-3 text-sm font-bold transition"
            >
              {busy && job?.status !== "done" ? "분석 중..." : "분석"}
            </button>
          </div>

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
                onClick={generateProductScript}
                disabled={productBusy}
                className="btn-grad rounded-full px-7 py-3 text-sm font-bold transition disabled:opacity-50"
              >
                {productBusy ? "분석 중..." : "소구포인트 → 대본"}
              </button>
            </div>

            {/* 캡처 업로드(여러 장) — 파일 선택 또는 Ctrl+V 붙여넣기. 쿠팡 등 차단 사이트 폴백 */}
            <div className="mt-2.5">
              {/* 캡쳐 버튼: 모바일선 위 '소구포인트→대본' 버튼과 같은 full-width */}
              <label className="flex w-full cursor-pointer items-center justify-center whitespace-nowrap rounded-full bg-white/70 px-7 py-3 text-sm font-bold text-[var(--ink)] backdrop-blur transition hover:bg-white/90 md:w-auto md:justify-start md:py-2 md:text-[13px] md:font-semibold">
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
            {sellingPoints && (
              <div className="mt-3 rounded-xl bg-emerald-50/70 px-4 py-3 text-xs text-emerald-900">
                <div className="mb-1 font-bold">추출된 소구포인트</div>
                <pre className="whitespace-pre-wrap font-sans">{sellingPoints}</pre>
              </div>
            )}

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
                    {loadingVoice === v.name ? (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent)]/40 border-t-[var(--accent-deep)]" />
                    ) : playing === v.name ? "■" : "▶"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-7">
            <Field label="CTA">
              <div className="flex items-center gap-1.5">
                <select value={cta} onChange={(e) => setCta(e.target.value)} className="h-12 min-w-0 flex-1 truncate rounded-xl border border-white/50 bg-white/70 px-3 text-[13px] text-[var(--ink)] outline-none" style={{ fontFamily: "ChosunGu, system-ui, sans-serif", lineHeight: "normal" }}>
                  {ctaList.length === 0 && <option value="">(CTA 없음)</option>}
                  {ctaList.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <button onClick={addCustomCta} title="CTA 문구 추가" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70 text-lg font-bold text-[var(--accent-deep)] transition hover:bg-white/90">+</button>
                {cta && ctaList.includes(cta) && (
                  <button onClick={() => deleteCta(cta)} title="선택한 문구 삭제" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100/70 text-sm font-bold text-rose-600 transition hover:bg-rose-200/70">×</button>
                )}
              </div>
            </Field>
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

        <div className="mt-8">
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
            />
          </div>
        </div>

        {job?.output && (
          <section className="mt-7 flex flex-col gap-3 rounded-3xl glass px-5 py-5 sm:px-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-bold text-emerald-600">✅ 영상 완성</div>
              <div className="flex flex-wrap gap-2">
                <a href={previewUrl ?? `${apiBase()}${job.output}`} download target="_blank" rel="noopener" className="rounded-full bg-emerald-500 px-6 py-2.5 text-sm font-bold text-white shadow-[0_12px_24px_-10px_rgba(16,185,129,0.6)] transition hover:bg-emerald-600">
                  다운로드
                </a>
                <button
                  onClick={async () => {
                    const link = previewUrl ?? `${apiBase()}${job!.output}`;
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
