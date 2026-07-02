import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// UI 라틴 = Inter, 한글 = Pretendard(CDN) 폴백. 자막 폰트는 fonts.generated.css(로컬 539종).
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
