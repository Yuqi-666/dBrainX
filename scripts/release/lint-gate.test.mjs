// SPDX-License-Identifier: AGPL-3.0-only

import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticCounts, newDiagnostics } from "./lint-gate.mjs";
test("lint gate rejects new or growing diagnostics and accepts reduced debt", () => {
  const result = (messages) => [
    { filePath: "/repo/apps/example.ts", messages },
  ];
  const message = {
    ruleId: "no-unused-vars",
    message: "unused identifier",
    severity: 1,
  };
  const baseline = diagnosticCounts(result([message]), "/repo");
  assert.equal(
    newDiagnostics(
      diagnosticCounts(result([message, message]), "/repo"),
      baseline,
    ).length,
    1,
  );
  assert.equal(newDiagnostics({}, baseline).length, 0);
  assert.equal(
    newDiagnostics(
      diagnosticCounts(result([{ ...message, ruleId: "other-rule" }]), "/repo"),
      baseline,
    ).length,
    1,
  );
  assert.throws(
    () => diagnosticCounts(result([{ ...message, fatal: true }]), "/repo"),
    /Invalid lint input/,
  );
});
