// SPDX-License-Identifier: AGPL-3.0-only

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: ["@workspace/ui", "@workspace/editor", "@workspace/dataview"],
  output: "standalone",
  outputFileTracingRoot: resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  experimental: { cpus: 2 },
  allowedDevOrigins: ["*.dev.yuqi-666.cn"],
  env: { NEXT_PUBLIC_DBRAINX_BACKEND_MODE: process.env.NODE_ENV === "production" ? "same-origin" : "direct" },
};
export default nextConfig;
