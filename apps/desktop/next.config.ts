// SPDX-License-Identifier: AGPL-3.0-only

import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  output: "export",
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: false,
  // Limit parallel prerender workers on development/build machines.
  experimental: { cpus: 2 },
  transpilePackages: [
    "@workspace/ui",
    "@workspace/editor",
    "@workspace/dataview",
  ],
  env: { NEXT_PUBLIC_DBRAINX_PLATFORM: "desktop" },
};

export default nextConfig;
