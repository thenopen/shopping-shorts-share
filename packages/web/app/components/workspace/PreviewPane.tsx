"use client";

// 좌측 프리뷰 패널 — 9:16 영상(250x444) + 자막/CTA 라이브 오버레이 + 파이프라인 진행 + TTS 미리듣기.
// 오버레이는 1080px 출력 기준 스타일을 250px 프리뷰로 축소(SCALE)해 최종 룩과 동일하게 보여준다.
import { useState, type CSSProperties } from "react";
import { Film } from "lucide-react";
import { PipelineProgress } from "../PipelineProgress";
import type { JobState } from "../../lib/types";
import type { CaptionLineData } from "../../caption/types";
import { CaptionStyle, styleToCss, emphasizeNodes } from "../../caption/style";

// 실제 출력 폭 1080px → 프리뷰 폭 250px 축소 배율
const SCALE = 250 / 1080;

// 자막 세로 위치(posV) → 오버레이 배치 클래스
const POS_CLASS: Record<CaptionStyle["posV"], string> = {
  top: "top-[10%]",
  middle: "top-1/2 -translate-y-1/2",
  bottom: "bottom-[14%]",
};

export function PreviewPane(props: {
  videoUrl: string | null;       // output(완성본, 캐시버스터 포함) 우선, 없으면 nosub
  isFinal: boolean;              // true = 완성본(자막이 이미 구워짐 → 오버레이 끄기)
  captionLines: CaptionLineData[];
  captionsOn: boolean;
  defaultStyle: CaptionStyle;
  ctaOn: boolean; cta: string; ctaSize: number; ctaPos: number;  // ctaPos 0~1(세로), ctaSize px(1080폭 기준)
  ttsUrl: string;                // 대본 TTS 미리듣기 mp3 ("" 가능)
  busy: boolean;
  job: JobState | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onTime: (t: number) => void;   // video timeupdate 마다 currentTime 전달
}) {
  const {
    videoUrl, isFinal, captionLines, captionsOn, defaultStyle,
    ctaOn, cta, ctaSize, ctaPos, ttsUrl, busy, job, videoRef, onTime,
  } = props;

  // 오버레이 싱크용 현재 재생 시각(onTime과 동일 소스 — 자체 onTimeUpdate에서 갱신)
  const [t, setT] = useState(0);

  // 현재 시각이 속한 자막 줄(t ∈ [start, end)) — 완성본이면 자막이 이미 구워져 있어 오버레이 끔
  const activeLine =
    captionsOn && !isFinal && captionLines.length
      ? captionLines.find((l) => t >= l.start && t < l.end) ?? null
      : null;

  // 줄 스타일(줄별 override 우선) → 250px 프리뷰용 축소 CSS
  const renderCaption = (line: CaptionLineData) => {
    const eff = line.style ?? defaultStyle;
    const css: CSSProperties = { ...styleToCss(eff), fontSize: eff.size * SCALE };
    if (eff.outline && eff.outlineWidth > 0) css.WebkitTextStrokeWidth = `${eff.outlineWidth * 2 * SCALE}px`;
    if (eff.box) {
      css.padding = `${(eff.boxPadY ?? 6) * SCALE}px ${(eff.boxPadX ?? 16) * SCALE}px`;
      css.borderRadius = (eff.boxRadius ?? 8) * SCALE;
    }
    return (
      <div className={`pointer-events-none absolute inset-x-0 flex justify-center px-2 ${POS_CLASS[eff.posV]}`}>
        <span className="text-center" style={css}>{emphasizeNodes(line.text, eff)}</span>
      </div>
    );
  };

  return (
    <section className="flex w-full flex-col items-center overflow-y-auto border-[var(--line)] px-6 py-5 lg:w-[340px] lg:flex-none lg:border-r">
      {/* 9:16 프리뷰 박스 */}
      <div className="relative flex-none overflow-hidden rounded-2xl bg-black shadow-2xl ring-1 ring-white/10" style={{ width: 250, height: 444 }}>
        {videoUrl ? (
          <video
            key={videoUrl}
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            className="h-full w-full object-contain"
            onTimeUpdate={(e) => {
              const now = e.currentTarget.currentTime;
              setT(now);
              onTime(now);
            }}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 px-6 text-center">
            <Film className="h-8 w-8 text-slate-600" />
            <p className="text-[11px] leading-relaxed text-slate-500">소스 단계에서 링크를 분석하면 여기에 떠요</p>
          </div>
        )}

        {/* 상단 라벨 칩 */}
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <span className="rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-slate-300">
            {isFinal ? "완성본" : "자막제거본 + 자막 미리보기"}
          </span>
        </div>

        {/* 자막 라이브 오버레이(video controls와 안 겹치게 pointer-events-none) */}
        {activeLine && renderCaption(activeLine)}

        {/* CTA 오버레이 — 최종 렌더와 동일 폰트(ChosunGu)·비율 */}
        {ctaOn && !isFinal && !!cta && (
          <div className="pointer-events-none absolute inset-x-0 flex justify-center px-2" style={{ top: `${ctaPos * 100}%` }}>
            <span className="cap-s text-center font-bold text-white" style={{ fontFamily: "ChosunGu", fontSize: ctaSize * SCALE }}>
              {cta}
            </span>
          </div>
        )}
      </div>

      {/* 생성 파이프라인 진행 */}
      {busy && job?.status !== "done" && <PipelineProgress job={job} />}

      {/* 오류 배너 */}
      {job?.error && (
        <p className="mt-3 w-full rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] font-medium text-rose-400">
          오류: {job.error}
        </p>
      )}

      {/* 대본 TTS 미리듣기(보이스 단계에서 생성) */}
      {ttsUrl && (
        <div className="mt-2 w-full">
          <audio key={ttsUrl} src={ttsUrl} controls autoPlay className="w-full" />
          <p className="mt-1 text-center text-[11px] text-slate-500">보이스를 바꾼 뒤 다시 누르면 새 음성으로 들려줘요.</p>
        </div>
      )}
    </section>
  );
}
