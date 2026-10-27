// SPDX-License-Identifier: AGPL-3.0-only

import { nextJsConfig } from "@workspace/eslint-config/next-js"

/**
 * `next.config.mjs` is evaluated by Node, not by the browser, so it needs the
 * Node `process` global that the app code deliberately does not get.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default [
  ...nextJsConfig,
  {
    files: ["next.config.mjs"],
    languageOptions: { globals: { process: "readonly" } },
  },
]
