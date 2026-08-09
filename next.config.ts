import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // StrictMode's double-mount creates two WebGL contexts and downloads each
  // splat twice, which is expensive for multi-MB captures.
  reactStrictMode: false,

  images: {
    /**
     * Everything the app shows is a 640px JPEG in a bucket, drawn into tiles a
     * fifth that size. Routing them through the optimizer serves each one at
     * the size it is actually painted, in AVIF or WebP, so a grid costs a
     * fraction of what the originals do.
     *
     * Download URLs carry ?alt=media&token=…, and omitting `search` is what
     * allows a query string through — pinning it to "" would reject every one.
     */
    remotePatterns: [
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
        pathname: "/v0/b/**",
      },
      // Google account photos, which arrive on the profile rather than from us.
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "/**",
      },
    ],
    // A capture's cover changes about never; the default of a few minutes would
    // have the optimizer re-fetching and re-encoding the same frame all day.
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
};

export default nextConfig;
