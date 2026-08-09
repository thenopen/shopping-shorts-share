"use client";
import { useEffect, useState } from "react";
import { promptDialog } from "../components/ui/Modal";

// 기본 제공 CTA 문구(텍스트 자체를 값으로 사용 — 서버가 커스텀 문구도 그대로 받음)
const DEFAULT_CTAS = [
  "제품 정보는 고정 댓글에서 확인하세요!",
  "구매처는 프로필 링크에 있어요.",
  "자세한 내용은 하단 링크를 눌러주세요.",
];
const CTA_STORAGE_KEY = "custom_ctas";

// CTA 문구 목록(기본3 + 사용자 추가 통합. 기본도 삭제 가능) + 선택. localStorage 저장.
export function useCtas() {
  const [ctaList, setCtaList] = useState<string[]>(DEFAULT_CTAS);
  const [cta, setCta] = useState(DEFAULT_CTAS[1]); // 선택된 CTA 문구(텍스트)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CTA_STORAGE_KEY);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) {
          const list = arr.filter((s) => typeof s === "string");
          setCtaList(list);
          setCta(list[0] ?? "");
        }
      }
    } catch {}
  }, []);

  function persistCtas(list: string[]) {
    setCtaList(list);
    try { localStorage.setItem(CTA_STORAGE_KEY, JSON.stringify(list)); } catch {}
  }
  async function addCustomCta() {
    const v = await promptDialog({ title: "CTA 추가", message: "추가할 CTA 문구를 입력하세요", placeholder: "예: 지금 프로필 링크에서 확인하세요" });
    const t = (v || "").trim();
    if (!t) return;
    if (!ctaList.includes(t)) persistCtas([...ctaList, t]);
    setCta(t);
  }
  function deleteCta(text: string) {
    const next = ctaList.filter((c) => c !== text);
    persistCtas(next);
    if (cta === text) setCta(next[0] ?? "");
  }

  return { ctaList, cta, setCta, addCustomCta, deleteCta };
}
