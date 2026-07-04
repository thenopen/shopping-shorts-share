"use client";

import { useEffect, useRef, useState } from "react";
import CaptionEditor from "./CaptionEditor";
import { CaptionLineData } from "./caption/types";
import { apiBase, postJSON, errMsg } from "./lib/api";
import { JobState, PreviewInfo, LibraryEntry, TypecastVoice } from "./lib/types";
import { normLines } from "./lib/format";
import { estimateSec, getCpsInfo, recordCps, visChars } from "./lib/duration";
import { CaptionStyle, DEFAULT_STYLE } from "./caption/style";
import { StageKey } from "./lib/stage";
import { SettingsPanel } from "./components/SettingsPanel";
import { HomeView } from "./components/home/HomeView";
import { TopBar } from "./components/workspace/TopBar";
import { PreviewPane } from "./components/workspace/PreviewPane";
import { SourceStage } from "./components/workspace/SourceStage";
import { ScriptStage } from "./components/workspace/ScriptStage";
import { VoiceStage } from "./components/workspace/VoiceStage";
import { CaptionStage } from "./components/workspace/CaptionStage";
import { RenderStage } from "./components/workspace/RenderStage";
import { StageFooter } from "./components/workspace/StageFooter";
import { useCtas } from "./hooks/useCtas";
import { useScriptHistory } from "./hooks/useScriptHistory";
import { useModalDeploy } from "./hooks/useModalDeploy";
import { useJobPolling } from "./hooks/useJobPolling";
import { useProductScript } from "./hooks/useProductScript";
import { useVoicePreview } from "./hooks/useVoicePreview";

