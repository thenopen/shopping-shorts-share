import type { Metadata } from "next";
import Script from "next/script";
import { Inter } from "next/font/google";
import "./globals.css";

// UI 라틴 = Inter, 한글 = Pretendard(CDN) 폰백. 자막 폰트는 fonts.generated.css(로컬 539종).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "쇼핑쇼츠 메이커",
  description: "도우인 상품영상을 한국어 쇼핑 쇼츠로 자동 변환",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      suppressHydrationWarning
      className={`${inter.variable} h-full antialiased`}
    >
      <head>
        {/*
          테마 초기화 — 첫 페인트 전에 localStorage 반영(라이트 선택 시 다크 플래시 방지).
          React 19 / Next 16 에선 <script dangerouslySetInnerHTML> 대신 next/script <Script> 사용 권장
          (인라인 <script>는 클라이언트 렌더 시 실행 안 됨 경고). beforeInteractive 전략 = 체적 하이드레이션 전 실행.
        */}
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}`,
          }}
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css"
        />
        {/* 자막 폰트 — Tailwind와 분리해 직접 로드 (순서충돌 회피) */}
        <link rel="stylesheet" href="/fonts.css" />
      </head>
      <body suppressHydrationWarning className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
