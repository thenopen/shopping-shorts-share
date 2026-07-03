"use client";

import { memo, useEffect, useRef, useState } from "react";
import { apiDirect } from "./lib/api";
import { FONTS } from "./data/fonts";
import { CaptionStyle, styleToCss, styleToCssScaled, emphasizeNodes, animCss, ANIMS, PRESET_TEMPLATES } from "./caption/style";
import { displayLines } from "./caption/linebreak";
import { Toggle } from "./components/ui/Toggle";

const STORAGE_KEY = "caption_templates";

// 1080px 출력 기준 스타일을 '컨테이너 폭 = 영상 폭'으로 축소해 그리는 미리보기 텍스트.
// 82px 같은 출력값을 그대로 뿌리면 패널에서 실제 영상 비율보다 훨씬 크게 보이는 문제 방지.
function ScaledPreview({ s, text }: { s: CaptionStyle; text: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(Math.max(0.1, el.clientWidth / 1080));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="flex w-full justify-center">
      <span key={s.anim ?? "none"} className="text-center" style={{ ...styleToCssScaled(s, scale), ...animCss(s) }}>
        {text
          ? displayLines(text).map((sg, i) => (
              <span key={i} className="block">{emphasizeNodes(sg.text, s, sg.emph)}</span>
            ))
          : "미리보기"}
      </span>
    </div>
  );
}