export default function Home() {
  const [url, setUrl] = useState("");
  const [voice, setVoice] = useState("");            // Typecast voice_id(빈값=기본)
  const [emotion, setEmotion] = useState("smart");   // smart | happy/sad/angry/whisper/toneup/tonedown
  const [emotionIntensity, setEmotionIntensity] = useState(1.3);
  // Typecast 보이스 목록(설정 키 있을 때) — 처음 로드 시 기본 voice_id 선택.
  const [tcVoices, setTcVoices] = useState<TypecastVoice[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${apiBase()}/tts/voices`);
        if (!r.ok) return;
        const j = await r.json();
        setTcVoices(j.voices || []);
        setVoice((cur) => cur || j.default || (j.voices?.[0]?.voice_id ?? ""));
      } catch {}
    })();
  }, []);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_STYLE);
  const [captionsOn, setCaptionsOn] = useState(true);
  // 자막제거는 클라우드(Modal)만 사용 — 로컬 GPU 옵션은 제품에서 제외.
  // 디버깅 때만 값 복원 + 백엔드 env ALLOW_LOCAL_GPU=1. 값은 항상 "modal".
  const subtitleBackend: "local" | "modal" = "modal";
  // 타임라인 편집기서 만든/수정한 자막 줄들. 비어있으면 render때 서버가 자동생성.
  const [captionLines, setCaptionLines] = useState<CaptionLineData[]>([]);
  const [capBusy, setCapBusy] = useState(false);
  const [capEditBusy, setCapEditBusy] = useState(false);            // AI 자막 다듬기 진행중
  const [capEditPrev, setCapEditPrev] = useState<CaptionLineData[] | null>(null); // 다듬기 직전(되돌리기용)
  // 선택 자막 — null이면 '전체 자막'(기본 스타일), 값이면 그 줄만 편집/드래그.
  const [selectedCap, setSelectedCap] = useState<number | null>(null);
  const capSel = selectedCap != null && selectedCap < captionLines.length ? selectedCap : null;
  const updateLineStyle = (i: number, style: CaptionStyle | null) =>
    setCaptionLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, style } : l)));
  const { ctaList, cta, setCta, addCustomCta, deleteCta } = useCtas();
  const [ctaOn, setCtaOn] = useState(true);        // CTA 넣기/빼기
  const [ctaSize, setCtaSize] = useState(56);      // CTA 글자 크기(px)
  // CTA 세로 위치(0~1). 하단은 자막(posV=bottom, ~76-89%) + 플랫폼 UI(85%~)가 점유 →
  // 기본 0.72 = 자막 바로 위 안내띠(대사·세이프존과 안 겹침). 프리뷰에서 드래그로 조정.
  const [ctaPos, setCtaPos] = useState(0.72);
  const [usageRefresh, setUsageRefresh] = useState(0);  // API 사용량 배지 즉시 새로고침 트리거
  const bumpUsage = () => setUsageRefresh((n) => n + 1);
  const [settingsOpen, setSettingsOpen] = useState(false);  // 설정 패널(키/한도) 열림
  const { deployN, watchDeploy } = useModalDeploy();  // Modal 배포중 계정 수 + 감시 트리거
  const [preview, setPreview] = useState<PreviewInfo | null>(null);  // '확인' 미리보기(제목·썸네일)
  // 목표 영상 길이(초) — duration-first UX. null = 원본 영상 길이에 맞춤(자동).
  const [targetSec, setTargetSec] = useState<number | null>(30);
  // 원본 영상 길이(초) — preview는 '이어하기' 때 비워지므로 별도 보관('영상 길이' 목표의 근거값).
  const [srcDur, setSrcDur] = useState<number | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [libEntries, setLibEntries] = useState<LibraryEntry[]>([]);  // 최근 다운로드(재사용)
  // 자막 제거 품질 확인 — 군데군데 원본 vs 제거본 프레임
  const [qFrames, setQFrames] = useState<{ t: number; source: string | null; nosub: string | null }[]>([]);
  const [qBusy, setQBusy] = useState(false);
  const [qEngine, setQEngine] = useState<string | null>(null);

  // 화면 분리 — home(메인/프로젝트 목록) vs edit(워크스페이스). 홈 전환해도 편집 상태는 유지.
  const [view, setView] = useState<"home" | "edit">("home");
  // 워크스페이스 — 현재 스테이지 + 프리뷰 영상 재생 위치(자막 타임라인 싱크)
  const [stage, setStage] = useState<StageKey>("source");
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = t;
    setCurrentTime(t);
  };
  // 자막 스테이지 진입 시 대본으로 자막 1회 자동생성했는지 서명((job,script)). TTS 낭비 방지.
  const autoCapRef = useRef("");
  // 대본 스테이지 이탈 시 자동저장용 — 마지막 저장 대본 + 직전 스테이지.
  const lastSavedScriptRef = useRef("");
  const prevStageRef = useRef<StageKey>("source");

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
      const d = await postJSON<{ audio?: string; duration?: number; debug?: string[] }>("/tts/preview", { job_id: job?.id ?? "", script, voice, speaking_rate: rate, emotion, emotion_intensity: emotionIntensity });
      if (d.debug?.length) console.log("[TTS미리듣기 DEBUG] 서버 ↓\n" + d.debug.join("\n"));
      console.log(`[TTS미리듣기] script ${script.length}자, 서버 duration=${d.duration}s, url=${d.audio}`);
      if (d.audio) {
        // 보이는 <audio controls autoPlay>로 재생(다시듣기·스크럽 가능). 숨은 audioRef는 보이스 미리듣기 전용.
        const el = audioRef.current;
        if (el && playing) { el.pause(); setPlaying(null); }   // 보이스 미리듣기 중이면 정지(겹침 방지)
        if (d.duration) recordCps(voice, visChars(script), d.duration, rate);  // 실측 → 예상길이 보정
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
  } = useProductScript({ script, commitScript, videoDuration: targetSec ?? srcDur ?? preview?.duration ?? null });

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

  // 새 프로젝트 — 현재 작업(링크·대본·자막·job)을 접고 소스부터 새로 시작 + 편집 화면 진입.
  // 스타일/보이스/CTA 등 환경설정은 유지(반복 작업 편의). 다운로드/대본은 '이어하기'로 복구 가능.
  function newProject() {
    if ((url.trim() || script.trim() || job) &&
        !window.confirm("새 프로젝트를 시작할까요? 현재 링크·대본·자막이 초기화돼요. (받아둔 영상·대본은 '이어하기'로 다시 불러올 수 있어요)")) return;
    setUrl("");
    setPreview(null);
    setSrcDur(null);
    setJob(null);
    setScript("");
    scriptDirtyRef.current = false;
    setCaptionLines([]);
    setSelectedCap(null);
    setTtsUrl("");
    setProductUrl("");
    setProductImages([]);
    setSellingPoints("");
    setPointsEdit(false);
    setQFrames([]);
    setCurrentTime(0);
    autoCapRef.current = "";
    resetEngineLogs();
    setStage("source");
    setView("edit");
    loadLibrary();  // 방금 작업물이 라이브러리에 반영됐을 수 있으니 갱신
  }

  // 다운로드 기록 항목 삭제(항목별). 확인 후 DELETE → 목록 새로고침.
  async function deleteLibraryEntry(key: string) {
    if (!window.confirm("이 다운로드 기록을 삭제할까요? (원본·자막제거본 캐시가 지워져요)")) return;
    try {
      await fetch(`${apiBase()}/library/${key}`, { method: "DELETE" });
    } catch {}
    loadLibrary();
  }

  // 현재 대본(제품/AI가공/직접편집)을 job+라이브러리에 저장 — STT만 저장하던 구멍 보완.
  // 이어하기/새로고침에서 최신 대본 복구. job 없으면(영상 없이 제품만) 서버 저장 대상 없음.
  // 서버 재시작으로 job이 소실되면(인메모리 JOBS) 404 — 그 job으론 저장 중지(반복 404 노이즈 방지).
  const goneJobRef = useRef<string | null>(null);
  async function saveScriptToLibrary() {
    if (!job?.id || goneJobRef.current === job.id) return;
    const s = script.trim();
    if (!s || s === lastSavedScriptRef.current) return;   // 변경 없으면 skip
    lastSavedScriptRef.current = s;
    try {
      const r = await fetch(`${apiBase()}/jobs/${job.id}/script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: s }),
      });
      if (r.status === 404) {
        goneJobRef.current = job.id;
        console.warn("[대본 자동저장] 작업 세션이 서버에 없어요(서버 재시작으로 소실). "
          + "화면 편집은 그대로 유지되고, 소스 단계에서 '이어하기'로 다시 불러오면 저장이 재개돼요.");
      }
    } catch {}
  }

  // 대본 스테이지를 떠날 때(상단 보이스 클릭 / 다음 바 / 렌더 등) 대본 자동저장.
  useEffect(() => {
    if (prevStageRef.current === "script" && stage !== "script") saveScriptToLibrary();
    prevStageRef.current = stage;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // 대본을 고치면 1.2초 유휴 뒤 자동저장(디바운스) — 스테이지 안 옮겨도, 새로고침 전에도 반영.
  // 불러오기 직후엔 lastSavedScriptRef=로드값이라 skip(불필요 저장 안 함).
  useEffect(() => {
    if (!job?.id) return;
    const s = script.trim();
    if (!s || s === lastSavedScriptRef.current) return;
    const id = setTimeout(() => { saveScriptToLibrary(); }, 1200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script, job?.id]);

  // 대본 생성하면 자막 생성 — 자막 스테이지 처음 들어갈 때(대본·job 있고 자막 아직 없음) 1회 자동생성.
  // 소스에서 '이어하기'로 대본까지 불러온 경우도 여기로 이어짐. 자막이 이미 있으면 건드리지 않음.
  useEffect(() => {
    if (stage !== "caption" || !captionsOn) return;
    if (!job?.id || !script.trim() || capBusy || captionLines.length > 0) return;
    const sig = `${job.id}:${script}`;
    if (autoCapRef.current === sig) return;   // 이 (job,대본)으론 이미 시도(빈 결과여도 재시도 안 함)
    autoCapRef.current = sig;
    genCaptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, captionsOn, job?.id, script, capBusy, captionLines.length]);

  // '확인' — 다운로드 없이 제목/썸네일 미리보기. 이미 받은 영상이면 재사용·단계 표시.
  async function checkUrl(u?: string) {
    const target = (u ?? url).trim();
    if (!target || previewBusy) return;
    setPreviewBusy(true);
    setPreview(null);
    try {
      const p = await postJSON<PreviewInfo>("/preview_url", { url: target });
      setPreview(p);
      if (p.duration) setSrcDur(p.duration);
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
        if (j.script) { setScript(j.script); scriptDirtyRef.current = true; lastSavedScriptRef.current = j.script; }
      }
      const lbl: Record<string, string> = { source: "원본", nosub: "자막제거본", script: "대본" };
      // preview는 비우지만 영상 길이는 라이브러리 항목에서 보존('영상 길이' 목표가 실값 유지)
      const ent = libEntries.find((e) => e.url === t);
      if (ent?.duration) setSrcDur(ent.duration);
      setPreview(null);
      setStage("script");  // 불러온 뒤 자연스러운 다음 단계로 이동
      setView("edit");     // 홈에서 이어하기 → 편집 화면 진입
      alert(`이어하기 완료 · ${lbl[r.loaded] || r.loaded}까지 불러왔어요. 이어서 진행하세요.`);
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
      // 분석 끝나면 라이브러리 갱신 + 미리보기 갱신 + 다음 단계(대본)로 이동
      // target 고정 — 입력창(url)은 stale일 수 있어(opts.url 분석 시) 엉뚱한 미리보기 갱신 방지
      pollJob(job_id, ["analyzed", "error"], (j) => {
        loadLibrary();
        checkUrl(target);
        if (j.status === "analyzed") setStage("script");
      });
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
      // 받아쓰기는 '명시 요청' — 폴링의 dirty 게이트(타이핑 보호)에 막히지 않게
      // 완료 시점에 commitScript로 반영(기존 대본은 Ctrl+Z 복구 가능).
      pollJob(job.id, ["transcribed", "error"], (j) => {
        if (j.status === "transcribed" && j.script) {
          commitScript(j.script);
          lastSavedScriptRef.current = j.script;
        }
      });
    } catch {
      setScriptBusy(false);
      alert("자동 대본 생성 실패.");
    }
  }

  // 대본 → 서버서 TTS 돌려 자동자막 줄(타임코드) 받아 타임라인 편집기에 채움.
  async function genCaptions() {
    if (!job?.id || !script.trim() || capBusy) return;
    // 재생성은 서버가 새 줄을 만들어 줄별 스타일(잠금)·수동 강조가 전부 초기화됨 — 편집분 있으면 확인.
    if (captionLines.some((l) => l.style || l.emph) &&
        !window.confirm("자막을 다시 생성하면 줄별 스타일(잠금)·단어 강조 편집이 초기화돼요. 계속할까요?")) return;
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
          emotion,
          emotion_intensity: emotionIntensity,
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
      setSelectedCap(null);   // 새 자막 → 선택 해제(전체 모드)
      // 마지막 줄 끝 = 실측 TTS 길이 → 예상길이(CPS) 보정
      const lastEnd = lines.length ? lines[lines.length - 1].end : 0;
      if (lastEnd > 1) recordCps(voice, visChars(script), lastEnd, rate);
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
      setSelectedCap(null);   // 재분할로 줄 수/경계 변경 → 위치 기반 선택 무효
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
    setSelectedCap(null);   // 줄 구성이 되돌아감 → 선택 초기화
  }

  // 훅(첫 문장) 대안 3개 — 택1해서 대본 첫 줄 교체.
  const [hookCands, setHookCands] = useState<string[]>([]);
  const [hooksBusy, setHooksBusy] = useState(false);
  async function fetchHooks() {
    if (!script.trim() || hooksBusy) return;
    setHooksBusy(true);
    try {
      const d = await postJSON<{ hooks: string[] }>("/script/hooks", { script });
      if (!d.hooks?.length) alert("훅 후보 생성 실패 — 잠시 후 다시 시도해 주세요.");
      setHookCands(d.hooks || []);
    } catch (e) {
      alert(errMsg(e, "훅 후보 생성 실패."));
    } finally {
      setHooksBusy(false);
      bumpUsage();
    }
  }
  // 대본 첫 번째 비어있지 않은 줄을 선택한 훅으로 교체(undo 히스토리에 기록됨)
  function applyHook(h: string) {
    const lines = script.split("\n");
    const i = lines.findIndex((l) => l.trim());
    if (i < 0) return;
    lines[i] = h;
    commitScript(lines.join("\n"));
    setHookCands([]);
  }

  // 가공 채택/되돌리기 로깅 — 어떤 방향이 자주 버려지는지(프롬프트 개선 근거). 실패 무시.
  const lastRefineRef = useRef<{ dir: string; t: number } | null>(null);
  function logRefine(direction: string, action: "apply" | "undo") {
    fetch(`${apiBase()}/metrics/refine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction, action }),
    }).catch(() => {});
  }
  // 가공 직후 90초 안의 Ctrl+Z = 그 방향 실패 신호로 기록
  function handleScriptUndo() {
    const lr = lastRefineRef.current;
    if (lr && Date.now() - lr.t < 90_000) {
      logRefine(lr.dir, "undo");
      lastRefineRef.current = null;
    }
    undoScript();
  }

  // direction: 8방향 다이얼 키(hook/impact/…) — 없으면 기본(번역투 정리) 가공.
  // fitSec 주면 그 초수 분량에 맞추도록 제약(목표 길이 맞추기).
  async function refineScript(direction?: string, fitSec?: number | null) {
    if (!script.trim() || refineBusy) return;
    setRefineBusy(true);
    try {
      const r = await fetch(`${apiBase()}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, direction: direction ?? null, target_sec: fitSec ?? null }),
      });
      if (!r.ok) {
        alert("AI 가공 실패. GEMINI_API_KEY 또는 auth/gemini_key.txt가 필요합니다.");
      } else {
        const data = await r.json();
        if (data.script) {
          commitScript(data.script);
          lastRefineRef.current = { dir: direction ?? "base", t: Date.now() };
          logRefine(direction ?? "base", "apply");
        }
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
        job_id: job.id, script, voice, speaking_rate: rate, emotion, emotion_intensity: emotionIntensity, cta,
        cta_on: ctaOn, cta_size: ctaSize, cta_pos: ctaPos,
        captions: captionsOn,
        caption_style: captionStyle,
        // 타임라인 편집기서 손댄 줄이 있으면 그대로, 없으면 null(서버 자동생성)
        caption_lines: captionLines.length ? captionLines : null,
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
  const isFinal = !!job?.output;
  // 상대경로 → 절대경로(외부 기기/공유시 동작). 다운로드·공유 링크에만 적용.
  const absUrl = (rel: string) => (typeof window !== "undefined" ? new URL(rel, window.location.origin).href : rel);

  // 스테이지 완료 표시(상단 칩 체크)
  const done: Record<StageKey, boolean> = {
    source: !!job?.id,
    script: !!script.trim(),
    voice: !!script.trim(),
    caption: captionLines.length > 0,
    render: !!job?.output,
  };

  // 예상 발화 길이(초) + 유효 목표(명시 목표 > 원본 영상 길이) — 대본/보이스/렌더 공용
  const estSec = estimateSec(script, rate, voice);
  const effTargetSec = targetSec ?? srcDur ?? preview?.duration ?? null;

  // 홈 '편집 계속하기' 노출 조건 + 라벨(제목 > 링크 요약)
  const hasWork = !!(url.trim() || script.trim() || job);
  const workLabel = preview?.title || (url.trim() ? url.trim() : undefined);

  return (
    <div className="flex h-screen flex-col overflow-hidden text-[var(--text)]">
      {/* 보이스 미리듣기용 단일 오디오 엘리먼트(iOS 인앱브라우저 호환) */}
      <audio ref={audioRef} onEnded={onAudioEnded} preload="auto" className="hidden" />

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} onSaved={bumpUsage} onDeploy={watchDeploy} />}

      {view === "home" && (
        <HomeView
          entries={libEntries}
          hasWork={hasWork}
          workLabel={workLabel}
          onNew={newProject}
          onContinue={() => setView("edit")}
          onResume={resumeFromLibrary}
          onDelete={deleteLibraryEntry}
          onOpenSettings={() => setSettingsOpen(true)}
          usageRefresh={usageRefresh}
          usageActive={busy || scriptBusy}
          deployN={deployN}
        />
      )}

      {view === "edit" && (
      <>
      <TopBar
        stage={stage}
        onStage={setStage}
        done={done}
        onOpenSettings={() => setSettingsOpen(true)}
        usageRefresh={usageRefresh}
        usageActive={busy || scriptBusy}
        deployN={deployN}
        onHome={() => { setView("home"); loadLibrary(); }}
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* 좌: 항상 보이는 9:16 프리뷰 + 진행/오류/TTS */}
        <PreviewPane
          videoUrl={previewUrl}
          isFinal={isFinal}
          captionLines={captionLines}
          captionsOn={captionsOn}
          defaultStyle={captionStyle}
          ctaOn={ctaOn}
          cta={cta}
          ctaSize={ctaSize}
          ctaPos={ctaPos}
          ttsUrl={ttsUrl}
          ttsVoice={voice}
          onCloseTts={() => setTtsUrl("")}
          busy={busy || scriptBusy}
          job={job}
          videoRef={videoRef}
          onTime={setCurrentTime}
          onCtaPos={setCtaPos}
          selectedCap={capSel}
          onCaptionPos={(x, y) => {
            if (capSel != null) {
              const eff = captionLines[capSel].style ?? captionStyle;
              updateLineStyle(capSel, { ...eff, posX: x, posY: y });
            } else {
              setCaptionStyle((s) => ({ ...s, posX: x, posY: y }));
            }
          }}
        />

        {/* 중앙: 스테이지별 작업 패널 + 하단 이전/다음 바 */}
        <div className="flex min-w-0 flex-1 flex-col">
        <main className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {stage === "source" && (
            <SourceStage
              url={url} setUrl={setUrl}
              onPasteClipboard={pasteFromClipboard}
              onCheck={() => checkUrl()} previewBusy={previewBusy}
              onAnalyze={() => analyze()} busy={busy}
              preview={preview}
              libEntries={libEntries}
              onPickLibrary={(u) => { setUrl(u); checkUrl(u); }}
              onResume={resumeFromLibrary}
              onDeleteLibrary={deleteLibraryEntry}
              job={job}
              qFrames={qFrames} qBusy={qBusy} qEngine={qEngine} onCheckQuality={checkQuality}
            />
          )}
          {stage === "script" && (
            <ScriptStage
              script={script}
              onChangeScript={(v) => { scriptDirtyRef.current = true; setScript(v); }}
              onFocusScript={beginSnapshot}
              onBlurScript={commitSnapshotIfChanged}
              canUndo={canUndo} canRedo={canRedo} onUndo={handleScriptUndo} onRedo={redoScript}
              onRefine={refineScript} refineBusy={refineBusy}
              onGenFromVideo={genScript} scriptBusy={scriptBusy}
              job={job}
              estSec={estSec} rate={rate}
              cpsNote={(() => { const i = getCpsInfo(voice); return i.n
                ? `이 성우 실측 보정 ${i.n}회 (실효 ${i.cps}자/초 — 쉼·발음 포함)`
                : "보정 전(기본 5.5자/초) — TTS 미리듣기 한 번이면 이 성우 속도로 보정돼요"; })()}
              targetSec={targetSec} setTargetSec={setTargetSec}
              videoDur={srcDur ?? preview?.duration ?? null}
              onFitLength={() => refineScript("concise", effTargetSec)}
              hookCands={hookCands} hooksBusy={hooksBusy}
              onFetchHooks={fetchHooks} onApplyHook={applyHook}
              onClearHooks={() => setHookCands([])}
              productUrl={productUrl} setProductUrl={setProductUrl}
              productImages={productImages} setProductImages={setProductImages}
              sellingPoints={sellingPoints} setSellingPoints={setSellingPoints}
              productBusy={productBusy} productErr={productErr} productMsg={productMsg} productStage={productStage}
              pointsEdit={pointsEdit} setPointsEdit={setPointsEdit}
              addImageFiles={addImageFiles}
              onProductPaste={onProductPaste}
              onGenerateProduct={generateProductScript}
            />
          )}
          {stage === "voice" && (
            <VoiceStage
              voices={tcVoices}
              voice={voice} setVoice={setVoice}
              emotion={emotion} setEmotion={setEmotion}
              emotionIntensity={emotionIntensity} setEmotionIntensity={setEmotionIntensity}
              rate={rate} setRate={setRate}
              onPreviewTts={previewTts} ttsBusy={ttsBusy} hasScript={!!script.trim()}
              onOpenSettings={() => setSettingsOpen(true)}
              estSec={estSec}
              playing={playing} loadingVoice={loadingVoice} onToggleVoice={toggleVoice}
            />
          )}
          {stage === "caption" && (
            <CaptionStage
              lines={captionLines}
              onChange={setCaptionLines}
              defaultStyle={captionStyle}
              captionsOn={captionsOn} setCaptionsOn={setCaptionsOn}
              onGenerate={genCaptions} generating={capBusy} hasScript={!!job?.id && !!script.trim()}
              onAiEdit={editCaptions} aiEditBusy={capEditBusy}
              onUndoEdit={undoCaptionEdit} canUndoEdit={!!capEditPrev}
              currentTime={currentTime}
              onSeek={seekTo}
              selected={capSel}
              onSelect={(i) => setSelectedCap(i)}
              onToggleLock={(i) => {
                const ln = captionLines[i];
                updateLineStyle(i, ln.style ? null : { ...(ln.style ?? captionStyle) });
              }}
            />
          )}
          {stage === "render" && (
            <RenderStage
              ctaList={ctaList} cta={cta} setCta={setCta}
              onAddCta={addCustomCta} onDeleteCta={deleteCta}
              ctaOn={ctaOn} setCtaOn={setCtaOn}
              ctaSize={ctaSize} setCtaSize={setCtaSize}
              ctaPos={ctaPos} setCtaPos={setCtaPos}
              captionsOn={captionsOn}
              onRender={startRender} busy={busy} job={job}
              outputUrl={job?.output ? previewUrl : null}
              absUrl={absUrl}
              estSec={estSec}
            />
          )}
        </main>
        <StageFooter stage={stage} onStage={setStage} />
        </div>

        {/* 우: 자막 스타일 — 전체/선택 대상 토글 + 스타일 인스펙터 */}
        {stage === "caption" && (
          <aside className="thin-scroll w-full flex-none overflow-y-auto border-t border-[var(--line)] px-4 py-4 lg:w-[440px] lg:border-l lg:border-t-0 xl:w-[480px]">
            {/* 적용 대상: 전체 자막 vs 선택 자막(목록에서 줄 클릭) */}
            <div className="mb-3 flex items-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-1 text-[12px] font-medium">
              <button
                onClick={() => setSelectedCap(null)}
                className={`flex-1 rounded-lg px-3 py-1.5 transition ${capSel == null ? "bg-pink-500/15 text-pink-400 ring-1 ring-pink-500/30" : "text-slate-400 hover:bg-white/5"}`}
              >
                전체 자막
              </button>
              <button
                disabled={capSel == null}
                className={`flex-1 rounded-lg px-3 py-1.5 transition ${capSel != null ? "bg-pink-500/15 text-pink-400 ring-1 ring-pink-500/30" : "text-slate-600"}`}
              >
                {capSel != null ? `선택 자막 · ${capSel + 1}번` : "선택 자막 (줄 클릭)"}
              </button>
            </div>
            <CaptionEditor
              value={capSel != null ? (captionLines[capSel].style ?? captionStyle) : captionStyle}
              onChange={capSel != null ? (s) => updateLineStyle(capSel, s) : setCaptionStyle}
              scope={capSel != null ? "selected" : "all"}
              scopeLabel={capSel != null ? `${capSel + 1}번 줄` : undefined}
            />
          </aside>
        )}
      </div>
      </>
      )}
    </div>
  );
}
