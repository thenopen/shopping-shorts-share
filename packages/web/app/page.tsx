"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CaptionEditor from "./CaptionEditor";
import { CaptionLineData } from "./caption/types";
import { apiBase, apiFetch, postJSON, errMsg, setToken, hasToken, onUnauthorized } from "./lib/api";
import { JobState, PreviewInfo, LibraryEntry, TypecastVoice, TtsEngine, OverlayLib, OverlaySel } from "./lib/types";
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
import CaptionStage from "./components/workspace/CaptionStage";
import { ToastContainer, toast } from "./components/ui/Toast";
import { ModalContainer, confirmDialog, promptDialog } from "./components/ui/Modal";
import { RenderStage } from "./components/workspace/RenderStage";
import { StageFooter } from "./components/workspace/StageFooter";
import { useCtas } from "./hooks/useCtas";
import { useScriptHistory } from "./hooks/useScriptHistory";
import { useModalDeploy } from "./hooks/useModalDeploy";
import { useJobPolling } from "./hooks/useJobPolling";
import { useProductScript } from "./hooks/useProductScript";
import { useVoicePreview } from "./hooks/useVoicePreview";

export default function Home() {
  // ── 부팅 토큰 인증 게이트 ──
  // 게이트 결정 흐름:
  //  1) 마운트 시 URL ?token=... 있으면 저장 + 게이트 해제.
  //  2) 보호 경로(/library)로 인증 필요 여부 능동 감지 → 200이면 게이트 해제(서버가 ALLOW_NO_AUTH=1 인 경우),
  //     401이면 토큰 보유 여부로 게이트 판단(있으면 해제, 없으면 오버레이).
  //  3) 런타임에 401(잘못된 토큰)이면 onUnauthorized 리스너가 authed=false 로 되돌려 오버레이 재표시.
  //
  // SSR/클라이언트 hydration mismatch 방지: 초기 렌더는 항상 "결정 안 됨(로딩)" 상태로 통일.
  // hasToken()이 SSR에선 항상 false(localStorage 접근 불가)라 서버와 클라이언트가 다른 트리를
  // 렌더하는 hydration 에러를 피하려면, 게이트 결정을 전부 useEffect(클라이언트만 실행) 안에 둔다.
  const [authed, setAuthed] = useState(false);
  const [gateResolved, setGateResolved] = useState(false);   // SSR/첫렌더는 무조건 false → 로딩 표시
  const [tokenInput, setTokenInput] = useState("");
  const [tokenErr, setTokenErr] = useState(false);

  // 게이트 결정 — 전부 클라이언트 마운트(useEffect) 이후에만 실행(SSR은 로딩 상태로 통일 → hydration 안전).
  // (1) URL ?token= 처리 + (2) 서버 인증 필요 여부 probe를 한 effect에서 순차 처리.
  useEffect(() => {
    let live = true;
    // (1) URL ?token= 있으면 저장 + 바로 통과.
    try {
      const u = new URL(window.location.href);
      const t = u.searchParams.get("token");
      if (t) {
        setToken(t);
        setAuthed(true);
        setGateResolved(true);
        u.searchParams.delete("token");
        window.history.replaceState({}, "", u.toString());
        return;   // 토큰 저장했으니 probe 불필요
      }
    } catch {}

    // (2) 토큰 있으면 통과, 없으면 /library probe로 서버 인증 필요 여부 감지.
    if (hasToken()) { setAuthed(true); setGateResolved(true); return; }
    (async () => {
      try {
        const r = await apiFetch("/library");
        if (live && r.status === 200) setAuthed(true);   // 서버가 인증 안 요구 → 통과
      } catch {
        // AuthError(401) → authed=false 유지 → 오버레이 표시. 다른 네트워크 오류면 통과(서버 다운 대비).
        if (live) setAuthed(true);
      } finally {
        if (live) setGateResolved(true);
      }
    })();
    return () => { live = false; };
  }, []);

  // (3) 런타임 401(잘못된 토큰) → 오버레이 재표시
  useEffect(() => onUnauthorized(() => {
    setAuthed(false);
    setGateResolved(true);
    setTokenErr(true);
  }), []);

  function submitToken() {
    const t = tokenInput.trim();
    if (!t) return;
    setToken(t);
    setAuthed(true);
    setTokenInput("");
    setTokenErr(false);
  }

  const [url, setUrl] = useState("");
  // BGM 라이브러리(assets/bgm/manifest) + 선택. 음원은 사용자가 assets/bgm/ 에 직접 넣어야 available.
  const [bgmList, setBgmList] = useState<{ id: string; title: string; mood: string; available: boolean }[]>([]);
  const [bgm, setBgm] = useState<string>("");   // 선택한 BGM id(""=없음)
  useEffect(() => {
    (async () => {
      try { const r = await apiFetch("/bgm"); if (r.ok) setBgmList((await r.json()).items || []); } catch {}
    })();
  }, []);
  const [engine, setEngine] = useState<TtsEngine>("typecast");  // TTS 엔진: typecast|elevenlabs|google
  const [voice, setVoice] = useState("");            // 엔진별 voice_id(빈값=기본)
  const [emotion, setEmotion] = useState("smart");   // smart | happy/sad/angry/whisper/toneup/tonedown (Typecast)
  const [emotionIntensity, setEmotionIntensity] = useState(1.3);
  // 엔진별 고급 옵션(eleven: stability/similarity/style, google: pitch). 미리듣기/렌더에 tts_opts로 전달.
  const [ttsOpts, setTtsOpts] = useState<Record<string, number>>({ stability: 0.5, similarity: 0.75, style: 0, pitch: 0 });
  // 보이스 목록(설정 키 있을 때) — 엔진 바뀌면 재로드하고 기본 voice_id 선택. 키 없으면 빈 목록.
  const [tcVoices, setTcVoices] = useState<TypecastVoice[]>([]);
  const [voicesErr, setVoicesErr] = useState(false);  // 키 없음/조회실패(엔진 안내 표시용)
  useEffect(() => {
    let live = true;
    (async () => {
      setTcVoices([]); setVoicesErr(false);
      try {
        const r = await apiFetch(`/tts/voices?engine=${engine}`);
        if (!live) return;
        if (!r.ok) { setVoicesErr(true); return; }
        const j = await r.json();
        if (!live) return;
        setTcVoices(j.voices || []);
        // 엔진 전환 시 이전 엔진 voice_id가 새 목록에 없으면 기본으로 교체.
        setVoice((cur) => {
          const ok = cur && (j.voices || []).some((v: TypecastVoice) => v.voice_id === cur);
          return ok ? cur : (j.default || (j.voices?.[0]?.voice_id ?? ""));
        });
      } catch { if (live) setVoicesErr(true); }
    })();
    return () => { live = false; };
  }, [engine]);
  // 오버레이 에셋 라이브러리(말풍선·트랜지션·리액션) + 선택 목록
  const [overlayLib, setOverlayLib] = useState<OverlayLib>({ bubble: [], transition: [], reaction: [] });
  const [overlays, setOverlays] = useState<OverlaySel[]>([]);
  const [selectedOverlay, setSelectedOverlay] = useState<number | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch(`/overlays`);
        if (r.ok) setOverlayLib(await r.json());
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
  // CaptionStage memo 안정화 — captionLinesRef 만 여기 선언(scriptRef 는 useScriptHistory 결과 아래).
  const captionLinesRef = useRef(captionLines);
  useEffect(() => { captionLinesRef.current = captionLines; }, [captionLines]);
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
  // scriptRef — CaptionStage memo 안정화(genCaptions 가 script 를 ref 로 읽어 deps 에서 제외).
  const scriptRef = useRef(script);
  useEffect(() => { scriptRef.current = script; }, [script]);
  const [rate, setRate] = useState(1.0);
  const [renderSeq, setRenderSeq] = useState(0); // 재렌더 시 결과영상 캐시버스터 카운터
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsUrl, setTtsUrl] = useState("");      // 대본 전체 TTS 미리듣기 mp3

  // 현재 대본 + 선택 voice로 TTS 생성해 들어보기. voice 바꿔 다시 누르면 새로 생성.
  async function previewTts() {
    if (!script.trim() || ttsBusy) return;  // 분석 전이어도 대본만 있으면 들어보기 가능
    setTtsBusy(true);
    try {
      const d = await postJSON<{ audio?: string; duration?: number; debug?: string[] }>("/tts/preview", { job_id: job?.id ?? "", script, voice, engine, tts_opts: ttsOpts, speaking_rate: rate, emotion, emotion_intensity: emotionIntensity });
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
        toast.error("음성 생성 실패.");
      }
    } catch {
      toast.error("음성 생성 실패. 서버 상태를 확인하세요.");
    } finally {
      setTtsBusy(false);
    }
  }

  // 목표 길이(초): 명시 칩 > 원본 영상 길이 > 미리보기 길이. 전부 없으면 30 폴백
  // ('영상 길이' 모드인데 영상 길이 미상이면 null 전달돼 목표가 통째로 무시되던 문제 방지).
  const scriptTargetSec = targetSec ?? srcDur ?? preview?.duration ?? 30;
  // 제품 소구포인트: 상세페이지 URL / 캡처이미지 → 대본 결합 (video_content=script, commitScript로 반영)
  const {
    productUrl, setProductUrl, productImages, setProductImages,
    sellingPoints, setSellingPoints, productBusy, productErr, productMsg,
    productStage, pointsEdit, setPointsEdit,
    addImageFiles, onProductPaste, generateProductScript,
  } = useProductScript({ script, commitScript, videoDuration: scriptTargetSec });

  const { audioRef, playing, setPlaying, loadingVoice, toggleVoice, onAudioEnded } = useVoicePreview();
  const [job, setJob] = useState<JobState | null>(null);
  const [busy, setBusy] = useState(false);
  const [scriptBusy, setScriptBusy] = useState(false);
  const [refineBusy, setRefineBusy] = useState(false);
  const [scriptTone, setScriptTone] = useState("");   // 마지막 적용 대본 톤(다이얼 방향) — 프로젝트 저장
  const { pollJob, resetEngineLogs } = useJobPolling({ setJob, setBusy, setScriptBusy, setScript, scriptDirtyRef });

  // 다운로드 라이브러리(최근 재사용 목록) 로드
  async function loadLibrary() {
    try {
      const r = await apiFetch(`/library`);
      if (!r.ok) return;
      const j = await r.json();
      setLibEntries(j.entries || []);
    } catch {}
  }
  useEffect(() => { loadLibrary(); }, []);

  // 새 프로젝트 — 현재 작업(링크·대본·자막·job)을 접고 소스부터 새로 시작 + 편집 화면 진입.
  // 스타일/보이스/CTA 등 환경설정은 유지(반복 작업 편의). 다운로드/대본은 '이어하기'로 복구 가능.
  async function newProject() {
    if ((url.trim() || script.trim() || job) &&
        !(await confirmDialog({ title: "새 프로젝트", message: "새 프로젝트를 시작할까요? 현재 링크·대본·자막이 초기화돼요. (받아둔 영상·대본은 '이어하기'로 다시 불러올 수 있어요)", danger: true }))) return;
    setUrl("");
    setPreview(null);
    setSrcDur(null);
    setJob(null);
    setScript("");
    setScriptTone("");
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
    setOverlays([]);
    setProjectId(null);
    setProjectName("");
    setSaveState("idle");
    skipAutosaveRef.current = true;
    autoCapRef.current = "";
    resetEngineLogs();
    setStage("source");
    setView("edit");
    loadLibrary();  // 방금 작업물이 라이브러리에 반영됐을 수 있으니 갱신
  }

  // ── 프로젝트 저장/불러오기 — 편집 전체(대본·보이스·자막·CTA·오버레이)를 통째로 영속화 ──
  const [projectId, setProjectId] = useState<string | null>(null);   // 불러온/저장한 프로젝트 id
  const [projectName, setProjectName] = useState("");
  const [saving, setSaving] = useState(false);

  function gatherState() {
    const srcUrl = (url || job?.meta?.url || "").trim();   // url 비면 job 메타서 폴백
    return {
      name: projectName || preview?.title || (srcUrl ? "새 프로젝트" : "제목 없는 프로젝트"),
      source_url: srcUrl,
      script,
      script_tone: scriptTone,
      voice: { voice_id: voice, engine, tts_opts: ttsOpts, emotion, emotion_intensity: emotionIntensity, rate },
      captionStyle, captionLines, caption_on: captionsOn,
      cta: { on: ctaOn, text: cta, size: ctaSize, pos: ctaPos },
      overlays,
      target_sec: targetSec,
      // 소구포인트(제품 상세 링크·캡처 이미지·소구점) — 대본 결합 재현용
      product: { url: productUrl, images: productImages, points: sellingPoints },
    };
  }

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");

  // 실제 저장(POST). 같은 projectId면 덮어씀(중복 방지). name 주면 그 이름으로.
  async function doSave(name?: string) {
    if (saving) return;
    setSaving(true); setSaveState("saving");
    try {
      const st = gatherState();
      if (name) st.name = name;
      const r = await postJSON<{ id: string; name: string }>("/projects", { id: projectId, state: st });
      setProjectId(r.id); setProjectName(r.name); setSaveState("saved");
      loadProjects();
    } catch (e) {
      toast.error(errMsg(e, "저장 실패")); setSaveState("idle");
    } finally {
      setSaving(false);
    }
  }

  // 저장 버튼: 첫 저장은 이름 입력 모달, 이후는 같은 프로젝트 덮어쓰기.
  function saveProject() {
    if (projectId) { doSave(); return; }
    setNameInput(projectName || preview?.title || (url ? "새 프로젝트" : ""));
    setNameModalOpen(true);
  }

  // 자동 저장 — 프로젝트가 한 번 저장된 뒤엔 편집 변경 시 1.5초 디바운스로 자동 반영(같은 id 덮어씀).
  const skipAutosaveRef = useRef(true);
  useEffect(() => {
    if (!projectId) return;
    if (skipAutosaveRef.current) { skipAutosaveRef.current = false; return; }  // 불러오기 직후 1회 스킵
    const t = setTimeout(() => doSave(), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, script, scriptTone, captionsOn, ctaOn, cta, ctaSize, ctaPos, voice, engine, emotion, emotionIntensity, rate, targetSec, productUrl, sellingPoints,
      JSON.stringify(ttsOpts), JSON.stringify(captionLines), JSON.stringify(overlays), JSON.stringify(captionStyle)]);

  async function loadProject(id: string) {
    skipAutosaveRef.current = true;   // 불러오기 직후 자동저장 1회 스킵(로드=변경 아님)
    try {
      const r = await apiFetch(`/projects/${id}`);
      if (!r.ok) { toast.error("프로젝트를 불러오지 못했어요."); return; }
      const doc = await r.json();
      const s = doc.state || {};
      setProjectId(doc.id); setProjectName(doc.name || "");
      setUrl(s.source_url || "");
      setScript(s.script || ""); scriptDirtyRef.current = false;
      setScriptTone(s.script_tone || "");
      const v = s.voice || {};
      if (v.engine) setEngine(v.engine);   // 엔진 먼저 — 보이스 목록 재로드가 voice_id 보존/교체 처리
      if (v.tts_opts && typeof v.tts_opts === "object") setTtsOpts((o) => ({ ...o, ...v.tts_opts }));
      if (v.voice_id) setVoice(v.voice_id);
      if (v.emotion) setEmotion(v.emotion);
      if (typeof v.emotion_intensity === "number") setEmotionIntensity(v.emotion_intensity);
      if (typeof v.rate === "number") setRate(v.rate);
      if (s.captionStyle) setCaptionStyle(s.captionStyle);
      setCaptionLines(s.captionLines || []);
      setCaptionsOn(s.caption_on !== false);
      const c = s.cta || {};
      setCtaOn(c.on !== false); if (c.text) setCta(c.text);
      if (typeof c.size === "number") setCtaSize(c.size);
      if (typeof c.pos === "number") setCtaPos(c.pos);
      setOverlays(s.overlays || []);
      if (s.target_sec !== undefined) setTargetSec(s.target_sec);
      // 소구포인트 복원(제품 링크·이미지·소구점)
      const pr = s.product || {};
      setProductUrl(pr.url || "");
      setProductImages(pr.images || []);
      setSellingPoints(pr.points || "");
      setPreview(null); setJob(null);
      // 소스 영상 복원 — 라이브러리 캐시에 있으면 즉시 렌더 가능하게 job 로드.
      // 프로젝트의 대본/자막은 유지(라이브러리 script로 덮어쓰지 않음). 없으면 url만(사용자가 분석).
      console.debug("[프로젝트 불러오기] source_url =", s.source_url || "(없음)");
      if (s.source_url) {
        try {
          const lr = await postJSON<{ job_id: string }>("/library/load", { url: s.source_url });
          const jr = await apiFetch(`/jobs/${lr.job_id}`);
          if (jr.ok) { const j = await jr.json(); setJob(j); console.debug("[프로젝트 불러오기] 소스 복원 OK", j.preview); }
          const ent = libEntries.find((e) => e.url === s.source_url);
          if (ent?.duration) setSrcDur(ent.duration);
        } catch (e) { console.warn("[프로젝트 불러오기] 소스 복원 실패(캐시 없음 → 소스 단계서 분석):", e); }
      }
      setStage("source"); setView("edit");
    } catch { toast.error("불러오기 실패"); }
  }

  const [projectsList, setProjectsList] = useState<{ id: string; name: string; updated: number; source_url: string; n_captions: number; n_overlays: number }[]>([]);
  async function loadProjects() {
    try {
      const r = await apiFetch(`/projects`);
      if (r.ok) setProjectsList((await r.json()).projects || []);
    } catch {}
  }
  useEffect(() => { loadProjects(); }, []);
  async function deleteProject(id: string) {
    if (!(await confirmDialog({ title: "프로젝트 삭제", message: "이 프로젝트를 삭제할까요?", danger: true }))) return;
    try { await apiFetch(`/projects/${id}`, { method: "DELETE" }); } catch {}
    if (projectId === id) { setProjectId(null); setProjectName(""); }
    loadProjects();
  }

  // 다운로드 기록 항목 삭제(항목별). 확인 후 DELETE → 목록 새로고침.
  async function deleteLibraryEntry(key: string) {
    if (!(await confirmDialog({ title: "다운로드 기록 삭제", message: "이 다운로드 기록을 삭제할까요? (원본·자막제거본 캐시가 지워져요)", danger: true }))) return;
    try {
      await apiFetch(`/library/${key}`, { method: "DELETE" });
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
      const r = await apiFetch(`/jobs/${job.id}/script`, {
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
    setUrl(t);   // url 상태 채움 — 저장 시 source_url 비지 않게(불러오기 소스 복원 근거)
    try {
      const r = await postJSON<{ job_id: string; loaded: string; script: string }>(
        "/library/load", { url: t });
      const jr = await apiFetch(`/jobs/${r.job_id}`);
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
      toast.success(`이어하기 완료 · ${lbl[r.loaded] || r.loaded}까지 불러왔어요. 이어서 진행하세요.`);
    } catch (e) {
      toast.error(errMsg(e, "이어하기 실패"));
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
      toast.error(errMsg(e, "품질 확인 실패"));
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
      if (!job_id) { setBusy(false); toast.error("작업 ID를 받지 못했습니다. 백엔드 로그를 확인하세요."); return; }
      // 분석 끝나면 라이브러리 갱신 + 미리보기 갱신 + 다음 단계(대본)로 이동
      // target 고정 — 입력창(url)은 stale일 수 있어(opts.url 분석 시) 엉뚱한 미리보기 갱신 방지
      pollJob(job_id, ["analyzed", "error"], (j) => {
        loadLibrary();
        checkUrl(target);
        if (j.status === "analyzed") setStage("script");
      });
    } catch {
      setBusy(false);
      toast.error("서버 연결 실패. 8000 포트 백엔드를 확인하세요.");
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
      toast.error("자동 대본 생성 실패.");
    }
  }

  // 대본 → 서버서 TTS 돌려 자동자막 줄(타임코드) 받아 타임라인 편집기에 채움.
  // useCallback 로 안정화 — script/captionLines 는 ref 로 읽어(대본 타이핑마다 참조가 바뀌어
  // CaptionStage memo 가 깨지는 것 방지). 실제 의존성은 job.id/voice/engine/스타일 등.
  const genCaptions = useCallback(async () => {
    const s = scriptRef.current;
    const caps = captionLinesRef.current;
    if (!job?.id || !s.trim() || capBusy) return;
    // 재생성은 서버가 새 줄을 만들어 줄별 스타일(잠금)·수동 강조가 전부 초기화됨 — 편집분 있으면 확인.
    if (caps.some((l) => l.style || l.emph) &&
        !(await confirmDialog({ title: "자막 재생성", message: "자막을 다시 생성하면 줄별 스타일(잠금)·단어 강조 편집이 초기화돼요. 계속할까요?", danger: true }))) return;
    setCapBusy(true);
    try {
      const r = await apiFetch(`/captions/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: job.id,
          script: s,
          voice,
          engine,
          tts_opts: ttsOpts,
          speaking_rate: rate,
          emotion,
          emotion_intensity: emotionIntensity,
          caption_style: captionStyle,
        }),
      });
      if (!r.ok) {
        const msg = await r.text();
        toast.error(`자동 자막 생성 실패: ${msg}`);
        return;
      }
      const data = await r.json();
      const lines: CaptionLineData[] = normLines(data.lines);
      setCaptionLines(lines);
      setCapEditPrev(null);
      setSelectedCap(null);   // 새 자막 → 선택 해제(전체 모드)
      // 마지막 줄 끝 = 실측 TTS 길이 → 예상길이(CPS) 보정
      const lastEnd = lines.length ? lines[lines.length - 1].end : 0;
      if (lastEnd > 1) recordCps(voice, visChars(s), lastEnd, rate);
    } catch {
      toast.error("자동 자막 생성 실패. 서버 연결을 확인하세요.");
    } finally {
      setCapBusy(false);
      bumpUsage();
    }
  }, [job?.id, capBusy, voice, engine, ttsOpts, rate, emotion, emotionIntensity, captionStyle]);

  // AI/규칙 기반 자막 다듬기 — 방향(shorter/longer/natural/impact/friendly/concise)을
  // 서버 /captions/edit로 보내 변환된 줄로 교체. 직전 상태는 되돌리기용으로 보관.
  const editCaptions = useCallback(async (direction: string) => {
    const caps = captionLinesRef.current;
    if (!caps.length || capEditBusy) return;
    setCapEditBusy(true);
    const prev = caps;
    try {
      const d = await postJSON<{ lines: CaptionLineData[] }>("/captions/edit", {
        lines: caps,
        direction,
        caption_style: captionStyle,
      });
      const next: CaptionLineData[] = normLines(d.lines);
      if (!next.length) { toast.error("다듬기 결과가 비었습니다."); return; }
      setCapEditPrev(prev);
      setCaptionLines(next);
      setSelectedCap(null);   // 재분할로 줄 수/경계 변경 → 위치 기반 선택 무효
    } catch (e) {
      toast.error(errMsg(e, "자막 다듬기 실패."));
    } finally {
      setCapEditBusy(false);
      bumpUsage();
    }
  }, [capEditBusy, captionStyle]);

  const undoCaptionEdit = useCallback(() => {
    if (!capEditPrev) return;
    setCaptionLines(capEditPrev);
    setCapEditPrev(null);
    setSelectedCap(null);   // 줄 구성이 되돌아감 → 선택 초기화
  }, [capEditPrev]);

  // CaptionStage memo 안정화용 안정 콜백들 — 인라인 화살표를 추출해 참조 고정.
  const onSelectCap = useCallback((i: number | null) => setSelectedCap(i), []);
  const onToggleLock = useCallback((i: number) => {
    const ln = captionLinesRef.current[i];
    if (!ln) return;
    updateLineStyle(i, ln.style ? null : { ...(ln.style ?? captionStyle) });
  }, [captionStyle]);

  // 훅(첫 문장) 대안 3개 — 택1해서 대본 첫 줄 교체.
  const [hookCands, setHookCands] = useState<string[]>([]);
  const [hooksBusy, setHooksBusy] = useState(false);
  async function fetchHooks() {
    if (!script.trim() || hooksBusy) return;
    setHooksBusy(true);
    try {
      const d = await postJSON<{ hooks: string[] }>("/script/hooks", { script });
      if (!d.hooks?.length) toast.error("훅 후보 생성 실패 — 잠시 후 다시 시도해 주세요.");
      setHookCands(d.hooks || []);
    } catch (e) {
      toast.error(errMsg(e, "훅 후보 생성 실패."));
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
    apiFetch(`/metrics/refine`, {
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
      const r = await apiFetch(`/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, direction: direction ?? null, target_sec: fitSec ?? null }),
      });
      if (!r.ok) {
        toast.error("AI 가공 실패. GEMINI_API_KEY 또는 auth/gemini_key.txt가 필요합니다.");
      } else {
        const data = await r.json();
        if (data.script) {
          commitScript(data.script);
          lastRefineRef.current = { dir: direction ?? "base", t: Date.now() };
          setScriptTone(direction ?? "base");   // 적용 톤 기록(저장/복원 대상)
          logRefine(direction ?? "base", "apply");
        }
      }
    } catch {
      toast.error("AI 가공 실패.");
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
        job_id: job.id, script, voice, engine, tts_opts: ttsOpts, speaking_rate: rate, emotion, emotion_intensity: emotionIntensity, cta,
        cta_on: ctaOn, cta_size: ctaSize, cta_pos: ctaPos,
        captions: captionsOn,
        caption_style: captionStyle,
        // 타임라인 편집기서 손댄 줄이 있으면 그대로, 없으면 null(서버 자동생성)
        caption_lines: captionLines.length ? captionLines : null,
        overlays: overlays.length ? overlays.map((o) => ({ id: o.id, x: o.x, y: o.y, scale: o.scale, start: o.start, end: o.end, fullscreen: o.fullscreen })) : null,
        bgm: bgm || null,   // BGM id(""=없음 → null)
      });
      if (!job_id) { setBusy(false); toast.error("렌더 작업 ID를 받지 못했습니다."); return; }
      pollJob(job_id, ["done", "error"]);
    } catch {
      setBusy(false);
      toast.error("렌더 요청 실패.");
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

  // 예상 발화 길이(초) + 유효 목표(명시 목표 > 원본 영상 길이 > 30 폴백) — 대본/보이스/렌더 공용
  const estSec = estimateSec(script, rate, voice);
  const effTargetSec = scriptTargetSec;

  // 홈 '편집 계속하기' 노출 조건 + 라벨(제목 > 링크 요약)
  const hasWork = !!(url.trim() || script.trim() || job);
  const workLabel = preview?.title || (url.trim() ? url.trim() : undefined);

  // 토큰이 없고 서버가 인증을 요구하는 상황 → 토큰 입력 오버레이. (서버가 ALLOW_NO_AUTH=1 이면
  // 게이트 렌더링 — probe 중(gateResolved=false)엔 로딩, probe 후 미인증이면 토큰 입력 오버레이.
  // probe: 서버가 인증을 요구하는지(/library 한 번 호출) 능동 감지. 그 전엔 깜빡임 방지용 로딩.
  if (!gateResolved) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg)] text-[var(--text-mut)]">
        <div className="animate-pulse text-sm">서버에 연결 중…</div>
      </div>
    );
  }
  if (!authed) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[var(--bg)] p-6 text-[var(--text)]">
        <div className="max-w-md rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-6 text-center">
          <div className="mb-2 text-lg font-bold">🔒 서버 접속 토큰 필요</div>
          <p className="mb-4 text-sm text-[var(--text-mut)]">
            코어 서버가 켜진 터미널(콘솔)에 표시된 토큰을 입력하세요.<br />
            폰/다른 기기에서 접속할 때 처음 한 번만 필요합니다.
          </p>
          <input
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitToken(); }}
            placeholder="토큰 붙여넣기"
            autoFocus
            className="w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2 text-sm outline-none"
          />
          {tokenErr && <p className="mt-2 text-xs text-rose-400">토큰이 올바르지 않아요. 다시 확인해 주세요.</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={submitToken} className="flex-1 rounded-lg bg-pink-500 px-4 py-2 text-sm font-semibold text-white">
              접속
            </button>
            <button
              onClick={() => { setAuthed(true); }}   // 서버가 인증 안 켰을 수도 있으니 통과 시도
              className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm text-[var(--text-mut)]"
            >
              건너뛰기
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden text-[var(--text)]">
      <ToastContainer />
      <ModalContainer />
      {/* 보이스 미리듣기용 단일 오디오 엘리먼트(iOS 인앱브라우저 호환) */}
      <audio ref={audioRef} onEnded={onAudioEnded} preload="auto" className="hidden" />

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} onSaved={bumpUsage} onDeploy={watchDeploy} />}

      {/* 첫 저장 — 프로젝트 이름 정하기(중복 방지: 이후엔 같은 프로젝트 자동저장) */}
      {nameModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={() => setNameModalOpen(false)}>
          <div className="panel w-full max-w-sm rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-sm font-bold text-slate-100">프로젝트 이름</div>
            <p className="mb-3 text-[11px] text-slate-500">저장할 프로젝트 이름을 정하세요. 이후 편집은 자동 저장돼요.</p>
            <input
              autoFocus value={nameInput} onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && nameInput.trim()) { setNameModalOpen(false); doSave(nameInput.trim()); } }}
              placeholder="예: 겔랑 세럼 리뷰"
              className="field mb-4 w-full rounded-xl px-4 py-2.5 text-sm outline-none"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setNameModalOpen(false)} className="btn-ghost rounded-lg px-4 py-2 text-sm font-medium">취소</button>
              <button
                onClick={() => { if (nameInput.trim()) { setNameModalOpen(false); doSave(nameInput.trim()); } }}
                disabled={!nameInput.trim()}
                className="btn-primary rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
              >저장</button>
            </div>
          </div>
        </div>
      )}

      {view === "home" && (
        <HomeView
          entries={libEntries}
          projects={projectsList}
          onLoadProject={loadProject}
          onDeleteProject={deleteProject}
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
        onHome={() => { setView("home"); loadLibrary(); loadProjects(); }}
        onSave={saveProject} saving={saving} projectName={projectName} saveState={saveState}
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* 좌: 항상 보이는 9:16 프리뷰 + 진행/오류/TTS */}
        <PreviewPane
          videoUrl={previewUrl}
          isFinal={isFinal}
          onDuration={(d) => setSrcDur(d)}
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
          overlays={stage === "render" ? overlays : undefined}
          onOverlayPos={(i, x, y) => setOverlays((o) => o.map((v, idx) => (idx === i ? { ...v, x, y } : v)))}
          selectedOverlay={selectedOverlay}
          onSelectOverlay={setSelectedOverlay}
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
              onRefine={(dir) => refineScript(dir, effTargetSec)} refineBusy={refineBusy}
              activeTone={scriptTone}
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
              engine={engine} setEngine={setEngine}
              voicesErr={voicesErr}
              ttsOpts={ttsOpts} setTtsOpts={setTtsOpts}
              voices={tcVoices}
              voice={voice} setVoice={setVoice}
              emotion={emotion} setEmotion={setEmotion}
              emotionIntensity={emotionIntensity} setEmotionIntensity={setEmotionIntensity}
              rate={rate} setRate={setRate}
              onPreviewTts={previewTts} ttsBusy={ttsBusy} hasScript={!!script.trim()}
              onOpenSettings={() => setSettingsOpen(true)}
              estSec={estSec}
              playing={playing} loadingVoice={loadingVoice}
              onToggleVoice={(vid) => toggleVoice(vid, engine)}
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
              onSelect={onSelectCap}
              onToggleLock={onToggleLock}
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
              overlayLib={overlayLib} overlays={overlays} setOverlays={setOverlays}
              selectedOverlay={selectedOverlay} setSelectedOverlay={setSelectedOverlay}
              videoDur={preview?.duration ?? srcDur ?? job?.output_dur ?? estSec ?? null}
              onRender={startRender} busy={busy} job={job}
              outputUrl={job?.output ? previewUrl : null}
              absUrl={absUrl}
              estSec={estSec}
              bgmList={bgmList} bgm={bgm} setBgm={setBgm}
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
