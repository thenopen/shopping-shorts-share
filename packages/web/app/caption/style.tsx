// 자막 스타일 도메인 — 타입/기본값 + 웹 미리보기용 CSS 변환(최종 영상 룩과 동일).
// 순수 모듈(훅 없음). emphasizeNodes가 JSX를 반환하므로 .tsx.
import { CSSProperties } from "react";

// 줄 등장 효과 — 자막이 뜰 때 1회. 백엔드 ASS(\fad·\t·\move)와 웹 keyframes 동일 타이밍.
export type CaptionAnim = "none" | "fade" | "pop" | "rise";
export const ANIMS: { v: CaptionAnim; label: string }[] = [
  { v: "none", label: "없음" },
  { v: "fade", label: "페이드인" },
  { v: "pop", label: "팝인" },
  { v: "rise", label: "라이즈업" },
];

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
  posV: "top" | "middle" | "bottom";  // 자막 세로 위치(프리셋). posX/posY 있으면 무시(자유위치)
  posX: number | null;      // 자유위치 가로(0~1, 중심 앵커). null=posV 프리셋 사용
  posY: number | null;      // 자유위치 세로(0~1, 중심 앵커). null=posV 프리셋 사용
  emphasis: boolean;        // 가격·혜택 등 핵심 단어 자동 강조(색팝)
  emphasisColor: string;    // 강조 단어 색
  animate: boolean;         // 워드바이워드 애니(말할 때 단어 팝 + 강조어 색). words 타임스탬프 필요
  anim: CaptionAnim;        // 줄 등장 효과(fade/pop/rise). 구버전 저장분은 undefined → none 취급
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
  posX: null,
  posY: null,
  emphasis: true,
  emphasisColor: "#ffe600",
  animate: false,
  anim: "none",
};

// 등장 효과 → 프리뷰용 CSS 애니(keyframes는 globals.css). 재생 시 줄 바뀔 때마다 key로 재실행.
export function animCss(s: CaptionStyle): CSSProperties {
  switch (s.anim ?? "none") {
    case "fade": return { animation: "capFadeIn 180ms ease-out both" };
    case "pop": return { animation: "capPopIn 210ms cubic-bezier(0.2, 1.4, 0.4, 1) both" };
    case "rise": return { animation: "capRiseIn 180ms ease-out both" };
    default: return {};
  }
}

// 한국 릴스/쇼츠(쇼핑·커머스) 관행 프리셋 — 전체 또는 줄별로 한 번에 적용.
// 공통: 무거운 한글 디스플레이 폰트 + 두꺼운 외곽선/박스 + 키워드 색강조(무음 시청·복잡 배경 가독)
// + 등장 효과(anim)로 리듬. 폰트는 packages/core/assets/fonts 에 실제 존재하는 것만.
export type CaptionPreset = { name: string; desc: string; style: CaptionStyle };
export const PRESET_TEMPLATES: CaptionPreset[] = [
  { name: "핫딜 임팩트", desc: "쇼핑쇼츠 기본 — 굵은 흰색·노랑 강조·단어 팝",
    style: { ...DEFAULT_STYLE, font: "BlackHanSans", size: 68, outlineWidth: 6, shadow: true, shadowBlur: 4, emphasisColor: "#ffd400", posV: "middle", animate: true, anim: "pop" } },
  { name: "초특가 레드", desc: "빨간 딜 박스 — 홈쇼핑 텐션·가격 자막",
    style: { ...DEFAULT_STYLE, font: "TmonMonsori", size: 58, outline: false, box: true, boxColor: "#e5202b", boxOpacity: 0.92, boxPadX: 18, boxPadY: 8, emphasisColor: "#ffe14d", posV: "bottom", anim: "pop" } },
  { name: "옐로 프라이스", desc: "검정 박스·노랑 글씨 — 가격·혜택 고지",
    style: { ...DEFAULT_STYLE, font: "GmarketSansBold", size: 56, color: "#ffdd33", outline: false, box: true, boxColor: "#101010", boxOpacity: 0.85, boxPadX: 18, boxPadY: 8, emphasisColor: "#ffffff", posV: "bottom", anim: "rise" } },
  { name: "형광 마커", desc: "노랑 형광 박스·검정 글씨 — 포인트 정보",
    style: { ...DEFAULT_STYLE, font: "BMDOHYEON", size: 54, color: "#111111", outline: false, box: true, boxColor: "#ffe600", boxOpacity: 0.95, boxPadX: 16, boxPadY: 6, emphasisColor: "#e11d48", posV: "bottom", anim: "fade" } },
  { name: "리뷰 그린", desc: "장점 체크 — 동글 굵은 폰트·초록 강조·단어 팝",
    style: { ...DEFAULT_STYLE, font: "Cafe24Ssurround", size: 60, outlineWidth: 5, emphasisColor: "#2ee06b", posV: "bottom", animate: true, anim: "rise" } },
  { name: "귀요미 팝", desc: "팝 폰트·핑크 외곽 — 라이프스타일 꿀템",
    style: { ...DEFAULT_STYLE, font: "ONEMobilePOP", size: 58, outlineColor: "#e0447e", outlineWidth: 5, shadow: true, shadowBlur: 3, emphasisColor: "#ffe600", posV: "middle", animate: true, anim: "pop" } },
  { name: "네온 나이트", desc: "시안 글로우·마젠타 강조 — 테크·뷰티",
    style: { ...DEFAULT_STYLE, font: "Jalnan", size: 58, outlineColor: "#001318", outlineWidth: 2, glow: true, glowColor: "#00e5ff", glowSize: 8, emphasisColor: "#ff4fd8", posV: "middle", animate: true, anim: "fade" } },
  { name: "뉴스 속보바", desc: "흰 자막바·빨강 강조 — 신뢰·정보형",
    style: { ...DEFAULT_STYLE, font: "Pretendard", size: 50, color: "#111111", outline: false, box: true, boxColor: "#ffffff", boxOpacity: 0.94, boxPadX: 20, boxPadY: 8, emphasisColor: "#d31e2e", posV: "bottom", anim: "rise" } },
  { name: "클린 프리미엄", desc: "미니멀 화이트·골드 강조 — 담백한 소개",
    style: { ...DEFAULT_STYLE, font: "SUIT", size: 52, outlineWidth: 2, shadow: true, shadowBlur: 6, emphasisColor: "#ffc94d", posV: "bottom", anim: "fade" } },
  { name: "럭셔리 명조", desc: "세리프·아이보리 — 명품·고급 리뷰",
    style: { ...DEFAULT_STYLE, font: "MaruBuriOTF", size: 54, color: "#f7eede", outlineColor: "#1a1206", outlineWidth: 3, shadow: true, shadowBlur: 5, emphasisColor: "#e8b84b", posV: "bottom", anim: "fade" } },
];

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

// 1080px 출력 기준 스타일 → scale 배율로 축소한 CSS(프리뷰용).
// 크기·외곽선·박스 패딩까지 함께 줄여 '최종 영상에서의 비율' 그대로 보이게.
export function styleToCssScaled(s: CaptionStyle, scale: number): CSSProperties {
  const css: CSSProperties = { ...styleToCss(s), fontSize: s.size * scale };
  if (s.outline && s.outlineWidth > 0) css.WebkitTextStrokeWidth = `${s.outlineWidth * 2 * scale}px`;
  if (s.box) {
    css.padding = `${(s.boxPadY ?? 6) * scale}px ${(s.boxPadX ?? 16) * scale}px`;
    css.borderRadius = (s.boxRadius ?? 8) * scale;
  }
  return css;
}
