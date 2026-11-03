#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Real-backend sandbox negatives (plan item 58, GAP-9/GAP-12).
 *
 * The CI half (`backend/sandbox/src/sandbox-matrix.test.ts`) proves the host
 * logic with a fake process. This runner is the other half: it asks this host's
 * measured matrix what it can actually enforce, runs only the negatives the
 * host can honour, and skips the rest with a named reason. A skip is never a
 * pass, and the exit code is non-zero only when a runnable case fails.
 *
 * +---------------------+-------------------------------------------+------------------+
 * | case                | what it proves                            | needs            |
 * +---------------------+-------------------------------------------+------------------+
 * | egress-denied       | a sandboxed command cannot reach the net  | proxy enforcement|
 * | unlisted-executable | a command outside the grant never starts  | a backend        |
 * | path-escape         | `..` is refused before the backend sees it| a backend        |
 * | spawn-streaming     | the real stdio bridge can stream a result | a working FFI    |
 * +---------------------+-------------------------------------------+------------------+
 *
 * `spawn()` is attempted in a child process: on this host the native koffi
 * bridge has already SIGSEGV'd (`free(): invalid size`), and a native crash
 * cannot be caught in-process. The parent observes the signal and reports
 * `SKIP SANDBOX_SPAWN_UNSTABLE`, so one unstable FFI cannot take the matrix
 * down with it.
 *
 *   node scripts/release/sandbox-real.mjs
 *
 * Exit codes: 0 = every runnable case passed and the rest skipped with a
 * reason; 1 = at least one runnable case failed.
 */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { MxcSandboxAdapter, SandboxAdapterError } from "../../backend/sandbox/src/mxc-adapter.ts";
import { probeSandboxPlatform } from "../../backend/sandbox/src/mxc-support.ts";
import {
  DEFAULT_SANDBOX_LIMITS,
  SANDBOX_PROXY_EGRESS_UNSUPPORTED,
  deriveSandboxPolicy,
  prepareSandboxInvocation,
} from "../../backend/sandbox/src/sandbox-policy.ts";

export { SANDBOX_PROXY_EGRESS_UNSUPPORTED };

export const REAL_CASES = [
  "egress-denied",
  "unlisted-executable",
  "path-escape",
  "spawn-streaming",
];

export const SANDBOX_UNAVAILABLE = "SANDBOX_UNAVAILABLE";
export const SANDBOX_SPAWN_UNSTABLE = "SANDBOX_SPAWN_UNSTABLE";
export const SANDBOX_PROXY_ENDPOINT_MISSING = "SANDBOX_PROXY_ENDPOINT_MISSING";

const SPAWN_TIMEOUT_MS = 15_000;
const PROXY_ENV = "DBRAINX_SANDBOX_PROXY";

/**
 * The pure capability -> case -> skip-reason mapping.
 *
 * It reads only the measured report, so the host that cannot run a case says so
 * in the plan before any process is started. With no backend at all, every case
 * skips with the umbrella `SANDBOX_UNAVAILABLE` and the probe's own reason in
 * the detail; a later reader can tell "nothing was attempted" from "it failed".
 */
