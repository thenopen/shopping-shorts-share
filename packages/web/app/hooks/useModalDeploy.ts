"use client";
import { useEffect, useState } from "react";
import { apiBase } from "../lib/api";

// Modal 계정 배포 감시 — 마운트 시 1회 + watchDeploy() 호출 시 폴링. 배포중 0되면 멈춤.
export function useModalDeploy() {
  const [deployN, setDeployN] = useState(0);          // Modal 배포중 계정 수(헤더 표시용)
  const [deployWatch, setDeployWatch] = useState(0);  // 배포 감시 폴링 트리거

  useEffect(() => {
    let live = true;
    let done = false;
    const poll = async () => {
      try {
        const r = await fetch(`${apiBase()}/modal/accounts`);
        if (!r.ok) return;
        const j = await r.json();
        const n = (j.accounts || []).filter((a: { deploy: string }) => a.deploy === "deploying").length;
        if (!live) return;
        setDeployN(n);
        if (n === 0) done = true;
      } catch {}
    };
    poll();
    const id = setInterval(() => { if (done) { clearInterval(id); return; } poll(); }, 5000);
    return () => { live = false; clearInterval(id); };
  }, [deployWatch]);

  const watchDeploy = () => setDeployWatch((w) => w + 1);
  return { deployN, watchDeploy };
}
