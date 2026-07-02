// 자막 스타일 도메인 — 타입/기본값 + 웹 미리보기용 CSS 변환(최종 영상 룩과 동일).
// 순수 모듈(훅 없음). emphasizeNodes가 JSX를 반환하므로 .tsx.
import { CSSProperties } from "react";

export type CaptionStyle = {
  font: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  outline: boolean;
  outlineColor: string;
  outlineWidth: number;
  shadow: boolean;
  shadowColor: string;
  shadowBlur: number;
  glow: boolean;
  glowColor: string;
  glowSize: number;
  box: boolean;
  boxColor: string;
  boxOpacity: number;
  boxPadX: number;
  boxPadY: number;
  boxRadius: number;
  posV: "top" | "middle" | "bottom";  // 자막 세로 위치
  emphasis: boolean;        // 가격·혜택 등 핵심 단어 자동 강조(색팝)
  emphasisColor: string;    // 강조 단어 색
  animate: boolean;         // 워드바이워드 애니(말할 때 단어 팝 + 강조어 색). words 타임스탬프 필요
};

export const DEFAULT_STYLE: CaptionStyle = {
  font: "Pretendard",
  size: 48,
  color: "#ffffff",
  bold: true,
  italic: false,
  outline: true,
  outlineColor: "#000000",
  outlineWidth: 3,
  shadow: false,
  shadowColor: "#000000",
  shadowBlur: 4,
  glow: false,
  glowColor: "#ffe600",
  glowSize: 8,
  box: false,
  boxColor: "#000000",
  boxOpacity: 0.5,
  boxPadX: 16,
  boxPadY: 6,
  boxRadius: 8,
  posV: "bottom",
  emphasis: true,
  emphasisColor: "#ffe600",
  animate: false,
};

// 핵심 강조 키워드(가격/숫자는 정규식이 따로 잡음) — 백엔드 caption.py와 동일 셋.
const EMPH_KEYWORDS = [
  "무료배송", "무료", "최저가", "최저", "최대", "역대급", "초특가", "특가",
  "반값", "할인", "세일", "증정", "사은품", "한정", "단독", "오늘만",
  "마지막", "품절임박", "품절", "1+1", "원플원", "공짜", "득템", "꿀템",
];
const EMPH_RE = new RegExp(
  "(\\d[\\d,]*(?:\\.\\d+)?\\s*(?:%|％|원|만원|천원|개|배|초|분|시간|일|주|개월|년|ml|g|kg|cm|호)?)" +
    "|(" + EMPH_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")",
  "g"
);

// 공백 기준 단어 분할 — 수동 강조 토글의 단위.
export function splitWords(text: string): string[] {
  return (text || "").split(/\s+/).filter(Boolean);
}

// 자동 강조(정규식) 대상 단어 인덱스 — 수동 조정의 시작점(사용자가 칩 누르면 이 셋에서 가감).
export function autoEmphIndices(text: string): number[] {
  const words = splitWords(text);
  const out: number[] = [];
  words.forEach((w, i) => { EMPH_RE.lastIndex = 0; if (EMPH_RE.test(w)) out.push(i); });
  return out;
}

// 자막 텍스트의 핵심 단어를 강조색으로 칠한 React 노드(웹 미리보기용 — 최종 영상과 동일 룩).
// emph 지정(number[])이면 그 단어 인덱스만 강조(수동), null/undefined면 자동(정규식 span).
export function emphasizeNodes(text: string, s: CaptionStyle, emph?: number[] | null): React.ReactNode {
  if (!s.emphasis || !text) return text;
  if (emph != null) {
    const words = splitWords(text);
    const set = new Set(emph);
    return words.map((w, i) => (
      <span key={i}>
        {i > 0 ? " " : ""}
        {set.has(i)
          ? <span style={{ color: s.emphasisColor, fontWeight: 900, fontSize: "1.12em" }}>{w}</span>
          : w}
      </span>
    ));
  }
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  EMPH_RE.lastIndex = 0;
  while ((m = EMPH_RE.exec(text)) !== null) {
    if (!m[0]) { EMPH_RE.lastIndex++; continue; }
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={`${m.index}-${m[0]}`} style={{ color: s.emphasisColor, fontWeight: 900, fontSize: "1.12em" }}>
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function hexToRgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function styleToCss(s: CaptionStyle): CSSProperties {
  const shadows: string[] = [];
  if (s.shadow) shadows.push(`2px 2px ${s.shadowBlur}px ${s.shadowColor}`);
  if (s.glow) {
    for (let i = 0; i < 3; i++) shadows.push(`0 0 ${s.glowSize}px ${s.glowColor}`);
  }

  const css: CSSProperties = {
    fontFamily: s.font,
    fontSize: s.size,
    color: s.color,
    fontWeight: s.bold ? 800 : 400,
    fontStyle: s.italic ? "italic" : "normal",
    textShadow: shadows.length ? shadows.join(", ") : undefined,
    background: s.box ? hexToRgba(s.boxColor, s.boxOpacity) : undefined,
    padding: s.box ? `${s.boxPadY ?? 6}px ${s.boxPadX ?? 16}px` : undefined,
    borderRadius: s.box ? (s.boxRadius ?? 8) : undefined,
    lineHeight: 1.3,
    display: "inline-block",
  };

  // 외곽선: stroke를 글자 fill '아래'에 깔아 깨끗한 바깥선으로 (8방향 그림자 떡짐 방지)
  if (s.outline && s.outlineWidth > 0) {
    css.WebkitTextStrokeWidth = `${s.outlineWidth * 2}px`;
    css.WebkitTextStrokeColor = s.outlineColor;
    css.paintOrder = "stroke fill";
  }

  return css;
}
