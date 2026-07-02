// 워크스페이스 스테이지 모델 — 상단 칩 내비게이션 + 중앙 패널 전환.
export type StageKey = "source" | "script" | "voice" | "caption" | "render";

export const STAGES: { key: StageKey; label: string }[] = [
  { key: "source", label: "소스" },
  { key: "script", label: "대본" },
  { key: "voice", label: "보이스" },
  { key: "caption", label: "자막" },
  { key: "render", label: "렌더" },
];
