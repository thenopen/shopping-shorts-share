import type { CaptionStyle } from "./style";

// 자막 한 줄 — 시간(start/end) + 텍스트 + (줄별)스타일 override + 수동 강조.
// style=null 이면 기본 스타일(default) 사용.
// emph=null/undefined 이면 자동 강조(가격·키워드 정규식), number[] 이면 그 단어 인덱스만 강조(수동).
export type CaptionLineData = {
  text: string;
  start: number;
  end: number;
  style: CaptionStyle | null;
  emph?: number[] | null;
};
