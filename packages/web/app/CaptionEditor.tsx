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
};

const STORAGE_KEY = "caption_templates";

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
  if (s.outline) {
    const w = s.outlineWidth;
    [
      [-w, -w],
      [w, -w],
      [-w, w],
      [w, w],
      [0, -w],
      [0, w],
      [-w, 0],
      [w, 0],
    ].forEach(([x, y]) => shadows.push(`${x}px ${y}px 0 ${s.outlineColor}`));
  }

  return {
    fontFamily: s.font,
    fontSize: s.size,
    color: s.color,
    fontWeight: s.bold ? 800 : 400,
    fontStyle: s.italic ? "italic" : "normal",
    textShadow: shadows.length ? shadows.join(", ") : undefined,
    WebkitTextStroke: s.outline ? `0.5px ${s.outlineColor}` : undefined,
    background: s.box ? hexToRgba(s.boxColor, s.boxOpacity) : undefined,
    padding: s.box ? "6px 16px" : undefined,
    borderRadius: s.box ? 8 : undefined,
    lineHeight: 1.3,
    display: "inline-block",
  };
}

export default function CaptionEditor({
  value,
  onChange,
}: {
  value: CaptionStyle;
  onChange: (s: CaptionStyle) => void;
}) {
  const [text, setText] = useState("이 제품 진짜 괜찮아요");
  const [templates, setTemplates] = useState<Record<string, CaptionStyle>>({});
  const [tplName, setTplName] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setTemplates(JSON.parse(raw));
    } catch {}
  }, []);

  function set<K extends keyof CaptionStyle>(k: K, v: CaptionStyle[K]) {
    onChange({ ...value, [k]: v });
  }

  function saveTemplate() {
    if (!tplName.trim()) return;
    const next = { ...templates, [tplName.trim()]: value };
    setTemplates(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setTplName("");
  }

  function loadTemplate(name: string) {
    if (templates[name]) onChange(templates[name]);
  }

  function deleteTemplate(name: string) {
    const next = { ...templates };
    delete next[name];
    setTemplates(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 text-sm font-bold text-slate-700">자막 스타일 편집</div>

      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="문구 입력"
        className="mb-4 w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-indigo-400"
      />

      <div className="mb-5 flex min-h-40 items-center justify-center overflow-hidden rounded-lg bg-zinc-900 p-6">
        <span style={styleToCss(value)}>{text || "미리보기"}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Row label="폰트">
          <select
            value={value.font}
            onChange={(e) => set("font", e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
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
            className="w-full"
          />
        </Row>

        <Row label="스타일">
          <div className="flex flex-wrap gap-1.5">
            <Toggle on={value.bold} onClick={() => set("bold", !value.bold)} label="굵게" />
            <Toggle on={value.italic} onClick={() => set("italic", !value.italic)} label="기울임" />
            <Toggle on={value.outline} onClick={() => set("outline", !value.outline)} label="외곽선" />
            <Toggle on={value.shadow} onClick={() => set("shadow", !value.shadow)} label="그림자" />
            <Toggle on={value.glow} onClick={() => set("glow", !value.glow)} label="글로우" />
            <Toggle on={value.box} onClick={() => set("box", !value.box)} label="박스" />
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
              <input type="range" min={1} max={8} value={value.outlineWidth} onChange={(e) => set("outlineWidth", +e.target.value)} className="w-full" />
            </Row>
          </>
        )}

        {value.shadow && (
          <>
            <Row label="그림자 색">
              <ColorInput value={value.shadowColor} onChange={(v) => set("shadowColor", v)} />
            </Row>
            <Row label={`그림자 흐림 ${value.shadowBlur}`}>
              <input type="range" min={0} max={20} value={value.shadowBlur} onChange={(e) => set("shadowBlur", +e.target.value)} className="w-full" />
            </Row>
          </>
        )}

        {value.glow && (
          <>
            <Row label="글로우 색">
              <ColorInput value={value.glowColor} onChange={(v) => set("glowColor", v)} />
            </Row>
            <Row label={`글로우 크기 ${value.glowSize}`}>
              <input type="range" min={2} max={30} value={value.glowSize} onChange={(e) => set("glowSize", +e.target.value)} className="w-full" />
            </Row>
          </>
        )}

        {value.box && (
          <>
            <Row label="박스 색">
              <ColorInput value={value.boxColor} onChange={(v) => set("boxColor", v)} />
            </Row>
            <Row label={`박스 투명도 ${Math.round(value.boxOpacity * 100)}%`}>
              <input type="range" min={0} max={1} step={0.05} value={value.boxOpacity} onChange={(e) => set("boxOpacity", +e.target.value)} className="w-full" />
            </Row>
          </>
        )}
      </div>

      <div className="mt-6 border-t border-slate-100 pt-4">
        <div className="mb-2 text-xs font-bold text-slate-500">스타일 템플릿</div>
        <div className="flex gap-2">
          <input
            value={tplName}
            onChange={(e) => setTplName(e.target.value)}
            placeholder="템플릿 이름"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <button onClick={saveTemplate} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            저장
          </button>
        </div>
        {Object.keys(templates).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.keys(templates).map((name) => (
              <div key={name} className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-xs">
                <button onClick={() => loadTemplate(name)} className="font-medium hover:text-indigo-600">
                  {name}
                </button>
                <button onClick={() => deleteTemplate(name)} className="flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-500">
                  x
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
      <div className="mb-1.5 text-xs font-semibold text-slate-500">{label}</div>
      {children}
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={`rounded-md px-2.5 py-1 text-xs font-medium ${on ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-500"}`}>
      {label}
    </button>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-slate-200" />
      <span className="text-xs text-slate-400">{value}</span>
    </div>
  );
}
