// SPDX-License-Identifier: AGPL-3.0-only

import { config } from "@workspace/eslint-config/react-internal"

/**
 * The fixture's components live in `.ts` modules so the type-stripping test run
 * can import them without a JSX transform, and `react/prop-types` cannot read a
 * TypeScript prop type outside `.tsx`: it reports every prop of every typed
 * component. The props are typed at the call site (`ComponentType<Props>`), so
 * the runtime check the rule asks for would be a second, weaker copy.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default [
  ...config,
  { files: ["**/*.ts"], rules: { "react/prop-types": "off" } },
]
