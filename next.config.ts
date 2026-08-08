import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // StrictMode's double-mount creates two WebGL contexts and downloads each
  // splat twice, which is expensive for multi-MB captures.
  reactStrictMode: false,
};

export default nextConfig;
