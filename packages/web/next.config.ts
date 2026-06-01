import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tailscale 원격접속 시 dev 리소스(/_next) cross-origin 허용 (호스트명 + IP 둘 다)
  allowedDevOrigins: ["desktop-fu19gql.tailbf2d8f.ts.net", "100.87.145.86"],
};

export default nextConfig;
