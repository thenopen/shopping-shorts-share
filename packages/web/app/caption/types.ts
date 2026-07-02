import type { CaptionStyle } from "./style";

// 자막 한 줄 — 시간(start/end) + 텍스트 + (줄별)스타일 override.
// style=null 이면 기본 스타일(default) 사용.
export type CaptionLineData = {
  text: string;
  start: number;
  end: number;
  style: CaptionStyle | null;
};
