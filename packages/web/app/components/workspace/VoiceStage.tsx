"use client";

// 보이스 스테이지 — 엔진 선택(Typecast/ElevenLabs/Google) + 보이스 브라우저(검색/필터)
// + 엔진별 옵션(Typecast 감정 / ElevenLabs 안정성·유사도 / Google 피치) + 말속도 + 미리듣기.
import { useMemo, useState } from "react";
import { Mic, Search, Play, Pause, Sparkles, KeyRound } from "lucide-react";
import { Spinner } from "../../ui";
import type { TypecastVoice, TtsEngine } from "../../lib/types";

const EMO_LABEL: Record<string, string> = {
  normal: "기본", happy: "밝게", sad: "슬프게", angry: "강하게",
  whisper: "속삭임", toneup: "톤업", tonedown: "톤다운", tonemid: "톤중간",
};
const AGE_LABEL: Record<string, string> = {
  child: "아동", teenager: "10대", young_adult: "청년", middle_age: "중년", senior: "장년",
};

// 엔진 메타 — 탭 라벨 + 키 안내.
const ENGINES: { id: TtsEngine; label: string; hint: string }[] = [
  { id: "typecast", label: "Typecast", hint: "한국어 감정 TTS · 무료 월 3만자" },
  { id: "elevenlabs", label: "ElevenLabs", hint: "다국어 고품질 · 안정성/유사도" },
  { id: "google", label: "Google", hint: "Cloud TTS · Chirp3-HD" },
];

