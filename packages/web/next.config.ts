import type { NextConfig } from "next";

const API = "http://127.0.0.1:8000";
const API_PREFIXES = [
  "tts", "script", "jobs", "analyze", "transcribe",
  "captions", "refine", "agent", "render", "file", "usage", "settings",
  "preview_url", "library", "modal", "quality",
];

const nextConfig: NextConfig = {
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
