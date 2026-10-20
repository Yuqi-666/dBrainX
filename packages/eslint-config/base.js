// SPDX-License-Identifier: AGPL-3.0-only

import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";
import onlyWarn from "eslint-plugin-only-warn";

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  {
    plugins: {
      onlyWarn,
    },
  },
  {
    // The pdf.js worker is copied into every app's `public/` tree by
    // scripts/lib/pdfjs-assets.mjs. It is generated, third-party and minified;
    // it is never hand-edited, so linting it only reports the minifier's names.
    ignores: ["dist/**", "**/public/pdfjs/**", "public/pdfjs/**"],
  },
];
