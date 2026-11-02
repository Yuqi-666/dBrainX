// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One real MXC spawn, in its own process (plan item 67).
 *
 * The native bridge of this host aborts the process on `spawn` (`free():
 * invalid size`, SIGABRT) or SIGSEGVs, and a native crash cannot be caught
 * in-process. This probe is therefore a child: the scenario reads the exit
 * signal and refuses the `real` mode instead of taking the scenario down.
 *
 * Usage: node --experimental-strip-types mxc-exec-probe.mjs <sandbox-root>
 * Exit 0 with `MXC_PROBE_OK <result>`: a real exec ran.
 * Exit 1 with `MXC_PROBE_REFUSED <code>`: the matrix refused the fixture.
 * Killed by a signal: the native bridge crashed; the parent reports it.
 */

import { appendFile, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { MxcSandboxAdapter } from "../../../backend/sandbox/src/mxc-adapter.ts";
import { probeSandboxPlatform } from "../../../backend/sandbox/src/mxc-support.ts";
import {
  deriveSandboxPolicy,
  prepareSandboxInvocation,
} from "../../../backend/sandbox/src/sandbox-policy.ts";

const root = process.argv[2];
const resultFile = process.argv[3];

function report(line) {
  if (typeof resultFile === "string" && resultFile !== "") {
    return appendFile(resultFile, `${line}\n`);
  }
  console.log(line);
  return Promise.resolve();
}

function grant(capability, scope) {
  return {
    pluginId: "dbrainx.probe",
    workspaceId: "ws-probe",
    capability,
    scope,
    scopeKey: scope.join(","),
    grantedBy: "probe",
    grantedAt: "1970-01-01T00:00:00.000Z",
  };
}

async function probe() {
  if (typeof root !== "string" || root === "") {
    await report("MXC_PROBE_ERROR: a sandbox root path is required");
    return 2;
  }
  if (typeof resultFile === "string" && resultFile !== "") {
    await writeFile(resultFile, "MXC_PROBE_STARTED\n");
  }
  const support = await probeSandboxPlatform();
  if (support.status !== "available") {
    await report(
      `MXC_PROBE_REFUSED ${support.reason?.code ?? "SANDBOX_UNAVAILABLE"}: ${support.reason?.detail ?? ""}`,
    );
    return 1;
  }

  await mkdir(join(root, "nodes"), { recursive: true });
  const realRoot = await realpath(root);
  const policy = deriveSandboxPolicy([
    grant("sandbox.fs.read", ["path=nodes"]),
    grant("sandbox.fs.write", ["path=nodes"]),
    grant("sandbox.exec", ["executable=python3"]),
  ]);
  const plan = prepareSandboxInvocation(policy, support, { root: realRoot });
  if (!plan.ok) {
    await report(`MXC_PROBE_REFUSED ${plan.code}: ${plan.detail}`);
    return 1;
  }

  const adapter = new MxcSandboxAdapter({
    invocation: plan.invocation,
    layout: { root: realRoot },
  });
  const result = await adapter.exec({
    executable: "python3",
    argv: ["-I", "-c", "print('probe')"],
    cwd: { path: "nodes" },
    timeoutMs: 5_000,
  });
  await report(`MXC_PROBE_OK ${JSON.stringify(result)}`);
  return result.exitCode === 0 ? 0 : 1;
}

let code = 2;
try {
  code = await probe();
} catch (error) {
  await report(
    `MXC_PROBE_ERROR ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
  );
} finally {
  await rm(root ?? "", { recursive: true, force: true }).catch(() => undefined);
}
process.exitCode = code;
