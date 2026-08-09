"use client";
import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";
import { apiFetch, AuthError } from "../lib/api";
import { toast } from "../components/ui/Toast";
import type { JobState } from "../lib/types";

// 작업(job) 상태 폴링 — page.tsx Home에서 인라인이던 pollJob/stopPoll + 1회 콘솔로그 ref를 그대로 이관.
// job/busy/scriptBusy 상태는 Home에 남기고 setter만 주입(광범위하게 읽히므로). setScript/scriptDirtyRef는
// useScriptHistory 것을 그대로 사용. resetEngineLogs()는 새 분석 시작 시 호출(로그 다시 찍히게).
export function useJobPolling(opts: {
  setJob: Dispatch<SetStateAction<JobState | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setScriptBusy: Dispatch<SetStateAction<boolean>>;
  setScript: Dispatch<SetStateAction<string>>;
  scriptDirtyRef: { current: boolean };
}) {
  const { setJob, setBusy, setScriptBusy, setScript, scriptDirtyRef } = opts;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loggedEngineRef = useRef<string | null>(null);  // 자막제거 엔진 콘솔 1회 기록용
  const loggedDouyinRef = useRef(false);                // 도우인 다운로드 진단 콘솔 1회 기록용
  const loggedDebugRef = useRef(false);                 // 자막제거 판단/폴백 DEBUG 1회 기록용

  function stopPoll() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  // 새 분석 시작 시 1회-로그 플래그 리셋(엔진/도우인/DEBUG 다시 찍히게).
  function resetEngineLogs() {
    loggedEngineRef.current = null;
    loggedDouyinRef.current = false;
    loggedDebugRef.current = false;
  }

  function pollJob(id: string, stopStatuses: string[], done?: (j: JobState) => void) {
    if (!id) {
      stopPoll();
      setBusy(false); setScriptBusy(false);
      toast.error("작업 ID를 받지 못했습니다. 백엔드 로그를 확인하세요.");
      return;
    }
    stopPoll();
    let fails = 0;
    pollRef.current = setInterval(async () => {
      try {
        const r = await apiFetch(`/jobs/${id}`);
        if (!r.ok) {
          if (r.status === 404) {
            stopPoll();
            setBusy(false); setScriptBusy(false);
            toast.error("작업을 찾을 수 없습니다. 서버가 재시작되었을 수 있습니다.");
            return;
          }
          throw new Error(`HTTP ${r.status}`);
        }
        fails = 0
        const j: JobState = await r.json();
        setJob(j);
        // 자막제거에 실제로 쓰인 엔진을 브라우저 콘솔에 1회 기록.
        if (j.subtitle_engine && loggedEngineRef.current !== j.subtitle_engine) {
          loggedEngineRef.current = j.subtitle_engine;
          const label: Record<string, string> = {
            propainter: "ProPainter (시간축 복원)",
            propainter_local: "ProPainter · 로컬 GPU (시간축 복원)",
            propainter_modal: "ProPainter · 클라우드 Modal (시간축 복원)",
            lama: "LaMa (프레임 인페인팅)",
            lama_fallback: "LaMa (ProPainter 실패 → 폴백)",
            none: "고정박스 제거 (자막 미감지)",
          };
          console.log(
            `[자막제거 엔진] ${label[j.subtitle_engine] ?? j.subtitle_engine}` +
              (j.subtitle_engine_note ? ` | 사유: ${j.subtitle_engine_note}` : "")
          );
        }
        // 자막제거 판단/폴백 전체 과정을 콘솔에 1회 기록(왜 그 엔진이 됐는지).
        if (j.subtitle_debug && j.subtitle_debug.length && j.subtitle_engine && !loggedDebugRef.current) {
          loggedDebugRef.current = true;
          console.log("[자막제거 DEBUG] 판단·폴백 과정 ↓\n" + j.subtitle_debug.join("\n"));
        }
        // 도우인 다운로드 미디어 후보/트랙 진단을 브라우저 콘솔에 1회 기록.
        // diag는 다운로드 중 점진적으로 쌓이므로(요약 → 후보별 ffprobe 결과 순),
        // 다운로드 단계가 끝난 뒤(status가 downloading/queued를 벗어남) 찍어야 전체가 나옴.
        if (
          j.douyin_diag && j.douyin_diag.length &&
          j.status !== "queued" && j.status !== "downloading" &&
          !loggedDouyinRef.current
        ) {
          loggedDouyinRef.current = true;
          console.log(
            "[Douyin 다운로드 진단] 캡처된 미디어 후보 ↓\n" + j.douyin_diag.join("\n")
          );
        }
        // 서버 대본은 사용자가 아직 안 건드렸을 때만 채움(타이핑 덮어쓰기 방지).
        if (j.script && !scriptDirtyRef.current) {
          setScript(j.script);
          scriptDirtyRef.current = true;
        }
        if (stopStatuses.includes(j.status)) {
          stopPoll();
          setBusy(false);
          setScriptBusy(false);
          done?.(j);
        }
      } catch (e) {
        // 토큰 인증 실패(401) → 폴링 중단, page.tsx 가 토큰 입력 오버레이를 띄움.
        if (e instanceof AuthError) {
          stopPoll();
          setBusy(false); setScriptBusy(false);
          return;
        }
        // 일시적 네트워크 오류는 관용 — 연속 실패가 누적되면 폴링 중단.
        fails += 1;
        if (fails >= 5) {
          stopPoll();
          setBusy(false);
          setScriptBusy(false);
          toast.error("서버 연결이 끊겼습니다.");
        }
      }
    }, 1200);
  }

  // 언마운트 시 폴링 인터벌 정리(메모리 누수/유령 폴링 방지).
  useEffect(() => stopPoll, []);

  return { pollJob, stopPoll, resetEngineLogs };
}