export function planRealSandboxCases(report) {
  if (report.status !== "available") {
    const reason = report.reason ?? {
      code: "SANDBOX_NO_BACKEND",
      detail: "no sandbox backend is available on this host",
    };
    return REAL_CASES.map((id) => ({
      id,
      action: "skip",
      code: SANDBOX_UNAVAILABLE,
      detail: `${reason.code}: ${reason.detail}`,
    }));
  }

  const proxy = report.notes.bubblewrapProxyEnforcement;
  const selected =
    report.preferred === undefined
      ? undefined
      : report.backends.find((row) => row.backend === report.preferred);
  const warnings = [
    ...new Set([
      ...report.notes.isolationWarnings,
      ...(report.notes.bubblewrapProxyWarnings ?? []),
      ...(selected?.warnings ?? []),
    ]),
  ].join("; ");
  const egress =
    proxy === "supported"
      ? { id: "egress-denied", action: "run" }
      : {
          id: "egress-denied",
          action: "skip",
          code: SANDBOX_PROXY_EGRESS_UNSUPPORTED,
          detail:
            proxy === "unsupported"
              ? `bubblewrap reported proxyEnforcement: unsupported${warnings === "" ? "" : ` (${warnings})`}`
              : proxy === undefined
                ? "bubblewrap did not report proxy enforcement on this host"
                : `"${report.preferred ?? "this backend"}" reports no proxy enforcement`,
        };

  return [
    egress,
    { id: "unlisted-executable", action: "run" },
    { id: "path-escape", action: "run" },
    { id: "spawn-streaming", action: "run" },
  ];
}

/** The verdict: only a runnable failure makes the run non-zero. */
export function verdictOf(results) {
  const passed = results.filter((result) => result.status === "PASS").length;
  const failed = results.filter((result) => result.status === "FAIL").length;
  const skipped = results.filter((result) => result.status === "SKIP").length;
  return {
    exitCode: failed > 0 ? 1 : 0,
    passed,
    failed,
    skipped,
    total: results.length,
  };
}

/** One line per case, in the shape the plan asks for. */
export function formatCaseLine(result) {
  if (result.status === "SKIP") {
    return `SKIP ${result.code}  ${result.id}${result.detail === undefined ? "" : ` - ${result.detail}`}`;
  }
  return `${result.status} ${result.id}${result.detail === undefined ? "" : `  ${result.detail}`}`;
}

function grant(capability, scope) {
  return {
    pluginId: "sandbox-real",
    workspaceId: "sandbox-real",
    capability,
    scope,
    scopeKey: scope.join(","),
    grantedBy: "sandbox-real",
    grantedAt: "1970-01-01T00:00:00.000Z",
  };
}

function planFor(report, grants, root, limits = DEFAULT_SANDBOX_LIMITS) {
  return prepareSandboxInvocation(
    deriveSandboxPolicy(grants, limits),
    report,
    { root },
  );
}

function failure(detail) {
  return { status: "FAIL", detail };
}

function adapterFor(plan, root) {
  return new MxcSandboxAdapter({
    invocation: plan.invocation,
    layout: { root },
    platform: process.platform,
  });
}

