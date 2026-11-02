// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The pure half of `sandbox-real.mjs` (plan item 58): capability -> case ->
 * skip reason, plus verdict aggregation.
 *
 * These cases pin the rules the runner must never bend: a missing capability is
 * a named skip, not a pass; a skip never makes the run non-zero; a failing
 * runnable case always does. The process-driven cases live in the runner and
 * are not exercised here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { probeSandboxPlatform } from "../../backend/sandbox/src/mxc-support.ts";
import {
  REAL_CASES,
  SANDBOX_PROXY_EGRESS_UNSUPPORTED,
  SANDBOX_SPAWN_UNSTABLE,
  SANDBOX_UNAVAILABLE,
  formatCaseLine,
  planRealSandboxCases,
  verdictOf,
} from "./sandbox-real.mjs";

async function reportOf(options) {
  const backends = options.backends;
  const module = {
    SDK_CONTRACT_VERSION: "sandbox-real-test",
    getAvailableBackends: () => backends,
    getPlatformSupport: () => ({
      isSupported: backends.length > 0,
      reason: backends.length > 0 ? "" : "no sandbox backend on this host",
      availableMethods: backends
        .map((entry) => entry.backend)
        .filter((backend) => backend !== "unknown"),
      ...(options.proxy === undefined
        ? {}
        : {
            bubblewrapNetwork: {
              proxyEnforcement: options.proxy,
              warnings:
                options.proxy === "unsupported"
                  ? ["runtimeConfig.networkProxy requires 'slirp4netns' on PATH"]
                  : [],
            },
          }),
    }),
  };
  return probeSandboxPlatform({
    platform: "linux",
    arch: "arm64",
    node: "sandbox-real-test",
    env: {},
    loadModule: async () => module,
  });
}

const bubblewrap = { backend: "bubblewrap", capabilities: [], warnings: [] };

describe("the capability plan", () => {
  it("runs every case when the host reports the full matrix", async () => {
    const report = await reportOf({ backends: [bubblewrap], proxy: "supported" });
    const plan = planRealSandboxCases(report);

    assert.deepEqual(
      plan.map((entry) => entry.id),
      REAL_CASES,
    );
    assert.deepEqual(
      plan.map((entry) => entry.action),
      ["run", "run", "run", "run"],
    );
  });

  it("skips denied egress with the named proxy reason when enforcement is absent", async () => {
    const report = await reportOf({
      backends: [bubblewrap],
      proxy: "unsupported",
    });
    const plan = planRealSandboxCases(report);
    const egress = plan.find((entry) => entry.id === "egress-denied");

    assert.ok(egress);
    assert.equal(egress.action, "skip");
    assert.equal(egress.code, SANDBOX_PROXY_EGRESS_UNSUPPORTED);
    assert.match(egress.detail, /slirp4netns/);
    assert.deepEqual(
      plan.filter((entry) => entry.action === "run").map((entry) => entry.id),
      ["unlisted-executable", "path-escape", "spawn-streaming"],
    );
  });

  it("skips every case with SANDBOX_UNAVAILABLE and the probe reason on a backend-less host", async () => {
    const report = await reportOf({ backends: [] });
    const plan = planRealSandboxCases(report);

    assert.equal(report.status, "unavailable");
    assert.equal(plan.length, REAL_CASES.length);
    for (const entry of plan) {
      assert.equal(entry.action, "skip");
      assert.equal(entry.code, SANDBOX_UNAVAILABLE);
      assert.match(entry.detail, /SANDBOX_NO_BACKEND/);
      assert.match(entry.detail, /no sandbox backend on this host/);
    }
  });
});

describe("the verdict", () => {
  it("is zero when runnable cases pass and the rest skip with a reason", () => {
    const verdict = verdictOf([
      {
        id: "egress-denied",
        status: "SKIP",
        code: SANDBOX_PROXY_EGRESS_UNSUPPORTED,
        detail: "slirp4netns is absent",
      },
      { id: "unlisted-executable", status: "PASS" },
      { id: "path-escape", status: "PASS" },
      { id: "spawn-streaming", status: "PASS" },
    ]);

    assert.deepEqual(verdict, {
      exitCode: 0,
      passed: 3,
      failed: 0,
      skipped: 1,
      total: 4,
    });
  });

  it("is non-zero when one runnable case fails", () => {
    const verdict = verdictOf([
      { id: "unlisted-executable", status: "FAIL", detail: "sh was allowed" },
      { id: "path-escape", status: "PASS" },
    ]);

    assert.equal(verdict.exitCode, 1);
    assert.equal(verdict.failed, 1);
    assert.equal(verdict.passed, 1);
  });

  it("keeps an unstable native bridge a skip, not a failure", () => {
    const line = formatCaseLine({
      id: "spawn-streaming",
      status: "SKIP",
      code: SANDBOX_SPAWN_UNSTABLE,
      detail: "signal SIGSEGV (exit 139)",
    });

    assert.equal(
      line,
      "SKIP SANDBOX_SPAWN_UNSTABLE  spawn-streaming - signal SIGSEGV (exit 139)",
    );
    assert.equal(verdictOf([{ id: "spawn-streaming", status: "SKIP" }]).exitCode, 0);
  });

  it("prints PASS and FAIL without a reason code", () => {
    assert.equal(formatCaseLine({ id: "path-escape", status: "PASS" }), "PASS path-escape");
    assert.equal(
      formatCaseLine({ id: "path-escape", status: "FAIL", detail: "not refused" }),
      "FAIL path-escape  not refused",
    );
  });
});
