"use client";

import { CSSProperties, useEffect, useState } from "react";
import { FONTS } from "./fonts";

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
};

const STORAGE_KEY = "caption_templates";

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

// 자막 텍스트의 핵심 단어를 강조색으로 칠한 React 노드(웹 미리보기용 — 최종 영상과 동일 룩).
export function emphasizeNodes(text: string, s: CaptionStyle): React.ReactNode {
  if (!s.emphasis || !text) return text;
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

export default function CaptionEditor({
  value,
  onChange,
}: {
  value: CaptionStyle;
  onChange: (s: CaptionStyle) => void;
}) {
  const [text, setText] = useState("");
  const [templates, setTemplates] = useState<Record<string, CaptionStyle>>({});
  const [tplName, setTplName] = useState("");
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [previewBg, setPreviewBg] = useState<"none" | "mid" | "light" | "dark">("none");

  // none=투명(글래스 카드에 자막만), mid=중간회색, light=밝게, dark=어둡게
  const transparent = previewBg === "none";
  const bgBase = previewBg === "light" ? "rgba(235,238,242,0.96)" : previewBg === "dark" ? "rgba(28,30,36,0.96)" : "rgba(105,112,128,0.92)";
  const bgBase2 = previewBg === "light" ? "rgba(205,210,220,0.96)" : previewBg === "dark" ? "rgba(12,14,18,0.96)" : "rgba(78,84,98,0.92)";
  const checker = previewBg === "light" ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.12)";

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setTemplates(JSON.parse(raw));
    } catch {}
  }, []);

  function set<K extends keyof CaptionStyle>(k: K, v: CaptionStyle[K]) {
    onChange({ ...value, [k]: v });
  }

  function persist(next: Record<string, CaptionStyle>) {
    setTemplates(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function confirmSaveTemplate() {
    const name = tplName.trim();
    if (!name) return;
    if (templates[name] && !window.confirm(`'${name}' 템플릿을 덮어쓸까요?`)) return;
    persist({ ...templates, [name]: value });
    setTplName("");
    setSaveModalOpen(false);
  }

  function loadTemplate(name: string) {
    if (templates[name]) onChange(templates[name]);
  }

  function deleteTemplate(name: string) {
    const next = { ...templates };
    delete next[name];
    persist(next);
  }

  return (
    <div className="glass rounded-[28px] p-7 sm:p-8">
      <div className="mb-4 text-sm font-bold text-[var(--ink)]">자막 스타일 편집</div>

      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Text를 입력하세요."
        className="mb-4 w-full rounded-2xl border border-white/50 bg-white/75 px-4 py-2.5 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-soft)]/60 focus:bg-white/90 focus:ring-2 focus:ring-[var(--accent)]/30"
      />

      {/* 미리보기 배경: 투명(글래스) 기본. 토글로 영상톤(중간/밝게/어둡게) 확인 */}
      <div
        className={`mb-3 flex min-h-40 items-center justify-center overflow-hidden rounded-2xl p-6 ${transparent ? "border border-dashed border-white/60 bg-white/30" : ""}`}
        style={transparent ? undefined : {
          backgroundImage:
            `linear-gradient(135deg, ${bgBase}, ${bgBase2}), ` +
            `linear-gradient(45deg, ${checker} 25%, transparent 25%, transparent 75%, ${checker} 75%), ` +
            `linear-gradient(45deg, ${checker} 25%, transparent 25%, transparent 75%, ${checker} 75%)`,
          backgroundSize: "100% 100%, 24px 24px, 24px 24px",
          backgroundPosition: "0 0, 0 0, 12px 12px",
        }}
      >
        <span style={styleToCss(value)}>{text ? emphasizeNodes(text, value) : "미리보기"}</span>
      </div>
      {/* 배경 토글 — 투명(기본) + 영상톤별로 자막 가독성 확인 */}
      <div className="mb-5 flex gap-2">
        <button
          onClick={() => setPreviewBg("none")}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${previewBg === "none" ? "btn-grad" : "bg-white/60 text-[var(--ink-soft)] hover:bg-white/80"}`}
        >투명</button>
        <button
          onClick={() => setPreviewBg("mid")}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${previewBg === "mid" ? "btn-grad" : "bg-white/60 text-[var(--ink-soft)] hover:bg-white/80"}`}
        >중간</button>
        <button
          onClick={() => setPreviewBg("light")}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${previewBg === "light" ? "btn-grad" : "bg-white/60 text-[var(--ink-soft)] hover:bg-white/80"}`}
        >밝게</button>
        <button
          onClick={() => setPreviewBg("dark")}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${previewBg === "dark" ? "btn-grad" : "bg-white/60 text-[var(--ink-soft)] hover:bg-white/80"}`}
        >어둡게</button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Row label="폰트">
          <select
            value={value.font}
            onChange={(e) => set("font", e.target.value)}
            className="w-full rounded-xl border border-white/50 bg-white/70 px-2 py-1.5 text-sm text-[var(--ink)] outline-none"
            style={{ fontFamily: value.font }}
          >
            {FONTS.map((f) => (
              <option key={f.css} value={f.css} style={{ fontFamily: f.css }}>
                {f.label}
              </option>
            ))}
          </select>
        </Row>

        <Row label={`크기 ${value.size}px`}>
          <input
            type="range"
            min={16}
            max={120}
            value={value.size}
            onChange={(e) => set("size", +e.target.value)}
            className="w-full accent-[var(--accent-deep)]"
          />
        </Row>

        <Row label="스타일">
          <div className="flex flex-wrap gap-1.5 sm:flex-nowrap">
            <Toggle on={value.bold} onClick={() => set("bold", !value.bold)} label="굵게" />
            <Toggle on={value.italic} onClick={() => set("italic", !value.italic)} label="기울임" />
            <Toggle on={value.outline} onClick={() => set("outline", !value.outline)} label="외곽선" />
            <Toggle on={value.shadow} onClick={() => set("shadow", !value.shadow)} label="그림자" />
            <Toggle on={value.glow} onClick={() => set("glow", !value.glow)} label="글로우" />
            <Toggle on={value.box} onClick={() => set("box", !value.box)} label="박스" />
            <Toggle on={value.emphasis} onClick={() => set("emphasis", !value.emphasis)} label="핵심강조" />
          </div>
        </Row>

        <Row label="글자색">
          <ColorInput value={value.color} onChange={(v) => set("color", v)} />
        </Row>

        {value.outline && (
          <>
            <Row label="외곽선 색">
              <ColorInput value={value.outlineColor} onChange={(v) => set("outlineColor", v)} />
            </Row>
            <Row label={`외곽선 두께 ${value.outlineWidth}`}>
              <input type="range" min={1} max={8} value={value.outlineWidth} onChange={(e) => set("outlineWidth", +e.target.value)} className="w-full accent-[var(--accent-deep)]" />
            </Row>
          </>
        )}

        {value.shadow && (
          <>
            <Row label="그림자 색">
              <ColorInput value={value.shadowColor} onChange={(v) => set("shadowColor", v)} />
            </Row>
            <Row label={`그림자 흐림 ${value.shadowBlur}`}>
              <input type="range" min={0} max={20} value={value.shadowBlur} onChange={(e) => set("shadowBlur", +e.target.value)} className="w-full accent-[var(--accent-deep)]" />
            </Row>
          </>
        )}

        {value.glow && (
          <>
            <Row label="글로우 색">
              <ColorInput value={value.glowColor} onChange={(v) => set("glowColor", v)} />
            </Row>
            <Row label={`글로우 크기 ${value.glowSize}`}>
              <input type="range" min={2} max={30} value={value.glowSize} onChange={(e) => set("glowSize", +e.target.value)} className="w-full accent-[var(--accent-deep)]" />
            </Row>
          </>
        )}

        {value.emphasis && (
          <Row label="핵심강조 색 (가격·할인·혜택 자동)">
            <ColorInput value={value.emphasisColor} onChange={(v) => set("emphasisColor", v)} />
          </Row>
        )}

        {value.box && (
          <>
            <Row label="박스 색">
              <ColorInput value={value.boxColor} onChange={(v) => set("boxColor", v)} />
            </Row>
            <Row label={`박스 투명도 ${Math.round(value.boxOpacity * 100)}%`}>
              <input type="range" min={0} max={1} step={0.05} value={value.boxOpacity} onChange={(e) => set("boxOpacity", +e.target.value)} className="w-full accent-[var(--accent-deep)]" />
            </Row>
            <Row label={`박스 좌우 여백 ${value.boxPadX}px`}>
              <input type="range" min={0} max={48} value={value.boxPadX} onChange={(e) => set("boxPadX", +e.target.value)} className="w-full accent-[var(--accent-deep)]" />
            </Row>
            <Row label={`박스 상하 여백 ${value.boxPadY}px`}>
              <input type="range" min={0} max={48} value={value.boxPadY} onChange={(e) => set("boxPadY", +e.target.value)} className="w-full accent-[var(--accent-deep)]" />
            </Row>
            <Row label={`박스 둥글기 ${value.boxRadius}px · 미리보기 전용(영상 미반영)`}>
              <input
                type="range"
                min={0}
                max={40}
                value={value.boxRadius}
                disabled
                title="libass(최종 영상 자막)는 둥근 모서리를 지원하지 않아 결과 영상엔 반영되지 않습니다. 웹 미리보기 전용입니다."
                onChange={(e) => set("boxRadius", +e.target.value)}
                className="w-full cursor-not-allowed accent-[var(--accent-deep)] opacity-40"
              />
            </Row>
          </>
        )}
      </div>

      <div className="mt-6 border-t border-white/40 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-bold text-[var(--ink-soft)]">
            스타일 템플릿 {Object.keys(templates).length > 0 && <span className="opacity-60">({Object.keys(templates).length})</span>}
          </div>
          <button
            onClick={() => { setTplName(""); setSaveModalOpen(true); }}
            className="btn-grad rounded-full px-4 py-2 text-xs font-bold transition"
          >
            + 현재 스타일 저장
          </button>
        </div>

        {Object.keys(templates).length === 0 ? (
          <p className="rounded-2xl bg-white/40 px-3 py-4 text-center text-xs text-[var(--ink-soft)] backdrop-blur">
            저장된 템플릿이 없습니다. 스타일을 만든 뒤 저장하세요.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Object.entries(templates).map(([name, st]) => (
              <div key={name} className="group flex items-center gap-2 overflow-hidden rounded-2xl border border-white/50 bg-white/55 p-2 backdrop-blur">
                <div
                  className="flex h-12 w-20 flex-none items-center justify-center overflow-hidden rounded-xl"
                  style={{ background: "#6a7180" }}
                  title="미리보기"
                >
                  <span style={{ ...styleToCss(st), fontSize: Math.min(16, st.size / 3) }}>가나다</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-[var(--ink)]">{name}</div>
                  <div className="truncate text-[11px] text-[var(--ink-soft)]">{st.font} · {st.size}px</div>
                </div>
                <div className="flex flex-none gap-1">
                  <button onClick={() => loadTemplate(name)} className="rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-[var(--accent-deep)] transition hover:bg-white">
                    적용
                  </button>
                  <button onClick={() => { if (window.confirm(`'${name}' 템플릿을 삭제할까요?`)) deleteTemplate(name); }} className="rounded-full px-2 py-1 text-xs text-[var(--ink-soft)] transition hover:bg-rose-100/70 hover:text-rose-500">
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 템플릿 이름 저장 모달 */}
      {saveModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSaveModalOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-[24px] glass p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 text-base font-bold text-[var(--ink)]">템플릿 저장</div>
            <p className="mb-4 text-xs text-[var(--ink-soft)]">현재 자막 스타일을 이름 붙여 저장합니다.</p>
            <div className="mb-4 flex items-center justify-center rounded-xl p-4" style={{ background: "#6a7180" }}>
              <span style={styleToCss(value)}>{text ? emphasizeNodes(text, value) : "미리보기"}</span>
            </div>
            <input
              autoFocus
              value={tplName}
              onChange={(e) => setTplName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmSaveTemplate(); if (e.key === "Escape") setSaveModalOpen(false); }}
              placeholder="템플릿 이름 (예: 굵은 노랑 강조)"
              className="mb-4 w-full rounded-xl border border-white/50 bg-white/80 px-3 py-2.5 text-sm text-[var(--ink)] outline-none focus:bg-white focus:ring-2 focus:ring-[var(--accent)]/30"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setSaveModalOpen(false)} className="rounded-full bg-white/60 px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:bg-white/90">
                취소
              </button>
              <button onClick={confirmSaveTemplate} disabled={!tplName.trim()} className="btn-grad rounded-full px-6 py-2 text-sm font-bold transition">
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/50 bg-white/40 p-3.5 backdrop-blur">
      <div className="mb-1.5 text-xs font-bold text-[var(--ink-soft)]">{label}</div>
      {children}
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold transition ${on ? "btn-grad" : "bg-white/60 text-[var(--ink-soft)] hover:bg-white/80"}`}>
      {label}
    </button>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 cursor-pointer rounded-lg border border-white/60" />
      <span className="text-xs text-[var(--ink-soft)]">{value}</span>
    </div>
  );
}
