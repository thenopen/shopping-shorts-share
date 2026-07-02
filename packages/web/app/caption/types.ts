import type { CaptionStyle } from "./style";

// 자막 한 줄 — 시간(start/end) + 텍스트 + (줄별)스타일 override + 수동 강조.
// style=null 이면 기본 스타일(default) 사용.
// emph=null/undefined 이면 자동 강조(가격·키워드 정규식), number[] 이면 그 단어 인덱스만 강조(수동).
// 단어 하나 = 텍스트 + 절대초 타임스탬프(워드바이워드 애니용).
export type CaptionWord = { text: string; start: number; end: number };

export type CaptionLineData = {
  text: string;
  start: number;
  end: number;
  style: CaptionStyle | null;
  emph?: number[] | null;
  words?: CaptionWord[] | null;   // TTS 단어 타임스탬프. 있으면 애니 가능, 편집으로 텍스트 바뀌면 null
};
