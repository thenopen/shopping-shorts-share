"use client";

import { useEffect, useState } from "react";
import { Settings, X, Lock, FileText, TriangleAlert } from "lucide-react";
import { apiBase, postJSON, errMsg } from "../lib/api";
import { Spinner } from "../ui";
import { SettingsStatus, TestResult, ModalAcct } from "../lib/types";

// 설정 패널 — API 키/토큰/한도를 사이트에서 입력·저장. 키는 서버에만 저장되고
// 화면엔 마스킹(끝 4자리)만. 빈칸은 기존값 유지. 저장 시 배지도 갱신(onSaved).
export function SettingsPanel({ onClose, onSaved, onDeploy }: { onClose: () => void; onSaved: () => void; onDeploy: () => void }) {
  const [st, setSt] = useState<SettingsStatus | null>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [typecastKey, setTypecastKey] = useState("");
  const [tcStat, setTcStat] = useState<{ set: boolean; plan?: string; remaining?: number } | null>(null);
  async function loadTc() {
    try {
      const r = await fetch(`${apiBase()}/tts/typecast/status`);
      if (r.ok) setTcStat(await r.json());
    } catch {}
  }
  const [elevenKey, setElevenKey] = useState("");
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [ttsJson, setTtsJson] = useState("");
  const [modalId, setModalId] = useState("");
  const [modalSecret, setModalSecret] = useState("");
  const [lim, setLim] = useState({ gemini_rpd: "", tts_chars: "", modal_credit: "" });
  const [dlDir, setDlDir] = useState("");
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<Record<string, TestResult>>({});
  const [modalAccts, setModalAccts] = useState<ModalAcct[]>([]);       // Modal 로테이션 풀
  const [acctTotal, setAcctTotal] = useState(0);                       // 실효 계정수(풀+기존)
  const [defaultIncluded, setDefaultIncluded] = useState(false);       // 기존(대표) 자동 포함?
  const [newAcct, setNewAcct] = useState({ label: "", token_id: "", token_secret: "" });
  const [acctBusy, setAcctBusy] = useState(false);
  const [acctTest, setAcctTest] = useState<TestResult | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch(`${apiBase()}/settings`);
        if (!r.ok) return;
        const j: SettingsStatus = await r.json();
        if (!live) return;
        setSt(j);
        setLim({
          gemini_rpd: String(j.limits.gemini_rpd),
          tts_chars: String(j.limits.tts_chars),
          modal_credit: String(j.limits.modal_credit),
        });
        setDlDir(j.download_dir || "");
      } catch {}
    })();
    loadAccts();
    loadTc();
    return () => { live = false; };
  }, []);

  // 배포 진행 중인 계정이 있으면 4초마다 상태 폴링(첫 배포는 이미지 빌드로 수 분).
  useEffect(() => {
    if (!modalAccts.some((a) => a.deploy === "deploying")) return;
    const id = setInterval(loadAccts, 4000);
    return () => clearInterval(id);
  }, [modalAccts]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAccts() {
    try {
      const r = await fetch(`${apiBase()}/modal/accounts`);
      if (!r.ok) return;
      const j = await r.json();
      setModalAccts(j.accounts || []);
      setAcctTotal(j.total ?? (j.accounts || []).length);
      setDefaultIncluded(!!j.default_included);
    } catch {}
  }
  async function addAcct() {
    if (!newAcct.token_id.trim() || !newAcct.token_secret.trim() || acctBusy) return;
    setAcctBusy(true);
    try {
      const j = await postJSON<{ accounts: ModalAcct[] }>("/modal/accounts/add", newAcct);
      setModalAccts(j.accounts || []);
      setNewAcct({ label: "", token_id: "", token_secret: "" });
      setAcctTest(null);
      onSaved();
      onDeploy();   // 추가 즉시 자동 배포 시작 → 헤더 배포중 감시

    } catch (e) {
      alert(errMsg(e, "계정 추가 실패"));
    } finally {
      setAcctBusy(false);
    }
  }
  async function delAcct(i: number) {
    try {
      const r = await fetch(`${apiBase()}/modal/accounts/${i}`, { method: "DELETE" });
      const j = await r.json();
      setModalAccts(j.accounts || []);
      onSaved();
    } catch {}
  }
  async function deployAccount(i: number) {
    try {
      await postJSON("/modal/accounts/deploy", { index: i });
      loadAccts();  // 배포중 상태 반영 시작
      onDeploy();   // 헤더 배포중 감시 시작
    } catch (e) {
      alert(errMsg(e, "배포 시작 실패"));
    }
  }
  async function testNewAcct() {
    if (!newAcct.token_id.trim() || !newAcct.token_secret.trim()) return;
    setAcctTest("loading");
    try {
      const r = await postJSON<{ ok: boolean; msg: string }>("/settings/test", {
        service: "modal", token_id: newAcct.token_id.trim(), token_secret: newAcct.token_secret.trim(),
      });
      setAcctTest(r);
    } catch (e) {
      setAcctTest({ ok: false, msg: e instanceof Error ? e.message : "실패" });
    }
  }

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        limits: {
          gemini_rpd: Number(lim.gemini_rpd) || undefined,
          tts_chars: Number(lim.tts_chars) || undefined,
          modal_credit: Number(lim.modal_credit) || undefined,
        },
      };
      if (geminiKey.trim()) body.gemini_key = geminiKey.trim();
      if (typecastKey.trim()) body.typecast_key = typecastKey.trim();
      if (elevenKey.trim()) body.elevenlabs_key = elevenKey.trim();
      if (googleApiKey.trim()) body.google_api_key = googleApiKey.trim();
      if (ttsJson.trim()) body.tts_json = ttsJson.trim();
      if (modalId.trim()) body.modal_token_id = modalId.trim();
      if (modalSecret.trim()) body.modal_token_secret = modalSecret.trim();
      body.download_dir = dlDir.trim();
      const r = await postJSON<{ ok: boolean; errors: Record<string, string>; status: SettingsStatus }>("/settings", body);
      setSt(r.status);
      setGeminiKey(""); setTypecastKey(""); setElevenKey(""); setGoogleApiKey(""); setTtsJson(""); setModalId(""); setModalSecret("");
      if (typecastKey.trim()) loadTc();   // Typecast 상태(잔여 크레딧) 갱신
      if (!r.ok) alert("일부 저장 실패:\n" + Object.entries(r.errors).map(([k, v]) => `${k}: ${v}`).join("\n"));
      onSaved();
    } catch (e) {
      alert(errMsg(e, "저장 실패"));
    } finally {
      setSaving(false);
    }
  }

  async function runTest(svc: string) {
    setTest((t) => ({ ...t, [svc]: "loading" }));
    try {
      const r = await postJSON<{ ok: boolean; msg: string }>("/settings/test", { service: svc });
      setTest((t) => ({ ...t, [svc]: r }));
    } catch (e) {
      setTest((t) => ({ ...t, [svc]: { ok: false, msg: e instanceof Error ? e.message : "실패" } }));
    }
  }

  function onTtsFile(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => setTtsJson(String(rd.result || ""));
    rd.readAsText(f);
  }

  const badge = (set: boolean, info?: string) =>
    set ? <span className="text-emerald-400">✓ 저장됨 {info}</span> : <span className="text-rose-400">✗ 없음</span>;
  const TestView = ({ svc }: { svc: string }) => {
    const v = test[svc];
    if (!v) return null;
    if (v === "loading") return <span className="text-slate-500">테스트 중…</span>;
    return <span className={v.ok ? "text-emerald-400" : "text-rose-400"}>{v.ok ? "✓ " : "✗ "}{v.msg}</span>;
  };
  const tBtn = "btn-ghost rounded-full px-2.5 py-1 font-semibold";
  const inp = "field w-full rounded-lg px-3 py-2 text-sm outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="panel mt-8 mb-8 w-full max-w-lg rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-100"><Settings className="h-5 w-5 text-slate-400" /> 설정 · API 키 / 한도</h2>
          <button onClick={onClose} className="btn-ghost flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold text-slate-300" aria-label="닫기">닫기 <X className="h-3.5 w-3.5" /></button>
        </div>
        <p className="mb-4 rounded-xl bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300"><Lock className="mr-1 inline h-3 w-3" />키는 서버에만 저장되고 화면엔 끝 4자리만 보여요. 바꿀 때만 새로 입력(빈칸이면 기존 유지). 개인망(Tailscale) 신뢰 전제.</p>

        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-sm font-semibold text-slate-200">
            <span>Gemini API 키</span>
            <span className="text-[11px] font-medium">{st ? badge(st.gemini.set, st.gemini.masked) : "…"}</span>
          </div>
          <input type="password" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} placeholder="AIza… (새 키 입력 시에만)" className={inp} />
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            <button onClick={() => runTest("gemini")} className={tBtn}>테스트</button>
            <span className="text-slate-500">(요청 1회 소모)</span>
            <TestView svc="gemini" />
          </div>
        </div>

        {/* Typecast(TTS 음성) 키 — BYOK */}
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-sm font-semibold text-slate-200">
            <span>Typecast API 키 <span className="text-[11px] font-normal text-slate-500">(음성 생성)</span></span>
            <span className="text-[11px] font-medium">
              {tcStat == null ? "…" : tcStat.set
                ? <span className="text-emerald-400">설정됨{tcStat.remaining != null ? ` · 잔여 ${tcStat.remaining.toLocaleString()}자` : ""}</span>
                : <span className="text-slate-500">미설정</span>}
            </span>
          </div>
          <input type="password" value={typecastKey} onChange={(e) => setTypecastKey(e.target.value)} placeholder="__plt… (새 키 입력 시에만)" className={inp} />
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            <button onClick={() => runTest("typecast")} className={tBtn}>테스트</button>
            <span className="text-slate-500">typecast.ai/developers 에서 발급 · 무료 월 3만자</span>
            <TestView svc="typecast" />
          </div>
        </div>

        {/* ElevenLabs(TTS 음성) 키 — BYOK */}
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-sm font-semibold text-slate-200">
            <span>ElevenLabs API 키 <span className="text-[11px] font-normal text-slate-500">(음성 생성)</span></span>
            <span className="text-[11px] font-medium">{st ? badge(st.elevenlabs.set, st.elevenlabs.masked) : "…"}</span>
          </div>
          <input type="password" value={elevenKey} onChange={(e) => setElevenKey(e.target.value)} placeholder="sk_… (새 키 입력 시에만)" className={inp} />
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            <button onClick={() => runTest("elevenlabs")} className={tBtn}>테스트</button>
            <span className="text-slate-500">elevenlabs.io → Profile → API Keys</span>
            <TestView svc="elevenlabs" />
          </div>
        </div>

        {/* Google Cloud TTS API 키 — BYOK(서비스계정 JSON과 별개, 키만 넣으면 음성목록 자동) */}
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-sm font-semibold text-slate-200">
            <span>Google Cloud API 키 <span className="text-[11px] font-normal text-slate-500">(음성 생성 · 간편)</span></span>
            <span className="text-[11px] font-medium">{st ? badge(st.google_api.set, st.google_api.masked) : "…"}</span>
          </div>
          <input type="password" value={googleApiKey} onChange={(e) => setGoogleApiKey(e.target.value)} placeholder="AIza… (새 키 입력 시에만)" className={inp} />
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            <button onClick={() => runTest("google_api")} className={tBtn}>테스트</button>
            <span className="text-slate-500">Cloud Console에서 Text-to-Speech API 활성화 + API 키 발급</span>
            <TestView svc="google_api" />
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-sm font-semibold text-slate-200">
            <span>Google TTS 서비스계정 JSON <span className="text-[11px] font-normal text-slate-500">(선택 · 고급)</span></span>
            <span className="max-w-[55%] truncate text-[11px] font-medium">{st ? badge(st.google_tts.set, st.google_tts.email) : "…"}</span>
          </div>
          <textarea value={ttsJson} onChange={(e) => setTtsJson(e.target.value)} placeholder={'{ "type": "service_account", ... }  붙여넣기'} rows={3} className={`${inp} font-mono text-[11px]`} />
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            <label className={`${tBtn} flex cursor-pointer items-center gap-1`}><FileText className="h-3 w-3" /> 파일 선택<input type="file" accept="application/json,.json" className="hidden" onChange={(e) => { onTtsFile(e.target.files); e.target.value = ""; }} /></label>
            <button onClick={() => runTest("tts")} className={tBtn}>테스트</button>
            <TestView svc="tts" />
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-sm font-semibold text-slate-200">
            <span>Modal 토큰 <span className="font-medium text-slate-500">(대표·배포 계정)</span></span>
            <span className="text-[11px] font-medium">{st ? badge(st.modal.set, st.modal.masked) : "…"}</span>
          </div>
          <div className="flex gap-2">
            <input value={modalId} onChange={(e) => setModalId(e.target.value)} placeholder="token_id (ak-…)" className={inp} />
            <input type="password" value={modalSecret} onChange={(e) => setModalSecret(e.target.value)} placeholder="token_secret (as-…)" className={inp} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            <button onClick={() => runTest("modal")} className={tBtn}>테스트</button>
            <TestView svc="modal" />
          </div>
        </div>

        {/* Modal 계정 풀 — 여러 계정 로테이션(병렬 처리·크레딧 분산·페일오버) */}
        <div className="mb-4 rounded-2xl border border-[var(--line)] p-3">
          <div className="mb-1 text-sm font-semibold text-slate-200">Modal 계정 풀 · 로테이션 <span className="font-medium text-slate-500">(여러 영상 병렬)</span></div>
          <p className="mb-2 rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-300"><TriangleAlert className="mr-1 inline h-3 w-3" />무료계정 다수로 크레딧 불리기는 ToS 멀티어카운팅 위반 소지(정지 위험). 계정 추가하면 그 계정에 자동 배포됨(첫 배포는 이미지 빌드로 수 분).</p>
          {modalAccts.length > 0 ? (
            <div className="mb-2 flex flex-col gap-1">
              {modalAccts.map((a, i) => {
                const dep = a.deploy;
                const depChip =
                  dep === "done" ? <span className="text-emerald-400">✓ 배포됨</span>
                    : dep === "deploying" ? <span className="flex items-center gap-1 text-amber-400"><Spinner className="h-2.5 w-2.5 border-amber-400/40 border-t-amber-400" />배포중… (수 분)</span>
                      : dep === "error" ? <span className="text-rose-400" title={a.deploy_msg}>✗ 배포실패</span>
                        : <span className="text-slate-500">미배포</span>;
                return (
                  <div key={i} className="panel-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2.5 py-1.5 text-[11px]">
                    <span className="font-semibold text-slate-100">{a.label || `계정 ${i + 1}`}</span>
                    <span className="text-slate-400">{a.masked}</span>
                    {depChip}
                    <span className={`ml-auto font-semibold ${a.remaining <= 0 ? "text-rose-400" : "text-emerald-400"}`}>{`$${a.remaining} 남음`}</span>
                    <button onClick={() => deployAccount(i)} disabled={dep === "deploying"} className="font-semibold text-pink-400 hover:underline disabled:opacity-50">
                      {dep === "done" ? "재배포" : "배포"}
                    </button>
                    <button onClick={() => delAcct(i)} className="font-semibold text-rose-400 hover:underline">삭제</button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mb-2 text-[11px] text-slate-500">등록된 계정 없음 — 비어있으면 대표 계정 1개로 동작.</p>
          )}
          {defaultIncluded && (
            <p className="mb-2 text-[11px] font-medium text-emerald-400">＋ 기존(대표) 계정도 로테이션·크레딧에 자동 포함 · <b>총 {acctTotal}계정</b> 합산</p>
          )}
          <div className="flex flex-col gap-1.5">
            <input value={newAcct.label} onChange={(e) => setNewAcct({ ...newAcct, label: e.target.value })} placeholder="라벨(선택, 예: acctA)" className={inp} />
            <div className="flex gap-1.5">
              <input value={newAcct.token_id} onChange={(e) => setNewAcct({ ...newAcct, token_id: e.target.value })} placeholder="token_id (ak-…)" className={inp} />
              <input type="password" value={newAcct.token_secret} onChange={(e) => setNewAcct({ ...newAcct, token_secret: e.target.value })} placeholder="token_secret (as-…)" className={inp} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <button onClick={testNewAcct} className={tBtn}>테스트</button>
              <button onClick={addAcct} disabled={acctBusy || !newAcct.token_id.trim() || !newAcct.token_secret.trim()} className="btn-primary rounded-full px-3 py-1 font-bold disabled:opacity-50">+ 추가</button>
              {acctTest && (acctTest === "loading" ? <span className="text-slate-500">테스트 중…</span> : <span className={acctTest.ok ? "text-emerald-400" : "text-rose-400"}>{acctTest.ok ? "✓ " : "✗ "}{acctTest.msg}</span>)}
            </div>
          </div>
        </div>

        <div className="mb-5">
          <div className="mb-1.5 text-sm font-semibold text-slate-200">API 한도 <span className="font-medium text-slate-500">(배지 잔여 계산 기준)</span></div>
          <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-400">
            <label className="flex flex-col gap-1">Gemini 요청/일<input value={lim.gemini_rpd} onChange={(e) => setLim({ ...lim, gemini_rpd: e.target.value })} inputMode="numeric" className="field rounded-lg px-2 py-1.5 text-sm outline-none" /></label>
            <label className="flex flex-col gap-1">TTS 글자/월<input value={lim.tts_chars} onChange={(e) => setLim({ ...lim, tts_chars: e.target.value })} inputMode="numeric" className="field rounded-lg px-2 py-1.5 text-sm outline-none" /></label>
            <label className="flex flex-col gap-1">Modal $/월<input value={lim.modal_credit} onChange={(e) => setLim({ ...lim, modal_credit: e.target.value })} inputMode="numeric" className="field rounded-lg px-2 py-1.5 text-sm outline-none" /></label>
          </div>
        </div>

        <div className="mb-5">
          <div className="mb-1 text-sm font-semibold text-slate-200">다운로드 폴더 <span className="font-medium text-slate-500">(서버 경로 · 영상 재사용 보관 위치)</span></div>
          <input value={dlDir} onChange={(e) => setDlDir(e.target.value)} placeholder="비우면 기본값 (packages/core/downloads)" className={`${inp} font-mono text-[12px]`} />
        </div>

        <button onClick={save} disabled={saving} className="btn-primary w-full rounded-xl py-3 text-sm font-bold transition disabled:opacity-50">{saving ? "저장 중…" : "저장"}</button>
      </div>
    </div>
  );
}
