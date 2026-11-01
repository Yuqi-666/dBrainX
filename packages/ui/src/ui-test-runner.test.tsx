// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Proves `scripts/run-ui-tests.mjs` really transforms JSX.
 *
 * `node --experimental-strip-types` erases types but leaves JSX in place, so if
 * the runner ever stopped calling esbuild this file could not even load. The
 * assertion is on rendered HTML rather than on a type or a snapshot: a string
 * containing the rendered text can only exist after JSX became `jsx()` calls.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

function RunnerProof({ label }: { label: string }) {
  return <p data-proof="ui-test-runner">{label}</p>;
}

test("the UI test runner transforms JSX before node runs the file", () => {
  const html = renderToStaticMarkup(<RunnerProof label="jsx was transformed" />);
  assert.equal(html, '<p data-proof="ui-test-runner">jsx was transformed</p>');
});