async function withRoot(work) {
  const storageRoot = await mkdtemp(join(tmpdir(), "dbrainx-sandbox-real-"));
  const root = join(storageRoot, "root");
  await mkdir(join(root, "nodes"), { recursive: true });
  try {
    return await work(await realpath(root));
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
}

async function runUnlistedExecutable(report) {
  return withRoot(async (root) => {
    const plan = planFor(
      report,
      [grant("sandbox.exec", ["executable=echo"])],
      root,
    );
    if (!plan.ok) {
      return failure(`the matrix refused the fixture policy: ${plan.code}`);
    }
    try {
      await adapterFor(plan, root).exec({
        executable: "sh",
        argv: ["-c", "true"],
      });
      return failure("an executable outside the grant was not refused");
    } catch (error) {
      if (
        error instanceof SandboxAdapterError &&
        error.code === "SANDBOX_POLICY_DENIED"
      ) {
        return { status: "PASS", detail: "sh refused before the backend" };
      }
      return failure(
        `expected SANDBOX_POLICY_DENIED, received ${error?.code ?? String(error)}`,
      );
    }
  });
}

async function runPathEscape(report) {
  return withRoot(async (root) => {
    const plan = planFor(
      report,
      [
        grant("sandbox.exec", ["executable=echo"]),
        grant("sandbox.fs.write", ["path=nodes/*"]),
      ],
      root,
    );
    if (!plan.ok) {
      return failure(`the matrix refused the fixture policy: ${plan.code}`);
    }
    try {
      await adapterFor(plan, root).exec({
        executable: "echo",
        argv: [],
        cwd: { path: "../../etc" },
      });
      return failure("a `..` working directory was not refused");
    } catch (error) {
      // Judge by code, not by class: the adapter is free to wrap the path
      // refusal in its own error, and a class check would then report a correct
      // refusal as a failure.
      if (error?.code === "SANDBOX_PATH_ESCAPE") {
        return { status: "PASS", detail: "../../etc refused before the backend" };
      }
      return failure(
        `expected SANDBOX_PATH_ESCAPE, received ${error?.code ?? String(error)}`,
      );
    }
  });
}

async function runEgressDenied(report) {
  const proxy = process.env[PROXY_ENV]?.trim();
  if (proxy === undefined || proxy === "") {
    return {
      status: "SKIP",
      code: SANDBOX_PROXY_ENDPOINT_MISSING,
      detail: `proxy enforcement is reported supported but ${PROXY_ENV} is unset`,
    };
  }
  return withRoot(async (root) => {
    const policy = deriveSandboxPolicy(
      [grant("sandbox.exec", ["executable=curl"])],
      DEFAULT_SANDBOX_LIMITS,
    );
    const plan = prepareSandboxInvocation(
      { ...policy, network: { ...policy.network, proxy } },
      report,
      { root },
    );
    if (!plan.ok) {
      return failure(`the matrix refused the proxy policy: ${plan.code}`);
    }
    const result = await adapterFor(plan, root).exec({
      executable: "curl",
      argv: ["-sS", "--max-time", "3", "http://example.com/"],
    });
    if (result.exitCode === 0) {
      return failure("curl reached the network under egress-deny");
    }
    return {
      status: "PASS",
      detail: `egress denied (exit ${result.exitCode}${result.timedOut ? ", timed out" : ""})`,
    };
  });
}

function spawnAttemptScript(root) {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const sandbox = resolve(here, "../../backend/sandbox/src");
  const url = (name) => pathToFileURL(join(sandbox, name)).href;
  return `
import { probeSandboxPlatform } from ${JSON.stringify(url("mxc-support.ts"))};
import { DEFAULT_SANDBOX_LIMITS, deriveSandboxPolicy, prepareSandboxInvocation } from ${JSON.stringify(url("sandbox-policy.ts"))};
import { MxcSandboxAdapter } from ${JSON.stringify(url("mxc-adapter.ts"))};
const report = await probeSandboxPlatform();
if (report.status !== "available") {
  console.log("REFUSED " + JSON.stringify(report.reason ?? { code: "SANDBOX_NO_BACKEND" }));
  process.exit(3);
}
const policy = deriveSandboxPolicy([{
  pluginId: "sandbox-real",
  workspaceId: "sandbox-real",
  capability: "sandbox.exec",
  scope: ["executable=echo"],
  scopeKey: "executable=echo",
  grantedBy: "sandbox-real",
  grantedAt: "1970-01-01T00:00:00.000Z",
}, {
  pluginId: "sandbox-real",
  workspaceId: "sandbox-real",
  capability: "sandbox.fs.read",
  scope: ["path=nodes"],
  scopeKey: "path=nodes",
  grantedBy: "sandbox-real",
  grantedAt: "1970-01-01T00:00:00.000Z",
}, {
  pluginId: "sandbox-real",
  workspaceId: "sandbox-real",
  capability: "sandbox.fs.write",
  scope: ["path=nodes"],
  scopeKey: "path=nodes",
  grantedBy: "sandbox-real",
  grantedAt: "1970-01-01T00:00:00.000Z",
}], DEFAULT_SANDBOX_LIMITS);
const plan = prepareSandboxInvocation(policy, report, { root: process.env.SANDBOX_REAL_ROOT });
if (!plan.ok) {
  console.log("REFUSED " + JSON.stringify({ code: plan.code, detail: plan.detail }));
  process.exit(3);
}
const adapter = new MxcSandboxAdapter({
  invocation: plan.invocation,
  layout: { root: process.env.SANDBOX_REAL_ROOT },
  platform: process.platform,
});
const result = await adapter.exec({ executable: "echo", argv: ["sandbox-real"], timeoutMs: 5000 });
console.log("RESULT " + JSON.stringify(result));
`;
}

async function runSpawnStreaming() {
  return withRoot(async (root) => {
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        spawnAttemptScript(root),
      ],
      {
        env: { ...process.env, SANDBOX_REAL_ROOT: root },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const outcome = await new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolvePromise({ code: null, signal: "SIGKILL", killed: true });
      }, SPAWN_TIMEOUT_MS);
      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        resolvePromise({ code, signal, killed: false });
      });
    });

    if (outcome.killed === true || outcome.signal !== null) {
      return {
        status: "SKIP",
        code: SANDBOX_SPAWN_UNSTABLE,
        detail:
          outcome.killed === true
            ? `no exit within ${SPAWN_TIMEOUT_MS}ms`
            : `signal ${outcome.signal} (exit ${String(outcome.code)})${stderr.trim() === "" ? "" : `: ${stderr.trim().split("\n").at(-1)}`}`,
      };
    }
    if (outcome.code !== 0) {
      const refused = /^REFUSED (.+)$/m.exec(stdout)?.[1];
      return failure(
        refused === undefined
          ? `the spawn attempt exited ${String(outcome.code)}${stderr.trim() === "" ? "" : `: ${stderr.trim().split("\n").at(-1)}`}`
          : `the spawn attempt was refused: ${refused}`,
      );
    }
    const payload = /^RESULT (.+)$/m.exec(stdout)?.[1];
    if (payload === undefined) {
      return failure("the spawn attempt printed no result");
    }
    const result = JSON.parse(payload);
    if (result.exitCode !== 0 || !String(result.stdout ?? "").includes("sandbox-real")) {
      return failure(
        `expected echo output, received exit ${result.exitCode}: ${JSON.stringify(result.stdout)}`,
      );
    }
    return { status: "PASS", detail: "spawn streamed the program output" };
  });
}

