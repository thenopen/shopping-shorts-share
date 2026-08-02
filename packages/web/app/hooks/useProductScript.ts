"use client";
import { useEffect, useState } from "react";
import { postJSON, errMsg } from "../lib/api";

// 제품 소구포인트: 상세페이지 URL / 캡처이미지 여러 장(파일·Ctrl+V) → 대본 결합.
// script(영상내용, video_content) + commitScript는 useScriptHistory 것을 주입받아 사용.
export function useProductScript({ script, commitScript, videoDuration }: { script: string; commitScript: (s: string) => void; videoDuration?: number | null }) {
  const [productUrl, setProductUrl] = useState("");
  const [productImages, setProductImages] = useState<string[]>([]); // dataURL[]
  const [sellingPoints, setSellingPoints] = useState("");
  const [productBusy, setProductBusy] = useState(false);
  const [productErr, setProductErr] = useState("");
  const [productMsg, setProductMsg] = useState("");       // 제품 대본 생성 완료 안내
  const [productStage, setProductStage] = useState("");   // 제품 분석 진행 힌트(크롤 수십 초)
  const [pointsEdit, setPointsEdit] = useState(false);    // 소구포인트 편집/보기 토글
  useEffect(() => {
    if (!productBusy) { setProductStage(""); return; }
    const steps = ["🔎 상세페이지 여는 중…", "📄 내용 읽는 중…", "✨ 소구포인트 뽑는 중…", "✍️ 대본 작성 중…"];
    let i = 0;
    setProductStage(steps[0]);
    const id = setInterval(() => { i = Math.min(i + 1, steps.length - 1); setProductStage(steps[i]); }, 7000);
    return () => clearInterval(id);
  }, [productBusy]);

  // 캡처 이미지를 그대로 base64로 보내면 상세페이지 캡처가 10MB를 넘어 프록시(요청 본문 한도)에
  // 걸려 요청이 끊긴다 → 업로드 시 폭 1280px·JPEG로 축소해 전송(글자 가독성 유지 + Gemini 부담↓).
  function downscaleToDataURL(file: File, maxW = 1280, maxH = 8000, quality = 0.85): Promise<string> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          let scale = Math.min(1, maxW / img.width);
          if (img.height * scale > maxH) scale = Math.min(scale, maxH / img.height);
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) { throw new Error("no canvas ctx"); }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch {
          // 축소 실패 시 원본으로 폴백(작은 이미지면 문제없음)
          const rd = new FileReader();
          rd.onload = () => resolve(String(rd.result || ""));
          rd.readAsDataURL(file);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        const rd = new FileReader();
        rd.onload = () => resolve(String(rd.result || ""));
        rd.readAsDataURL(file);
      };
      img.src = url;
    });
  }

  function addImageFiles(files: FileList | File[] | null) {
    const list = Array.from(files || []).filter((f) => f.type.startsWith("image/"));
    list.forEach((file) => {
      downscaleToDataURL(file).then((dataUrl) =>
        setProductImages((prev) => [...prev, dataUrl])
      );
    });
  }

  // 클립보드 캡처 Ctrl+V 붙여넣기(여러 장 누적)
  function onProductPaste(e: React.ClipboardEvent) {
    const imgs = Array.from(e.clipboardData.items)
      .filter((it) => it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (imgs.length) {
      e.preventDefault();
      addImageFiles(imgs);
    }
  }

  // opts.fromPoints=true → 재크롤 없이 이미 뽑은 소구포인트(sellingPoints)로 대본만 다시.
  async function generateProductScript(opts?: { fromPoints?: boolean }) {
    if (productBusy) return;
    const fromPoints = !!opts?.fromPoints && !!sellingPoints.trim();
    if (!fromPoints && !productUrl.trim() && productImages.length === 0) {
      setProductErr("제품 링크 또는 캡처 이미지를 올려주세요.");
      return;
    }
    setProductBusy(true);
    setProductErr("");
    setProductMsg("");
    try {
      const target_seconds = videoDuration && videoDuration > 0 ? videoDuration : null;
      const body = fromPoints
        ? { manual_points: sellingPoints, video_content: script, combine: true, target_seconds }
        : { product_url: productUrl.trim(), product_images: productImages, video_content: script, combine: true, target_seconds };
      const d = await postJSON<any>("/script/product", body);
      if (d.debug?.length) console.log("[제품대본 DEBUG] 전 과정 ↓\n" + d.debug.join("\n"));
      if (d.error) {
        setProductErr(d.error);
        if (d.selling_points) setSellingPoints(d.selling_points);
      } else {
        setSellingPoints(d.selling_points || "");
        if (d.script) {
          commitScript(d.script);
          setProductMsg("✅ 대본이 만들어졌어요 — 아래 '한국어 대본'에서 확인·수정하세요.");
        }
      }
    } catch (e) {
      setProductErr(errMsg(e, "대본 생성 실패. 서버 상태를 확인하세요."));
    } finally {
      setProductBusy(false);
    }
  }

  return {
    productUrl, setProductUrl, productImages, setProductImages,
    sellingPoints, setSellingPoints, productBusy, productErr, productMsg,
    productStage, pointsEdit, setPointsEdit,
    addImageFiles, onProductPaste, generateProductScript,
  };
}
