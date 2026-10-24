import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Lint runs once from the repo root (pnpm lint), not again inside next build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
