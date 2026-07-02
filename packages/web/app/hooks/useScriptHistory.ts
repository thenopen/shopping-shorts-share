"use client";
import { useRef, useState } from "react";

// 한국어 대본 + 버전기록(되돌리기/다시실행). page.tsx Home에서 인라인이던 것을 그대로 이관.
// scriptDirtyRef: 사용자가 대본을 건드렸으면 폴링이 서버값으로 덮어쓰지 않음(호출부가 읽고 씀).
export function useScriptHistory() {
  const [script, setScript] = useState("");
  // 대본 버전기록(되돌리기/다시실행). past=이전버전들, future=redo스택.
  const [scriptPast, setScriptPast] = useState<string[]>([]);
  const [scriptFuture, setScriptFuture] = useState<string[]>([]);
  const scriptDirtyRef = useRef(false);
  // textarea focus 시점 대본(blur 때 비교해 변경됐으면 1버전으로 기록).
  const lastSnapshotRef = useRef("");

  // 현재 대본을 기록에 push하고 새 값으로 교체(되돌리기 가능). future는 초기화.
  function commitScript(next: string) {
    setScriptPast((p) => (script === next ? p : [...p, script].slice(-50)));
    if (script !== next) setScriptFuture([]);
    scriptDirtyRef.current = true;
    setScript(next);
  }

  function undoScript() {
    setScriptPast((p) => {
      if (!p.length) return p;
      const prev = p[p.length - 1];
      setScriptFuture((f) => [script, ...f].slice(0, 50));
      setScript(prev);
      scriptDirtyRef.current = true;
      return p.slice(0, -1);
    });
  }

  function redoScript() {
    setScriptFuture((f) => {
      if (!f.length) return f;
      const nextVal = f[0];
      setScriptPast((p) => [...p, script].slice(-50));
      setScript(nextVal);
      scriptDirtyRef.current = true;
      return f.slice(1);
    });
  }

  // textarea onFocus/onBlur — 사용자가 직접 타이핑해 바뀐 경우 1버전으로 기록.
  function beginSnapshot() { lastSnapshotRef.current = script; }
  function commitSnapshotIfChanged() {
    if (lastSnapshotRef.current !== script) {
      setScriptPast((p) => [...p, lastSnapshotRef.current].slice(-50));
      setScriptFuture([]);
    }
  }

  return {
    script, setScript, scriptDirtyRef,
    commitScript, undoScript, redoScript,
    canUndo: scriptPast.length > 0, canRedo: scriptFuture.length > 0,
    beginSnapshot, commitSnapshotIfChanged,
  };
}
