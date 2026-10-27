// SPDX-License-Identifier: AGPL-3.0-only

import { config } from "@workspace/eslint-config/react-internal";

/**
 * `@workspace/editor` is a React component library consumed by the Next.js
 * apps, not a Next.js app: it has no app router, no `next.config.*` and no
 * `next` dependency. It therefore uses the same shared React configuration as
 * the other workspace packages instead of `eslint-config-next`.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default [
  ...config,
  {
    rules: {
      // Every prop in this package is statically typed. The rule only reads
      // function parameter annotations, so it reports false positives for the
      // `React.FC<Props>` and `forwardRef<Element, Props>` components used
      // here (137 typed props). `tsc` already enforces these types.
      "react/prop-types": "off",
    },
  },
];
