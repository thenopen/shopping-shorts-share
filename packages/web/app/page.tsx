"use client";

import { useEffect, useState } from "react";
import CaptionEditor from "./CaptionEditor";
import CaptionTimeline, { CaptionLineData } from "./CaptionTimeline";
import { Spinner, Switch } from "./ui";
import { apiBase, postJSON, errMsg } from "./lib/api";
import { JobState, PreviewInfo, LibraryEntry } from "./lib/types";
import { fmtSec, parsePoints, normLines } from "./lib/format";
import { CaptionStyle, DEFAULT_STYLE } from "./caption/style";
import { VOICES } from "./data/voices";
import { StageBadges } from "./components/StageBadges";
import { QuotaBadge } from "./components/QuotaBadge";
import { SettingsPanel } from "./components/SettingsPanel";
import { PipelineProgress } from "./components/PipelineProgress";
import { useCtas } from "./hooks/useCtas";
import { useScriptHistory } from "./hooks/useScriptHistory";
import { useModalDeploy } from "./hooks/useModalDeploy";
import { useJobPolling } from "./hooks/useJobPolling";
import { useProductScript } from "./hooks/useProductScript";
import { useVoicePreview } from "./hooks/useVoicePreview";






export default function Home() {
  const [url, setUrl] = useState("");
  const [voice, setVoice] = useState("소담");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_STYLE);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [faceCutOn, setFaceCutOn] = useState(false);  // 얼굴 전체샷 컷 제거(opt-in)
  // 자막제거는 클라우드(Modal)만 사용 — 로컬 GPU 옵션은 제품에서 제외(아래 토글 주석처리).
  // 디버깅 때만 setter 복원 + 백엔드 env ALLOW_LOCAL_GPU=1. 값은 항상 "modal".
  const subtitleBackend: "local" | "modal" = "modal";  // setter 없는 죽은 state였음 → 상수화(동작 동일)
  // 타임라인 편집기서 만든/수정한 자막 줄들. 비어있으면 render때 서버가 자동생성.
  const [captionLines, setCaptionLines] = useState<CaptionLineData[]>([]);
  const [capBusy, setCapBusy] = useState(false);
  const [capEditBusy, setCapEditBusy] = useState(false);            // AI 자막 다듬기 진행중
  const [capEditPrev, setCapEditPrev] = useState<CaptionLineData[] | null>(null); // 다듬기 직전(되돌리기용)
  const { ctaList, cta, setCta, addCustomCta, deleteCta } = useCtas();
  const [ctaOn, setCtaOn] = useState(true);        // CTA 넣기/빼기
  const [ctaSize, setCtaSize] = useState(56);      // CTA 글자 크기(px)
  const [ctaPos, setCtaPos] = useState(0.88);      // CTA 세로 위치(0~1)
  const [usageRefresh, setUsageRefresh] = useState(0);  // API 사용량 배지 즉시 새로고침 트리거
  const bumpUsage = () => setUsageRefresh((n) => n + 1);
  const [settingsOpen, setSettingsOpen] = useState(false);  // 설정 패널(키/한도) 열림
  const { deployN, watchDeploy } = useModalDeploy();  // Modal 배포중 계정 수 + 감시 트리거
  const [preview, setPreview] = useState<PreviewInfo | null>(null);  // '확인' 미리보기(제목·썸네일)
  const [previewBusy, setPreviewBusy] = useState(false);
  const [libEntries, setLibEntries] = useState<LibraryEntry[]>([]);  // 최근 다운로드(재사용)
  // 자막 제거 품질 확인 — 군데군데 원본 vs 제거본 프레임
  const [qFrames, setQFrames] = useState<{ t: number; source: string | null; nosub: string | null }[]>([]);
  const [qBusy, setQBusy] = useState(false);
  const [qEngine, setQEngine] = useState<string | null>(null);

  const {
    script, setScript, scriptDirtyRef,
    commitScript, undoScript, redoScript, canUndo, canRedo,
    beginSnapshot, commitSnapshotIfChanged,
  } = useScriptHistory();
  const [rate, setRate] = useState(1.0);
  const [renderSeq, setRenderSeq] = useState(0); // 재렌더 시 결과영상 캐시버스터 카운터
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsUrl, setTtsUrl] = useState("");      // 대본 전체 TTS 미리듣기 mp3

  // 현재 대본 + 선택 voice로 TTS 생성해 들어보기. voice 바꿔 다시 누르면 새로 생성.
  async function previewTts() {
    if (!script.trim() || ttsBusy) return;  // 분석 전이어도 대본만 있으면 들어보기 가능
    setTtsBusy(true);
    try {
      const d = await postJSON<{ audio?: string; duration?: number; debug?: string[] }>("/tts/preview", { job_id: job?.id ?? "", script, voice, speaking_rate: rate });
      if (d.debug?.length) console.log("[TTS미리듣기 DEBUG] 서버 ↓\n" + d.debug.join("\n"));
      console.log(`[TTS미리듣기] script ${script.length}자, 서버 duration=${d.duration}s, url=${d.audio}`);
      if (d.audio) {
        // 보이는 <audio controls autoPlay>로 재생(다시듣기·스크럽 가능). 숨은 audioRef는 보이스 미리듣기 전용.
        const el = audioRef.current;
        if (el && playing) { el.pause(); setPlaying(null); }   // 보이스 미리듣기 중이면 정지(겹침 방지)
        setTtsUrl(`${apiBase()}${d.audio}?t=${renderSeq}-${voice}`);
      } else {
        console.warn("[TTS미리듣기] audio 없음", d);
        alert("음성 생성 실패.");
      }
    } catch {
      alert("음성 생성 실패. 서버 상태를 확인하세요.");
    } finally {
      setTtsBusy(false);
    }
  }

  // 제품 소구포인트: 상세페이지 URL / 캡처이미지 → 대본 결합 (video_content=script, commitScript로 반영)
  const {
    productUrl, setProductUrl, productImages, setProductImages,
    sellingPoints, setSellingPoints, productBusy, productErr, productMsg,
    productStage, pointsEdit, setPointsEdit,
    addImageFiles, onProductPaste, generateProductScript,
  } = useProductScript({ script, commitScript });

  const { audioRef, playing, setPlaying, loadingVoice, toggleVoice, onAudioEnded } = useVoicePreview();
  const [genderFilter, setGenderFilter] = useState<"all" | "F" | "M">("all");
  const [job, setJob] = useState<JobState | null>(null);
  const [busy, setBusy] = useState(false);
  const [scriptBusy, setScriptBusy] = useState(false);
  const [refineBusy, setRefineBusy] = useState(false);
  const { pollJob, resetEngineLogs } = useJobPolling({ setJob, setBusy, setScriptBusy, setScript, scriptDirtyRef });

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
      alert(errMsg(e, "이어하기 실패"));
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
      alert(errMsg(e, "품질 확인 실패"));
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
    resetEngineLogs();                // 새 분석 → 엔진/도우인/DEBUG 로그 다시 찍히게
    try {
      const { job_id } = await postJSON<{ job_id?: string }>("/analyze", {
        url: target, subtitle_backend: subtitleBackend,
        reuse_nosub: opts?.reuseNosub ?? true,
      });
      if (!job_id) { setBusy(false); alert("작업 ID를 받지 못했습니다. 백엔드 로그를 확인하세요."); return; }
      // 분석 끝나면 라이브러리 갱신(새 다운로드/자막제거본 등록 반영) + 미리보기 갱신
      // TODO(bug/개선트랙): checkUrl(url)은 입력창의 stale 값 — '자막제거 다시'처럼 opts.url로 분석한 경우
      //   실제 분석 대상(target)과 달라 엉뚱한 영상의 미리보기/썸네일/단계배지로 갱신됨. checkUrl(target)로 고칠 것.
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
      const lines: CaptionLineData[] = normLines(data.lines);
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
      const next: CaptionLineData[] = normLines(d.lines);
      if (!next.length) { alert("다듬기 결과가 비었습니다."); return; }
      setCapEditPrev(prev);
      setCaptionLines(next);
    } catch (e) {
      alert(errMsg(e, "자막 다듬기 실패."));
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


  async function pasteFromClipboard() {
    try {
      setUrl(await navigator.clipboard.readText());
    } catch {}
  }

  const previewUrl = job?.output ? `${apiBase()}${job.output}?v=${renderSeq}` : job?.preview ? `${apiBase()}${job.preview}` : null;
  // 자막제거본(nosub) 전용 — 미리보기·품질확인은 이걸 쓰고, 완성 영상은 아래 전용 섹션에서(중복 방지).
  const nosubUrl = job?.preview ? `${apiBase()}${job.preview}` : null;
  // 2단 레이아웃 게이팅 — 대본 생성 전엔 우측 작업물 컬럼 숨김(단일열, 깔끔한 시작).
  // 엄격: script 있을 때만 우측 등장. 영상→대본 진입점은 좌측 '자동 대본 생성' 버튼.
  const showWork = !!script.trim();
  // 상대경로 → 절대경로(외부 기기/공유시 동작). 다운로드·공유 링크에만 적용.
  const absUrl = (rel: string) => (typeof window !== "undefined" ? new URL(rel, window.location.origin).href : rel);
  const visibleVoices = VOICES.filter((v) => genderFilter === "all" || v.gender === genderFilter);

  return (
    <div className="min-h-screen text-[var(--ink)]">
      {/* 보이스 미리듣기용 단일 오디오 엘리먼트(iOS 인앱브라우저 호환) */}
      <audio ref={audioRef} onEnded={onAudioEnded} preload="auto" className="hidden" />
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
              <Spinner className="h-3 w-3 border-amber-400/50 border-t-amber-600" />
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
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} onSaved={bumpUsage} onDeploy={watchDeploy} />}

      <main className={`mx-auto px-4 pb-16 pt-4 sm:px-6 ${showWork ? "max-w-6xl" : "max-w-5xl"}`}>
        <div className={showWork ? "lg:grid lg:grid-cols-12 lg:items-start lg:gap-6" : ""}>
        <div className={showWork ? "lg:col-span-7 min-w-0" : ""}>
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

          {/* 제품 소구포인트 — 상세페이지 링크/캡처/수동 → 대본 결합 */}
          <div className="mt-6 rounded-2xl glass-soft p-5" onPaste={onProductPaste}>
            <label className="mb-1 block text-sm font-bold text-[var(--ink)]">제품 링크 <span className="font-medium text-[var(--ink-soft)]">(선택 · 영상에 맞는 상품 상세페이지)</span></label>
            <p className="mb-3 text-[13px] text-[var(--ink-soft)]">
              {script.trim()
                ? "위 영상 내용 + 제품 소구포인트를 결합해 대본을 만들어요. 제품명은 직접 말하지 않아요."
                : "제품 소구포인트만으로 대본을 만들어요. (영상을 먼저 분석하면 영상 내용과 결합돼요.) 제품명은 직접 말하지 않아요."}
            </p>
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
                {productBusy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
                {productBusy ? "분석 중..." : "소구포인트 → 대본"}
              </button>
            </div>

            {productBusy && productStage && (
              <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-white/55 px-3 py-2 text-[13px] font-medium text-[var(--ink)]">
                <Spinner className="h-3.5 w-3.5 flex-none border-[var(--accent)]/40 border-t-[var(--accent-deep)]" />
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
            {productMsg && !productErr && <p className="mt-3 rounded-xl bg-emerald-100/70 px-4 py-2.5 text-xs font-semibold text-emerald-700">{productMsg}</p>}
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

          </div>

          {/* 영상 음성→대본(transcribe)은 니치 경로 — 접어서 숨김(일부 사용자용). 기본은 제품 링크. */}
          {job?.id && !script.trim() && (
            <details className="mt-3 rounded-xl bg-white/40 px-3.5 py-2 backdrop-blur">
              <summary className="cursor-pointer select-none text-xs font-semibold text-[var(--ink-soft)]">▸ 제품 링크 없이 · 영상 음성에서 대본 만들기</summary>
              <button onClick={genScript} disabled={scriptBusy} className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-full bg-white/70 px-5 py-3 text-sm font-bold text-[var(--accent-deep)] backdrop-blur transition hover:bg-white/90 disabled:opacity-40">
                {scriptBusy && <Spinner className="h-4 w-4 border-[var(--accent)]/40 border-t-[var(--accent-deep)]" />}
                {scriptBusy ? "대본 생성 중..." : "🎬 영상에서 자동 대본 생성"}
              </button>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--ink-soft)]">영상에 한국어/중국어 <b>음성</b>이 있을 때만 유용해요. 무음·BGM만이면 빈 대본이 나와요.</p>
            </details>
          )}

          {(busy || scriptBusy) && job?.status !== "done" && <PipelineProgress job={job} />}

          {job?.error && <p className="mt-3 rounded-2xl bg-rose-100/70 px-4 py-3 text-xs font-medium text-rose-600 backdrop-blur">오류: {job.error}</p>}

          {nosubUrl && (
            <div className="mt-6 flex flex-col items-center gap-2.5 rounded-3xl glass-soft p-5">
              <div className="flex w-full items-center justify-between text-xs font-semibold text-[var(--ink-soft)]">
                <span>자막 제거 미리보기 <span className="font-medium opacity-70">(자막·워터마크 제거 결과)</span></span>
                {busy && <span>{job?.stage} · {job?.progress}%</span>}
              </div>
              <video key={nosubUrl} src={nosubUrl} controls className="max-h-[440px] rounded-2xl bg-black/80 shadow-lg" style={{ aspectRatio: "9/16" }} />

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
                      <Spinner className="h-3 w-3 border-[var(--accent)]/40 border-t-[var(--accent-deep)]" />
                    ) : playing === v.name ? "■" : "▶"}
                  </button>
                </div>
              ))}
            </div>
            {/* 선택한 보이스 + 현재 대본으로 전체 음성 미리듣기 — 맘에 안 들면 보이스 바꿔 다시 */}
            <button
              onClick={previewTts}
              disabled={!script.trim() || ttsBusy}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-white/70 px-5 py-2.5 text-sm font-bold text-[var(--accent-deep)] backdrop-blur transition hover:bg-white/90 disabled:opacity-40"
            >
              {ttsBusy && <Spinner />}
              {ttsBusy ? "음성 생성 중..." : `🔊 '${voice}' 목소리로 대본 들어보기`}
            </button>
            {ttsUrl && (
              <div className="mt-2">
                <audio
                  key={ttsUrl}
                  src={ttsUrl}
                  controls
                  autoPlay
                  className="w-full"
                  onLoadedMetadata={(e) => console.log(`[TTS미리듣기] 브라우저 오디오 로드 OK — duration=${e.currentTarget.duration.toFixed(2)}s`)}
                  onError={(e) => console.error("[TTS미리듣기] 브라우저 오디오 로드 실패:", e.currentTarget.error, "src=", e.currentTarget.currentSrc)}
                />
                <p className="mt-1 text-center text-[11px] text-[var(--ink-soft)]">보이스를 바꾼 뒤 다시 누르면 새 음성으로 들려줘요.</p>
              </div>
            )}
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

          <div className="mt-3">
            <Field label={`배속 ${rate.toFixed(1)}x`}>
              <input type="range" min={0.5} max={2} step={0.1} value={rate} onChange={(e) => setRate(parseFloat(e.target.value))} className="mt-1.5 w-full accent-[var(--accent-deep)]" />
            </Field>
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
              <div className="text-xs text-[var(--ink-soft)]">얼굴 큰 구간을 잘라 제품샷 위주로 이어붙여요. (남길 분량이 짧으면 자동 생략)</div>
            </div>
            <Switch on={faceCutOn} onToggle={() => setFaceCutOn((v) => !v)} ariaLabel="얼굴샷 컷 제거 토글" />
          </div>
          <div className="mb-8 flex items-center justify-between rounded-3xl glass px-6 py-4">
            <div>
              <div className="text-sm font-bold text-[var(--ink)]">자동 자막</div>
              <div className="text-xs text-[var(--ink-soft)]">대본을 타임코드에 맞춰 자막으로. 스타일·줄별 편집은 켜면 아래에.</div>
            </div>
            <Switch on={captionsOn} onToggle={() => setCaptionsOn((v) => !v)} ariaLabel="자동 자막 토글" />
          </div>
          {/* 자막 스타일·타임라인은 자동자막 켤 때만 노출(끄면 감춤 — 화면 단순화) */}
          {captionsOn && (
            <>
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
            </>
          )}
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
        </div>
        {showWork && (
          <aside className="mt-6 lg:col-span-5 lg:mt-0 lg:sticky lg:top-4">
            <div className="glass rounded-[28px] p-5 sm:p-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm font-bold text-[var(--ink)]">📝 한국어 대본</label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={genScript} disabled={!job?.id || scriptBusy} className="flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-[var(--accent-deep)] backdrop-blur transition hover:bg-white/90 disabled:opacity-40">
                    {scriptBusy && <Spinner className="h-3 w-3 border-[var(--accent)]/40 border-t-[var(--accent-deep)]" />}
                    {scriptBusy ? "생성 중..." : "자동 대본 생성"}
                  </button>
                  <button onClick={refineScript} disabled={!script.trim() || refineBusy} className="flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-fuchsia-600 backdrop-blur transition hover:bg-white/90 disabled:opacity-40">
                    {refineBusy && <Spinner className="h-3 w-3 border-fuchsia-300 border-t-fuchsia-600" />}
                    {refineBusy ? "가공 중..." : "AI로 가공"}
                  </button>
                  <button onClick={undoScript} disabled={!canUndo} title="되돌리기 (Ctrl+Z)" className="rounded-full bg-white/50 px-3 py-1.5 text-xs font-bold text-[var(--ink-soft)] backdrop-blur transition hover:bg-white/80 disabled:opacity-30">
                    ↶ 되돌리기
                  </button>
                  <button onClick={redoScript} disabled={!canRedo} title="다시실행 (Ctrl+Shift+Z)" className="rounded-full bg-white/50 px-3 py-1.5 text-xs font-bold text-[var(--ink-soft)] backdrop-blur transition hover:bg-white/80 disabled:opacity-30">
                    ↷ 다시실행
                  </button>
                </div>
              </div>
              {job?.status === "transcribed" && job?.has_speech === false && (
                <div className="mb-2 rounded-xl bg-amber-50/70 px-3 py-2 text-[13px] font-medium text-amber-700">
                  🔇 이 영상엔 음성이 없어요. 대본을 직접 입력하거나 왼쪽 <b>제품 링크</b>로 만들어보세요.
                </div>
              )}
              <textarea
                value={script}
                onChange={(e) => { scriptDirtyRef.current = true; setScript(e.target.value); }}
                onFocus={beginSnapshot}
                onBlur={commitSnapshotIfChanged}
                onKeyDown={(e) => {
                  const mod = e.ctrlKey || e.metaKey;
                  if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undoScript(); }
                  else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redoScript(); }
                }}
                rows={8}
                placeholder="자동 대본 생성 버튼을 누르거나 직접 입력하세요."
                className="w-full rounded-2xl border border-white/50 bg-white/75 px-4 py-3 text-sm leading-relaxed text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-soft)]/60 focus:bg-white/90 focus:ring-2 focus:ring-[var(--accent)]/30"
              />
            </div>
          </aside>
        )}
        </div>
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