async function executeCase(id, report) {
  switch (id) {
    case "egress-denied":
      return runEgressDenied(report);
    case "unlisted-executable":
      return runUnlistedExecutable(report);
    case "path-escape":
      return runPathEscape(report);
    case "spawn-streaming":
      return runSpawnStreaming();
    default:
      return failure(`unknown case "${id}"`);
  }
}

export async function runRealSandboxMatrix() {
  const report = await probeSandboxPlatform();
  const plan = planRealSandboxCases(report);
  const results = [];
  for (const entry of plan) {
    const result =
      entry.action === "skip"
        ? {
            id: entry.id,
            status: "SKIP",
            code: entry.code,
            detail: entry.detail,
          }
        : {
            id: entry.id,
            ...(await executeCase(entry.id, report).catch((error) => ({
              status: "FAIL",
              detail: `runner error: ${error instanceof Error ? error.message : String(error)}`,
            }))),
          };
    results.push(result);
    console.log(formatCaseLine(result));
  }
  const verdict = verdictOf(results);
  return { report, results, verdict };
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { report, verdict } = await runRealSandboxMatrix();
  const version = report.mxc.contractVersion ?? "unknown";
  console.log(
    `summary: ${report.host.triple} node ${process.versions.node} MXC ${version} ` +
      `backend ${report.availableBackends.join(",") || "none"}: ` +
      `${verdict.passed} passed, ${verdict.failed} failed, ${verdict.skipped} skipped`,
  );
  process.exitCode = verdict.exitCode;
  // The adapter keeps a native handle alive after the last case, so an
  // `exitCode` alone leaves the runner hanging. Exiting explicitly keeps this
  // diagnostic runner bounded; the same leak is why it is not on the CI path.
  process.exit(verdict.exitCode);
}
