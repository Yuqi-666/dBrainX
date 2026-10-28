// SPDX-License-Identifier: AGPL-3.0-only

import { config } from "@workspace/eslint-config/base";
export default [
  ...config,
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/.next/**",
      "**/target/**",
      "**/runtime/**",
      "**/.runtime-staging/**",
      ".scratch/**",
      "apps/marketing/**",
      "**/public/pdfjs/**",
      "pb/pb_data/**",
      "pb/pb_migrations/**",
      "pb/pb_hooks/**",
    ],
  },
];
