import type { NextConfig } from "next";

// 코어 API 주소 — 환경변수 CORE_PORT/CORE_HOST 로 포트 충돌 시 변경 가능.
const API = `http://127.0.0.1:${process.env.CORE_PORT || "8000"}`;
const API_PREFIXES = [
  "tts", "script", "jobs", "analyze", "transcribe",
  "captions", "refine", "agent", "render", "file", "usage", "settings",
  "preview_url", "library", "modal", "quality", "overlays", "projects",
];

const nextConfig: NextConfig = {
  // rewrites 프록시 타임아웃 30초(기본) → 5분.
  // /script/product(크롤+비전 수십초~)가 30초 넘으면 코어는 성공하는데 브라우저만 500 받던 원인.
  // proxyClientMaxBodySize: 기본 10MB → 50MB. 상세페이지 캡처 이미지(base64)가 10MB 넘으면
  // 프록시가 본문을 잘라 ECONNRESET(요청 끊김) 나던 원인. 프론트에서 축소도 하지만 여유 확보.
  experimental: { proxyTimeout: 300_000, proxyClientMaxBodySize: "50mb" },
  // 원격접속(터널/LAN/Tailscale) 시 dev 리소스(/_next) cross-origin 허용
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "desktop-fu19gql.tailbf2d8f.ts.net",
    "100.87.145.86",
    "192.168.0.204",
    "*.trycloudflare.com",
  ],
  // 백엔드(8000)를 같은 출처(3000)로 프록시 → 터널/LAN/Tailscale 전부 포트 하나로 동작
  async rewrites() {
    return API_PREFIXES.flatMap((p) => [
      { source: `/${p}`, destination: `${API}/${p}` },
      { source: `/${p}/:path*`, destination: `${API}/${p}/:path*` },
    ]);
  },
};

export default nextConfig;
