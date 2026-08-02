import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Benchmark note: cacheComponents is deliberately OFF so the task does not
  // require Next 16-only APIs. Flip to true to raise the ceiling.
  images: { remotePatterns: [] },
};

export default nextConfig;
