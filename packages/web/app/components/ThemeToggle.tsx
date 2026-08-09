"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

// 다크(기본)/라이트 토글 — html[data-theme] + localStorage("theme").
// 최초 페인트 전 적용은 layout.tsx의 인라인 스크립트가 담당(플래시 방지).
export function ThemeToggle() {
  const [light, setLight] = useState(false);

  // 마운트 후 실제 문서 상태와 동기화(SSR엔 테마 정보 없음)
  useEffect(() => {
    setLight(document.documentElement.dataset.theme === "light");
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    if (next) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("theme", next ? "light" : "dark"); } catch {}
  }

  return (
    <button
      onClick={toggle}
      aria-label={light ? "다크 모드로 전환" : "라이트 모드로 전환"}
      title={light ? "다크 모드" : "라이트 모드"}
      className="btn-ghost flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg"
    >
      {light ? <Moon className="h-4 w-4 text-slate-400" /> : <Sun className="h-4 w-4 text-slate-300" />}
    </button>
  );
}
