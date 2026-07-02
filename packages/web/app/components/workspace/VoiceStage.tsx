"use client";

// 보이스 스테이지 — 성별 필터 + 보이스 카드 그리드 + 말하기 속도 + TTS 미리듣기.
// 로직은 전부 props 주입(useVoicePreview/previewTts는 page.tsx 쪽). 여기는 표시만.
import { Mic, Play, Pause } from "lucide-react";
import { VOICES } from "../../data/voices";
import { Spinner } from "../../ui";

export function VoiceStage(props: {
  voice: string; setVoice: (v: string) => void;
  genderFilter: "all" | "F" | "M"; setGenderFilter: (g: "all" | "F" | "M") => void;
  playing: string | null; loadingVoice: string | null;
  onToggleVoice: (name: string) => void;
  rate: number; setRate: (n: number) => void;
  onPreviewTts: () => void; ttsBusy: boolean; hasScript: boolean;
}) {
  const {
    voice, setVoice, genderFilter, setGenderFilter,
    playing, loadingVoice, onToggleVoice,
    rate, setRate, onPreviewTts, ttsBusy, hasScript,
  } = props;

  const visibleVoices = VOICES.filter((v) => genderFilter === "all" || v.gender === genderFilter);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {/* 헤더: 제목 + 성별 필터 세그먼트 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Mic className="h-4 w-4 text-pink-500" />
          <span className="text-sm font-semibold text-slate-100">보이스 선택</span>
          <span className="text-[11px] text-slate-500">현재 &lsquo;{voice}&rsquo;</span>
        </div>
        <div className="flex items-center gap-1 rounded-lg panel-2 p-1 text-[12px] font-medium">
          {([
            ["all", "전체"],
            ["F", "여"],
            ["M", "남"],
          ] as const).map(([g, lbl]) => (
            <button
              key={g}
              onClick={() => setGenderFilter(g)}
              className={`rounded-md px-3 py-1 transition ${genderFilter === g ? "bg-white/10 text-[var(--text-strong)]" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* 보이스 카드 그리드 — 선택 = brand 링, ▶ = 개별 미리듣기 */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
        {visibleVoices.map((v) => (
          <div
            key={v.name}
            onClick={() => setVoice(v.name)}
            className={`flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-sm transition ${
              voice === v.name
                ? "bg-pink-500/10 font-semibold text-[var(--text-strong)] ring-1 ring-pink-500/40"
                : "bg-white/5 text-slate-300 ring-1 ring-[var(--line)] hover:bg-white/10"
            }`}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{v.name}</span>
              <span className={`text-[10px] font-bold ${v.gender === "F" ? "text-rose-400" : "text-blue-400"}`}>
                {v.gender === "F" ? "여" : "남"}
              </span>
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleVoice(v.name);
              }}
              className={`flex h-8 w-8 flex-none items-center justify-center rounded-full transition ${
                playing === v.name ? "bg-pink-500/20 text-pink-400" : "bg-white/10 text-slate-200 hover:bg-white/20"
              }`}
              aria-label={`${v.name} 미리듣기`}
            >
              {loadingVoice === v.name ? (
                <Spinner className="h-3.5 w-3.5 border-pink-500/40 border-t-pink-500" />
              ) : playing === v.name ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        ))}
      </div>

      {/* 말하기 속도 */}
      <div className="panel-2 rounded-xl p-3">
        <div className="flex items-center justify-between text-[12px]">
          <span className="font-medium text-slate-300">말하기 속도</span>
          <span className="font-semibold text-pink-400">{rate.toFixed(1)}x</span>
        </div>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={rate}
          onChange={(e) => setRate(parseFloat(e.target.value))}
          className="mt-1.5 w-full accent-pink-500"
          aria-label="말하기 속도"
        />
      </div>

      {/* 대본 전체 TTS 미리듣기 — 오디오 플레이어는 좌측 프리뷰 아래에 뜸 */}
      <button
        onClick={onPreviewTts}
        disabled={!hasScript || ttsBusy}
        title={!hasScript ? "먼저 대본을 만들어 주세요" : undefined}
        className="btn-ghost flex w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition"
      >
        {ttsBusy && <Spinner className="h-4 w-4 border-pink-500/40 border-t-pink-500" />}
        {ttsBusy ? "음성 생성 중…" : `🔊 '${voice}' 목소리로 대본 들어보기`}
      </button>
      <p className="text-center text-[11px] text-slate-500">생성된 음성은 왼쪽 프리뷰 아래에서 재생돼요. 보이스를 바꾼 뒤 다시 누르면 새로 만들어요.</p>
    </div>
  );
}