// React.memo — value(captionStyle)/onChange(안정 setter) 동일하면 리렌더 skip.
// 링크·대본 등 부모 상태 타이핑 시 이 무거운 편집기(539 폰트 option) 재조정 방지.
function CaptionEditor({
  value,
  onChange,
  scope = "all",
  scopeLabel,
}: {
  value: CaptionStyle;
  onChange: (s: CaptionStyle) => void;
  scope?: "all" | "selected";
  scopeLabel?: string;
}) {
  const [text, setText] = useState("");
  const [templates, setTemplates] = useState<Record<string, CaptionStyle>>({});
  const [tplName, setTplName] = useState("");
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [previewBg, setPreviewBg] = useState<"none" | "mid" | "light" | "dark">("none");

  // none=투명(패널 카드에 자막만), mid=중간회색, light=밝게, dark=어둡게
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

  const [mogrtBusy, setMogrtBusy] = useState(false);
  // Premiere .mogrt 부분 임포트(베타) — 정적 스타일(폰트/크기/색 추정)만. 애니·도형 미지원.
  async function importMogrt(files: FileList | null) {
    const f = files?.[0];
    if (!f || mogrtBusy) return;
    setMogrtBusy(true);
    try {
      // raw 바이너리 업로드 — base64/JSON은 수십 MB에서 dev 프록시가 막힘.
      const resp = await fetch(`${apiDirect()}/captions/import-mogrt`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: f,
      });
      if (!resp.ok) {
        const t = await resp.text();
        alert(`가져오기 실패: ${t.slice(0, 160)}`);
        return;
      }
      const j: { name: string; styles: Partial<CaptionStyle>[]; warnings: string[] } = await resp.json();
      if (!j.styles?.length) { alert("이 템플릿에서 가져올 텍스트 스타일이 없어요."); return; }
      const s0 = j.styles[0];
      const style: CaptionStyle = {
        ...value,
        font: s0.font ?? value.font,
        size: s0.size ?? value.size,
        bold: s0.bold ?? value.bold,
        italic: s0.italic ?? value.italic,
        ...(s0.box ? { box: true, boxColor: s0.boxColor ?? "#000000", boxOpacity: 1, outline: false } : {}),
        ...(s0.color ? { color: s0.color } : {}),
      };
      const name = (j.name || f.name.replace(/\.mogrt$/i, "")).slice(0, 40);
      persist({ ...templates, [name]: style });
      onChange(style);
      alert(`'${name}' 저장·적용 완료.\n\n${(j.warnings || []).join("\n")}`);
    } catch (e) {
      alert(`가져오기 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setMogrtBusy(false);
    }
  }

  return (
    <div className="panel rounded-2xl p-7 sm:p-8">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-sm font-bold text-slate-100">자막 스타일</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${scope === "selected" ? "bg-amber-400/15 text-amber-300 ring-amber-400/30" : "bg-pink-500/15 text-pink-400 ring-pink-500/30"}`}>
          {scope === "selected" ? `선택 자막 · ${scopeLabel}` : "전체 자막 적용"}
        </span>
      </div>
      <p className="mb-4 text-[11px] text-slate-500">
        {scope === "selected"
          ? <><b className="text-slate-400">이 줄만</b> 바뀌어요(잠금됨). 전체로 돌아가려면 위 <b className="text-slate-400">전체 자막</b> 탭.</>
          : <><b className="text-slate-400">모든 자막 줄</b>에 적용돼요(잠긴 줄 제외). 특정 줄만 바꾸려면 가운데 목록에서 줄을 <b className="text-slate-400">클릭</b>.</>}
      </p>

      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="미리보기용 예시 문구 (영상에는 안 들어가요)"
        className="field mb-4 w-full rounded-xl px-4 py-2.5 text-sm outline-none transition"
      />

      {/* 미리보기 배경: 투명(panel-2 점선) 기본. 토글로 영상톤(중간/밝게/어둡게) 확인 */}
      <div
        className={`mb-3 flex min-h-40 items-center justify-center overflow-hidden rounded-2xl p-6 ${transparent ? "border border-dashed border-white/15 bg-[var(--panel-2)]" : ""}`}
        style={transparent ? undefined : {
          backgroundImage:
            `linear-gradient(135deg, ${bgBase}, ${bgBase2}), ` +
            `linear-gradient(45deg, ${checker} 25%, transparent 25%, transparent 75%, ${checker} 75%), ` +
            `linear-gradient(45deg, ${checker} 25%, transparent 25%, transparent 75%, ${checker} 75%)`,
          backgroundSize: "100% 100%, 24px 24px, 24px 24px",
          backgroundPosition: "0 0, 0 0, 12px 12px",
        }}
      >
        <ScaledPreview s={value} text={text} />
      </div>
      {/* 배경 토글 — 투명(기본) + 영상톤별로 자막 가독성 확인 */}
      <div className="mb-5 flex gap-2">
        {([["none", "투명"], ["mid", "중간"], ["light", "밝게"], ["dark", "어둡게"]] as const).map(([v, lbl]) => (
          <button
            key={v}
            onClick={() => setPreviewBg(v)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${previewBg === v ? "bg-pink-500/15 text-pink-400 ring-1 ring-pink-500/30" : "bg-white/5 text-slate-400 ring-1 ring-[var(--line)] hover:bg-white/10"}`}
          >{lbl}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Row label="폰트">
          <select
            value={value.font}
            onChange={(e) => set("font", e.target.value)}
            className="field w-full rounded-lg px-2 py-1.5 text-sm outline-none"
            style={{ fontFamily: value.font }}
          >
            {FONTS.map((f) => (
              <option key={f.css} value={f.css} style={{ fontFamily: f.css }}>
                {f.label}
              </option>
            ))}
          </select>
        </Row>

        <Row label={`크기 ${value.size}px (1080px 폭 기준)`}>
          <input
            type="range"
            min={16}
            max={200}
            value={value.size}
            onChange={(e) => set("size", +e.target.value)}
            className="w-full accent-pink-500"
          />
        </Row>

        <Row label="스타일">
          {/* flex-wrap 유지(sm:flex-nowrap 제거) — 좁은 칸(비율 조정 등)에서 버튼이
              옆 칸(글자색) 침범하지 않게 항상 줄바꿈. */}
          <div className="flex flex-wrap gap-1.5">
            <Toggle dense on={value.bold} onClick={() => set("bold", !value.bold)} label="굵게" />
            <Toggle dense on={value.italic} onClick={() => set("italic", !value.italic)} label="기울임" />
            <Toggle dense on={value.outline} onClick={() => set("outline", !value.outline)} label="외곽선" />
            <Toggle dense on={value.shadow} onClick={() => set("shadow", !value.shadow)} label="그림자" />
            <Toggle dense on={value.glow} onClick={() => set("glow", !value.glow)} label="글로우" />
            <Toggle dense on={value.box} onClick={() => set("box", !value.box)} label="박스" />
            <Toggle dense on={value.emphasis} onClick={() => set("emphasis", !value.emphasis)} label="핵심강조" />
            <Toggle dense on={value.animate} onClick={() => set("animate", !value.animate)} label="✨애니(단어 팝)" />
          </div>
        </Row>

        <Row label="등장 효과 (줄이 뜰 때 1회)">
          <div className="flex flex-wrap gap-1.5">
            {ANIMS.map((a) => (
              <Toggle key={a.v} dense on={(value.anim ?? "none") === a.v} onClick={() => set("anim", a.v)} label={a.label} />
            ))}
          </div>
        </Row>

        <Row label="위치">
          <div className="flex flex-wrap items-center gap-1.5">
            {([["top", "위"], ["middle", "중간"], ["bottom", "아래"]] as const).map(([v, lbl]) => (
              <Toggle
                key={v}
                on={value.posX == null && (value.posV ?? "bottom") === v}
                onClick={() => onChange({ ...value, posV: v, posX: null, posY: null })}
                label={lbl}
              />
            ))}
            {value.posX != null && (
              <span className="rounded-full bg-pink-500/15 px-2 py-0.5 text-[10px] font-semibold text-pink-400 ring-1 ring-pink-500/30">
                자유위치 {Math.round((value.posX ?? 0) * 100)},{Math.round((value.posY ?? 0) * 100)}
              </span>
            )}
          </div>
          <p className="mt-1 text-[10px] text-slate-500">또는 왼쪽 프리뷰에서 자막을 <b className="text-slate-400">드래그</b>해 자유 배치</p>
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
              <input type="range" min={1} max={8} value={value.outlineWidth} onChange={(e) => set("outlineWidth", +e.target.value)} className="w-full accent-pink-500" />
            </Row>
          </>
        )}

        {value.shadow && (
          <>
            <Row label="그림자 색">
              <ColorInput value={value.shadowColor} onChange={(v) => set("shadowColor", v)} />
            </Row>
            <Row label={`그림자 흐림 ${value.shadowBlur}`}>
              <input type="range" min={0} max={20} value={value.shadowBlur} onChange={(e) => set("shadowBlur", +e.target.value)} className="w-full accent-pink-500" />
            </Row>
          </>
        )}

        {value.glow && (
          <>
            <Row label="글로우 색">
              <ColorInput value={value.glowColor} onChange={(v) => set("glowColor", v)} />
            </Row>
            <Row label={`글로우 크기 ${value.glowSize}`}>
              <input type="range" min={2} max={30} value={value.glowSize} onChange={(e) => set("glowSize", +e.target.value)} className="w-full accent-pink-500" />
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
              <input type="range" min={0} max={1} step={0.05} value={value.boxOpacity} onChange={(e) => set("boxOpacity", +e.target.value)} className="w-full accent-pink-500" />
            </Row>
            <Row label={`박스 좌우 여백 ${value.boxPadX}px`}>
              <input type="range" min={0} max={48} value={value.boxPadX} onChange={(e) => set("boxPadX", +e.target.value)} className="w-full accent-pink-500" />
            </Row>
            <Row label={`박스 상하 여백 ${value.boxPadY}px`}>
              <input type="range" min={0} max={48} value={value.boxPadY} onChange={(e) => set("boxPadY", +e.target.value)} className="w-full accent-pink-500" />
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
                className="w-full cursor-not-allowed accent-pink-500 opacity-40"
              />
            </Row>
          </>
        )}
      </div>

      <div className="mt-6 border-t border-[var(--line)] pt-4">
        {/* 프리셋 — 클릭 한 번에 스타일 세트 적용(적용 대상은 현재 scope 따름) */}
        <div className="mb-1 text-xs font-bold text-slate-400">스타일 프리셋</div>
        {scope === "selected" ? (
          <p className="mb-2.5 rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-300 ring-1 ring-amber-400/25">
            ⚠ 지금은 <b>선택 자막 모드</b> — 프리셋이 <b>{scopeLabel ?? "선택한 줄"}에만</b> 적용돼요.
            전체에 적용하려면 위 <b>전체 자막</b> 탭으로 전환.
          </p>
        ) : (
          <p className="mb-2.5 text-[11px] leading-relaxed text-slate-500">
            클릭하면 폰트·크기·색·외곽선을 <b className="text-slate-400">모든 자막 줄에 한 세트로</b> 적용해요(잠긴 줄 제외). 이후 위 컨트롤로 세부 조정.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          {PRESET_TEMPLATES.map((p) => (
            <button
              key={p.name}
              onClick={() => onChange(p.style)}
              title={scope === "selected" ? "이 스타일을 선택한 줄에만 적용" : "이 스타일로 전체 자막 적용"}
              className="panel-2 flex items-center gap-2 overflow-hidden rounded-2xl p-2 text-left transition hover:ring-1 hover:ring-pink-500/50"
            >
              <div
                className="flex h-11 w-16 flex-none items-center justify-center overflow-hidden rounded-lg"
                style={{ background: "#3a3f4a" }}
              >
                <span style={{ ...styleToCss(p.style), fontSize: Math.min(15, p.style.size / 3.4) }}>가나다</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold text-slate-100">{p.name}</div>
                <div className="truncate text-[10px] text-slate-500">{p.desc}</div>
              </div>
            </button>
          ))}
        </div>

        {/* 내 템플릿 — 지금 만든 스타일을 이름 붙여 저장 + 프리미어 .mogrt 부분 임포트 */}
        <div className="mt-4 mb-2 flex items-center justify-between">
          <div className="text-xs font-bold text-slate-400">
            내 템플릿 {Object.keys(templates).length > 0 && <span className="opacity-60">({Object.keys(templates).length})</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <label className="btn-ghost cursor-pointer rounded-full px-3 py-1.5 text-xs font-bold transition" title="Premiere Pro .mogrt 템플릿에서 정적 스타일만 가져오기(베타)">
              {mogrtBusy ? "가져오는 중…" : ".mogrt 가져오기"}
              <input type="file" accept=".mogrt" className="hidden" disabled={mogrtBusy}
                onChange={(e) => { importMogrt(e.target.files); e.target.value = ""; }} />
            </label>
            <button
              onClick={() => { setTplName(""); setSaveModalOpen(true); }}
              className="btn-ghost rounded-full px-3 py-1.5 text-xs font-bold transition"
            >
              + 현재 스타일 저장
            </button>
          </div>
        </div>

        {Object.keys(templates).length === 0 ? (
          <p className="panel-2 rounded-2xl px-3 py-3 text-center text-[11px] text-slate-500">
            자주 쓰는 스타일을 만든 뒤 저장해두면 여기서 바로 불러와요.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Object.entries(templates).map(([name, st]) => (
              <div key={name} className="group panel-2 flex items-center gap-2 overflow-hidden rounded-2xl p-2">
                <div
                  className="flex h-11 w-16 flex-none items-center justify-center overflow-hidden rounded-lg"
                  style={{ background: "#3a3f4a" }}
                  title="미리보기"
                >
                  <span style={{ ...styleToCss(st), fontSize: Math.min(15, st.size / 3.4) }}>가나다</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold text-slate-100">{name}</div>
                  <div className="truncate text-[10px] text-slate-500">{st.font} · {st.size}px</div>
                </div>
                <div className="flex flex-none gap-1">
                  <button onClick={() => loadTemplate(name)} className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-[var(--text-strong)] transition hover:bg-white/20">
                    적용
                  </button>
                  <button onClick={() => { if (window.confirm(`'${name}' 템플릿을 삭제할까요?`)) deleteTemplate(name); }} className="rounded-full px-2 py-1 text-xs text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-400">
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSaveModalOpen(false)}
        >
          <div
            className="panel w-full max-w-sm rounded-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 text-base font-bold text-slate-100">템플릿 저장</div>
            <p className="mb-4 text-xs text-slate-400">현재 자막 스타일을 이름 붙여 저장합니다.</p>
            <div className="mb-4 flex items-center justify-center rounded-xl p-4" style={{ background: "#6a7180" }}>
              <ScaledPreview s={value} text={text} />
            </div>
            <input
              autoFocus
              value={tplName}
              onChange={(e) => setTplName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmSaveTemplate(); if (e.key === "Escape") setSaveModalOpen(false); }}
              placeholder="템플릿 이름 (예: 굵은 노랑 강조)"
              className="field mb-4 w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setSaveModalOpen(false)} className="btn-ghost rounded-full px-4 py-2 text-sm font-semibold transition">
                취소
              </button>
              <button onClick={confirmSaveTemplate} disabled={!tplName.trim()} className="btn-primary rounded-full px-6 py-2 text-sm font-bold transition">
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
    <div className="panel-2 rounded-2xl p-3.5">
      <div className="mb-1.5 text-xs font-bold text-slate-400">{label}</div>
      {children}
    </div>
  );
}


function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 cursor-pointer rounded-lg border border-[var(--line)] bg-transparent" />
      <span className="text-xs text-slate-400">{value}</span>
    </div>
  );
}

export default memo(CaptionEditor);