export function VoiceStage(props: {
  engine: TtsEngine; setEngine: (e: TtsEngine) => void;
  voicesErr: boolean;
  ttsOpts: Record<string, number>; setTtsOpts: (o: Record<string, number>) => void;
  voices: TypecastVoice[];
  voice: string; setVoice: (v: string) => void;
  emotion: string; setEmotion: (e: string) => void;
  emotionIntensity: number; setEmotionIntensity: (n: number) => void;
  rate: number; setRate: (n: number) => void;
  onPreviewTts: () => void; ttsBusy: boolean; hasScript: boolean;
  onOpenSettings: () => void;
  estSec: number | null;
  // 성우별 미리듣기(고정 문구 샘플) — page.tsx useVoicePreview와 배선
  playing: string | null; loadingVoice: string | null;
  onToggleVoice: (voiceId: string) => void;
}) {
  const {
    engine, setEngine, voicesErr, ttsOpts, setTtsOpts,
    voices, voice, setVoice, emotion, setEmotion, emotionIntensity, setEmotionIntensity,
    rate, setRate, onPreviewTts, ttsBusy, hasScript, onOpenSettings, estSec,
    playing, loadingVoice, onToggleVoice,
  } = props;

  const [q, setQ] = useState("");
  const [gender, setGender] = useState<"all" | "male" | "female">("all");
  const [shortsOnly, setShortsOnly] = useState(true);
  const [koreanOnly, setKoreanOnly] = useState(true);

  const isTypecast = engine === "typecast";
  const setOpt = (k: string, v: number) => setTtsOpts({ ...ttsOpts, [k]: v });

  const filtered = useMemo(() => voices.filter((v) =>
    // 한국어/쇼츠 필터는 Typecast에서만(다른 엔진은 해당 플래그가 비어 전체 표시)
    (!isTypecast || !koreanOnly || v.korean)
    && (gender === "all" || v.gender === gender)
    && (!isTypecast || !shortsOnly || v.shorts)
    && (!q.trim() || v.name.toLowerCase().includes(q.trim().toLowerCase()))
  ), [voices, isTypecast, koreanOnly, gender, shortsOnly, q]);

  const selected = voices.find((v) => v.voice_id === voice) || null;
  const presets = selected?.emotions?.length ? selected.emotions : ["normal", "happy", "sad", "angry"];

  // 엔진 선택 탭 — 항상 상단에 표시(키 없어도 엔진 전환 가능).
  const engineTabs = (
    <div className="flex items-center gap-1 rounded-xl bg-[var(--panel-2)] p-1 text-[12px] font-semibold">
      {ENGINES.map((e) => (
        <button
          key={e.id}
          onClick={() => setEngine(e.id)}
          title={e.hint}
          className={`flex-1 rounded-lg px-3 py-2 transition ${engine === e.id ? "bg-pink-500/15 text-pink-400 ring-1 ring-pink-500/30" : "text-slate-400 hover:bg-white/5"}`}
        >{e.label}</button>
      ))}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {/* 엔진 선택 */}
      <div className="panel rounded-2xl p-3">
        <div className="mb-2 flex items-center gap-2">
          <Mic className="h-4 w-4 text-pink-500" />
          <span className="text-sm font-semibold text-slate-100">음성 엔진</span>
          <span className="ml-auto text-[11px] text-slate-500">{ENGINES.find((e) => e.id === engine)?.hint}</span>
        </div>
        {engineTabs}
      </div>

      {/* 키 없음(보이스 못 불러옴) → 엔진별 안내 */}
      {(voicesErr || !voices.length) ? (
        <div className="panel mx-auto max-w-lg rounded-2xl p-8 text-center">
          <KeyRound className="mx-auto mb-3 h-7 w-7 text-pink-400" />
          <div className="mb-1 text-sm font-bold text-slate-100">
            {ENGINES.find((e) => e.id === engine)?.label} API 키가 필요해요
          </div>
          <p className="mb-4 text-[13px] text-slate-400">
            설정에서 <b>{ENGINES.find((e) => e.id === engine)?.label}</b> API 키를 넣으면 음성 목록이 떠요.
            엔진은 위 탭에서 바꿀 수 있어요.
          </p>
          <button onClick={onOpenSettings} className="btn-primary rounded-xl px-5 py-2.5 text-sm">
            설정에서 키 입력
          </button>
        </div>
      ) : (
        <>
          {/* 헤더 */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Mic className="h-4 w-4 text-pink-500" />
              <span className="text-sm font-semibold text-slate-100">보이스</span>
              {selected && <span className="text-[11px] text-slate-500">현재 &lsquo;{selected.name}&rsquo;</span>}
            </div>
            <span className="text-[11px] text-slate-500">{voices.length}개 보이스</span>
          </div>

          {/* 검색 + 필터 + 리스트 */}
          <div className="panel rounded-2xl p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="보이스 이름 검색"
                  className="field w-full rounded-lg py-2 pl-8 pr-3 text-sm outline-none"
                />
              </div>
              <div className="flex items-center gap-1 rounded-lg bg-[var(--panel-2)] p-1 text-[12px] font-medium">
                {([["all", "전체"], ["female", "여"], ["male", "남"]] as const).map(([g, lbl]) => (
                  <button
                    key={g}
                    onClick={() => setGender(g)}
                    className={`rounded-md px-2.5 py-1 transition ${gender === g ? "bg-pink-500/15 text-pink-400 ring-1 ring-pink-500/30" : "text-slate-400 hover:bg-white/5"}`}
                  >{lbl}</button>
                ))}
              </div>
              {isTypecast && (
                <>
                  <button
                    onClick={() => setKoreanOnly((s) => !s)}
                    className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${koreanOnly ? "bg-pink-500/15 text-pink-400 ring-1 ring-pink-500/30" : "bg-white/5 text-slate-400 ring-1 ring-[var(--line)]"}`}
                    title="한국어 배우 보이스만(이름 추정). 끄면 다국어 전체"
                  >한국어</button>
                  <button
                    onClick={() => setShortsOnly((s) => !s)}
                    className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${shortsOnly ? "bg-pink-500/15 text-pink-400 ring-1 ring-pink-500/30" : "bg-white/5 text-slate-400 ring-1 ring-[var(--line)]"}`}
                    title="쇼츠/릴스에 적합한 보이스만"
                  >쇼츠용</button>
                </>
              )}
            </div>

            <div className="thin-scroll mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {filtered.map((v) => {
                const on = v.voice_id === voice;
                const isPlaying = playing === v.voice_id;
                const isLoading = loadingVoice === v.voice_id;
                const select = () => {
                  setVoice(v.voice_id);
                  if (isTypecast && emotion !== "smart" && !v.emotions.includes(emotion)) setEmotion("smart");
                };
                // 부제: Typecast는 감정 종수, 그 외는 나이/라벨.
                const sub = isTypecast
                  ? `${v.gender === "female" ? "여성" : v.gender === "male" ? "남성" : "-"} · ${AGE_LABEL[v.age] || v.age || "-"} · 감정 ${v.emotions.length}종`
                  : [v.gender === "female" ? "여성" : v.gender === "male" ? "남성" : "", AGE_LABEL[v.age] || v.age].filter(Boolean).join(" · ") || "보이스";
                return (
                  <div
                    key={v.voice_id}
                    role="button"
                    tabIndex={0}
                    onClick={select}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } }}
                    className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${
                      on ? "border-pink-500/50 bg-pink-500/10 ring-1 ring-pink-500/30" : "border-[var(--line)] bg-[var(--panel-2)] hover:bg-white/5"
                    }`}
                  >
                    <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-full text-[11px] font-bold ${v.gender === "female" ? "bg-pink-500/15 text-pink-300" : v.gender === "male" ? "bg-blue-500/15 text-blue-300" : "bg-white/10 text-slate-300"}`}>
                      {v.name.slice(0, 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-slate-100">{v.name}</div>
                      <div className="truncate text-[10px] text-slate-500">{sub}</div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleVoice(v.voice_id); }}
                      title={isPlaying ? "미리듣기 정지" : "이 목소리 미리듣기"}
                      className={`flex min-h-[44px] min-w-[44px] flex-none items-center justify-center rounded-full transition ${
                        isPlaying || isLoading
                          ? "bg-pink-500 text-white"
                          : "bg-white/5 text-slate-300 ring-1 ring-[var(--line)] hover:bg-pink-500/20 hover:text-pink-300"
                      }`}
                    >
                      {isLoading
                        ? <Spinner className="h-3.5 w-3.5 border-white/40 border-t-white" />
                        : isPlaying
                          ? <Pause className="h-3.5 w-3.5" />
                          : <Play className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                );
              })}
              {!filtered.length && <div className="py-6 text-center text-[13px] text-slate-500">검색 결과 없음</div>}
            </div>
          </div>

          {/* 엔진별 옵션 */}
          {isTypecast && (
            <div className="panel rounded-2xl p-4">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-pink-500" />
                <span className="text-sm font-semibold text-slate-100">감정 / 톤</span>
              </div>
              <div className="mb-3 flex items-center gap-1 rounded-lg bg-[var(--panel-2)] p-1 text-[12px] font-medium">
                <button
                  onClick={() => setEmotion("smart")}
                  className={`flex-1 rounded-md px-3 py-1.5 transition ${emotion === "smart" ? "bg-pink-500/15 text-pink-400 ring-1 ring-pink-500/30" : "text-slate-400 hover:bg-white/5"}`}
                >✨ Smart (문맥 자동)</button>
                <button
                  onClick={() => setEmotion(presets.includes("happy") ? "happy" : presets[0])}
                  className={`flex-1 rounded-md px-3 py-1.5 transition ${emotion !== "smart" ? "bg-pink-500/15 text-pink-400 ring-1 ring-pink-500/30" : "text-slate-400 hover:bg-white/5"}`}
                >프리셋 지정</button>
              </div>
              {emotion !== "smart" && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {presets.map((e) => (
                      <button
                        key={e}
                        onClick={() => setEmotion(e)}
                        className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold transition ${emotion === e ? "bg-pink-500 text-white" : "bg-white/5 text-slate-300 ring-1 ring-[var(--line)] hover:bg-white/10"}`}
                      >{EMO_LABEL[e] || e}</button>
                    ))}
                  </div>
                  <label className="block text-xs font-medium text-[var(--text-mut)]">
                    강도 <span className="text-slate-100">{emotionIntensity.toFixed(1)}</span>
                    <input type="range" min={0} max={2} step={0.1} value={emotionIntensity}
                      onChange={(e) => setEmotionIntensity(+e.target.value)} className="mt-1.5 w-full accent-pink-500" />
                  </label>
                </div>
              )}
            </div>
          )}

          {engine === "elevenlabs" && (
            <div className="panel rounded-2xl p-4">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-pink-500" />
                <span className="text-sm font-semibold text-slate-100">음성 설정</span>
              </div>
              <div className="space-y-3">
                <label className="block text-xs font-medium text-[var(--text-mut)]">
                  안정성(Stability) <span className="text-slate-100">{(ttsOpts.stability ?? 0.5).toFixed(2)}</span>
                  <span className="ml-2 text-[10px] text-slate-500">낮을수록 감정 풍부 · 높을수록 일관적</span>
                  <input type="range" min={0} max={1} step={0.05} value={ttsOpts.stability ?? 0.5}
                    onChange={(e) => setOpt("stability", +e.target.value)} className="mt-1.5 w-full accent-pink-500" />
                </label>
                <label className="block text-xs font-medium text-[var(--text-mut)]">
                  유사도(Similarity) <span className="text-slate-100">{(ttsOpts.similarity ?? 0.75).toFixed(2)}</span>
                  <span className="ml-2 text-[10px] text-slate-500">원본 보이스에 가깝게</span>
                  <input type="range" min={0} max={1} step={0.05} value={ttsOpts.similarity ?? 0.75}
                    onChange={(e) => setOpt("similarity", +e.target.value)} className="mt-1.5 w-full accent-pink-500" />
                </label>
                <label className="block text-xs font-medium text-[var(--text-mut)]">
                  스타일 강조(Style) <span className="text-slate-100">{(ttsOpts.style ?? 0).toFixed(2)}</span>
                  <span className="ml-2 text-[10px] text-slate-500">0이면 가장 안정적</span>
                  <input type="range" min={0} max={1} step={0.05} value={ttsOpts.style ?? 0}
                    onChange={(e) => setOpt("style", +e.target.value)} className="mt-1.5 w-full accent-pink-500" />
                </label>
              </div>
            </div>
          )}

          {engine === "google" && (
            <div className="panel rounded-2xl p-4">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-pink-500" />
                <span className="text-sm font-semibold text-slate-100">음성 설정</span>
              </div>
              <label className="block text-xs font-medium text-[var(--text-mut)]">
                피치(Pitch) <span className="text-slate-100">{(ttsOpts.pitch ?? 0).toFixed(1)}</span>
                <span className="ml-2 text-[10px] text-slate-500">-20(낮게) ~ +20(높게)</span>
                <input type="range" min={-20} max={20} step={1} value={ttsOpts.pitch ?? 0}
                  onChange={(e) => setOpt("pitch", +e.target.value)} className="mt-1.5 w-full accent-pink-500" />
              </label>
            </div>
          )}

          {/* 말속도 + 미리듣기 */}
          <div className="panel rounded-2xl p-4">
            <label className="block text-xs font-medium text-[var(--text-mut)]">
              말속도 <span className="text-slate-100">{rate.toFixed(2)}x</span>
              {engine === "elevenlabs" && <span className="ml-2 text-[10px] text-slate-500">(ElevenLabs는 0.7~1.2로 적용)</span>}
              <input type="range" min={0.5} max={2} step={0.05} value={rate}
                onChange={(e) => setRate(+e.target.value)} className="mt-1.5 w-full accent-pink-500" />
            </label>
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={onPreviewTts}
                disabled={ttsBusy || !hasScript}
                className="btn-primary flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm disabled:opacity-40"
              >
                {ttsBusy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : <Play className="h-4 w-4" />}
                {ttsBusy ? "생성 중…" : "대본으로 미리듣기"}
              </button>
              {!hasScript && <span className="text-[11px] text-slate-500">먼저 대본을 만들어 주세요</span>}
              {estSec != null && hasScript && (
                <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-[11px] font-semibold text-blue-400 ring-1 ring-blue-500/25">
                  예상 ~{Math.round(estSec)}초
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
