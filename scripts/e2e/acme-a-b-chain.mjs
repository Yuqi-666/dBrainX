// SPDX-License-Identifier: AGPL-3.0-only

/**
 * End-to-end A/B chain scenario (plan item 67, design §4.7.5).
 *
 * Run it directly for a transcript:
 *
 * ```bash
 * node --experimental-strip-types scripts/e2e/acme-a-b-chain.mjs
 * ```
 *
 * It is also a `node:test` file, so the orchestrator can append this path to
 * `scripts/release/test-manifest.mjs` and CI runs the same assertions.
 *
 * Four modes are observed, and the report never mixes them:
 *
 * - `auto`: probe the host. A usable and stable MXC backend runs the script for
 *   real and asserts `exitCode === 0`; an unusable or crashing one asserts the
 *   `SANDBOX_UNAVAILABLE` refusal and a `failed` run.
 * - `fake`: the real adapter, guard and file store run against a fake `spawn`,
 *   which proves the chain wiring and the failure recording on a host whose
 *   native bridge cannot run. It is not evidence of isolation.
 * - `unavailable`: a host without a backend; the planner refuses.
 * - `escape`, `malformed`, `stale`, `nonzero`: adversarial inputs on `fake`.
 *
 * `ACME_ARTIFACTS=<dir>` writes the machine-readable rows of the `auto` run,
 * the capability matrix and the probe output for the evidence file.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { probeSandboxPlatform } from "../../backend/sandbox/src/mxc-support.ts";
import {
  ACME_SCRIPT_INVALID,
  ACME_SCRIPT_MAX_BYTES,
} from "../../plugins/counter/server/automation.ts";
import {
  A_NODE_ID,
  B2_NODE_ID,
  B_NODE_ID,
  createAcmeChain,
  pluginDirectory,
} from "./lib/acme-harness.mjs";

const probeScript = fileURLToPath(new URL("./lib/mxc-exec-probe.mjs", import.meta.url));
const ARTIFACTS = process.env.ACME_ARTIFACTS;

async function withChain(backend, work) {
  const storageRoot = await mkdtemp(join(tmpdir(), "dbrainx-acme-chain-"));
  const chain = await createAcmeChain({ backend, storageRoot });
  try {
    return await work(chain);
  } finally {
    await chain.close();
  }
}

async function runChain(chain, { correlationId, script, scriptName }) {
  if (script !== undefined) chain.setBNext(script === undefined ? {} : { script });
  if (scriptName !== undefined) chain.setBNext({ scriptName });
  const aResult = await chain.invokeA({ correlationId });
  const tick = await chain.tick();
  return { aResult, tick };
}

function runsOf(chain) {
  const all = chain.runs.all();
  const aRuns = all.filter((run) => run.operationId === "acme.a.fire");
  const bRuns = all.filter((run) => run.operationId === "acme.b.run");
  return {
    a: aRuns.at(-1),
    b: bRuns.at(-1),
    aRuns,
    bRuns,
    all,
  };
}

function callsOf(chain, runId) {
  return chain.sandboxRepository.calls().filter((call) => call.runId === runId);
}

function eventsOf(chain, eventType) {
  return chain.events.all().filter((event) => event.eventType === eventType);
}

async function writeArtifact(name, content) {
  if (ARTIFACTS === undefined) return;
  const path = join(ARTIFACTS, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function writeAdversarial(name, payload) {
  await writeArtifact(
    `adversarial-${name}.json`,
    JSON.stringify(payload, null, 2),
  );
}

/**
 * One real spawn in a child process. A native crash is an answer here, not a
 * scenario failure: the parent records the signal and refuses `real`.
 */
async function probeMxcSpawn({ timeoutMs = 20_000 } = {}) {
  const base = await mkdtemp(join(tmpdir(), "dbrainx-mxc-probe-"));
  const root = join(base, "sandbox");
  const resultFile = join(base, "probe.txt");
  let child;
  try {
    child = spawn(
      process.execPath,
      ["--experimental-strip-types", probeScript, root, resultFile],
      { stdio: "ignore" },
    );
    const exiter = new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ code: null, signal: "TIMEOUT" });
      }, timeoutMs);
    });
    const end = await Promise.race([exiter, deadline]);
    clearTimeout(timer);
    const output = await readFile(resultFile, "utf8").catch(() => "");
    return {
      stable: end.code === 0 && output.includes("MXC_PROBE_OK"),
      ...end,
      output,
    };
  } finally {
    child?.unref();
    await rm(base, { recursive: true, force: true }).catch(() => undefined);
  }
}

let detection;
async function detectBackend() {
  if (detection === undefined) {
    detection = (async () => {
      const support = await probeSandboxPlatform();
      if (support.status !== "available") {
        return { mode: "unavailable", support, probe: undefined };
      }
      const probe = await probeMxcSpawn();
      return { mode: probe.stable ? "real" : "unstable", support, probe };
    })();
  }
  return detection;
}

test("the fixture package passes the plugin host trust gate", async () => {
  await withChain("unavailable", async (chain) => {
    const entry = chain.snapshot.plugins.find((plugin) => plugin.id === "dbrainx.counter");
    assert.ok(entry, "the counter fixture is enabled from its signed manifest");
    assert.deepEqual(entry.nodeTypes, ["counter", "acme.a", "acme.b"]);
    assert.deepEqual(entry.triggers, ["acme.b.on-a-fired"]);
    assert.equal(chain.snapshot.operations.get("acme.a.fire")?.definition.target, "node");
    assert.equal(chain.snapshot.operations.get("acme.b.run")?.definition.target, "node");
    assert.equal(chain.triggers.list().length, 1);
    assert.equal(chain.triggers.list()[0].route.kind, "edge-follow");
    assert.equal(chain.manifest.id, "dbrainx.counter");
    assert.ok(pluginDirectory.endsWith(join("plugins", "counter")));
  });
});

test("auto: the real host mode decides between a real run and a named refusal", async (t) => {
  const { mode, support, probe } = await detectBackend();
  await writeArtifact("matrix.json", JSON.stringify(support, null, 2));
  if (probe !== undefined) {
    await writeArtifact(
      "mxc-probe.txt",
      `mode=${mode} code=${String(probe.code)} signal=${String(probe.signal)} stable=${String(probe.stable)}\n${probe.output}`,
    );
  }

  assert.equal(support.host.platform, process.platform);
  assert.equal(support.host.arch, process.arch);
  assert.ok(["available", "unavailable"].includes(support.status));

  await withChain(mode, async (chain) => {
    const intent = "intent-a-b-1";
    const script = "print('hello from A/B')\n";
    const { tick } = await runChain(chain, { correlationId: intent, script });
    assert.equal(tick.claimed, 1, "one delivery is claimed");
    assert.equal(tick.rows.length, 1);
    assert.equal(tick.rows[0].kind, mode === "real" ? "done" : "retrying");

    const { a, b } = runsOf(chain);
    assert.ok(a, "A's run row exists");
    assert.ok(b, "B's run row exists");
    assert.equal(a.status, "succeeded");
    assert.equal(a.correlationId, intent);

    const fired = eventsOf(chain, "acme.a.fired");
    assert.equal(fired.length, 1);
    assert.equal(fired[0].aggregateId, A_NODE_ID);
    assert.equal(fired[0].correlationId, intent);
    assert.equal(b.correlationId, fired[0].correlationId, "B's correlation id is the intent's");
    assert.equal(a.correlationId, b.correlationId, "both runs of the cascade share one correlation id");

    const bContent = chain.nodes.get(B_NODE_ID).content;
    const b2Content = chain.nodes.get(B2_NODE_ID).content;
    const calls = callsOf(chain, b.id);
    const exec = calls.find((call) => call.capability === "sandbox.exec");

    if (mode === "real") {
      assert.equal(b.status, "succeeded");
      assert.equal(b.output.exitCode, 0);
      assert.equal(bContent.lastRun.ok, true);
      assert.equal(bContent.lastRun.exitCode, 0);
      assert.equal(bContent.lastRun.runId, b.id);
      assert.equal(bContent.lastRun.scriptSha256.length, 64);
      assert.equal(exec.decision, "allowed");
      assert.equal(exec.exitCode, 0);
      assert.equal(b2Content.lastRun, undefined, "B2 was never reached");
      await writeArtifact("auto-backend.txt", "real: exitCode=0\n");
    } else {
      assert.equal(b.status, "failed", "the run failed instead of crashing the process");
      assert.match(b.error, mode === "unstable" ? /SANDBOX_UNAVAILABLE/ : /SANDBOX_UNAVAILABLE/);
      assert.equal(bContent.lastRun.ok, false);
      assert.equal(bContent.lastRun.exitCode, null);
      assert.equal(bContent.lastRun.errorCode, "SANDBOX_UNAVAILABLE");
      assert.equal(bContent.lastRun.runId, b.id);
      assert.equal(b2Content.lastRun, undefined, "B2 was never reached");
      assert.ok(exec, "the refused exec is audited");
      assert.equal(exec.decision, "denied");
      assert.equal(exec.errorCode, "SANDBOX_UNAVAILABLE");
      await writeArtifact(
        "auto-backend.txt",
        `${mode}: run failed with SANDBOX_UNAVAILABLE; ${
          mode === "unstable"
            ? "native bridge crashed on a probe spawn"
            : "the matrix reported no backend"
        }\n`,
      );
    }

    if (ARTIFACTS !== undefined) {
      await writeArtifact("auto-rows.json", JSON.stringify(chain.rows(), null, 2));
      const file = await chain.scriptFile();
      await writeArtifact(
        "auto-script.txt",
        file.content === undefined ? `missing: ${file.missing}` : `${file.path}\n${file.content}`,
      );
    }
  });
});

test("unavailable: the run answers SANDBOX_UNAVAILABLE and is failed, not crashed", async () => {
  await withChain("unavailable", async (chain) => {
    const { tick } = await runChain(chain, {
      correlationId: "intent-no-backend",
      script: "print('never runs here')\n",
    });
    assert.equal(tick.claimed, 1);
    assert.equal(tick.rows[0].kind, "retrying");

    const { a, b } = runsOf(chain);
    assert.equal(a.status, "succeeded");
    assert.equal(b.status, "failed");
    assert.match(b.error, /SANDBOX_UNAVAILABLE/);

    const lastRun = chain.nodes.get(B_NODE_ID).content.lastRun;
    assert.equal(lastRun.ok, false);
    assert.equal(lastRun.errorCode, "SANDBOX_UNAVAILABLE");
    assert.equal(lastRun.exitCode, null);
    assert.equal(lastRun.runId, b.id);

    const files = callsOf(chain, b.id).filter((call) => call.capability === "sandbox.fs.write");
    const exec = callsOf(chain, b.id).filter((call) => call.capability === "sandbox.exec");
    assert.equal(files.length, 1);
    assert.equal(files[0].decision, "allowed", "the file layer needs no backend");
    assert.equal(exec.length, 1);
    assert.equal(exec[0].decision, "denied");
    assert.equal(exec[0].errorCode, "SANDBOX_UNAVAILABLE");

    await writeArtifact("unavailable-rows.json", JSON.stringify(chain.rows(), null, 2));
  });
});

test("fake backend: B's script is written, executed and reported end to end", async () => {
  await withChain("fake", async (chain) => {
    const intent = "intent-happy";
    const script = "print('hello from A/B')\n";
    const { tick } = await runChain(chain, { correlationId: intent, script });
    assert.equal(tick.rows[0]?.kind, "done");

    const { a, b } = runsOf(chain);
    assert.equal(a.status, "succeeded");
    assert.equal(b.status, "succeeded");
    assert.equal(b.output.exitCode, 0);
    assert.equal(b.output.scriptPath, `nodes/${B_NODE_ID}/script.py`);

    const bContent = chain.nodes.get(B_NODE_ID).content;
    assert.equal(bContent.lastRun.ok, true);
    assert.equal(bContent.lastRun.exitCode, 0);
    assert.equal(bContent.lastRun.stdout, script);
    assert.equal(bContent.lastRun.stderr, "");
    assert.equal(bContent.lastRun.timedOut, false);
    assert.equal(bContent.lastRun.runId, b.id);
    assert.equal(bContent.lastRun.scriptSha256.length, 64);

    const file = await chain.scriptFile();
    assert.equal(file.content, script, "the executed file is the node's current script");

    const executed = eventsOf(chain, "acme.b.executed");
    assert.equal(executed.length, 1);
    assert.equal(executed[0].correlationId, eventsOf(chain, "acme.a.fired")[0].correlationId);
    assert.equal(executed[0].causationId, eventsOf(chain, "acme.a.fired")[0].eventId);
    assert.equal(executed[0].cascadeDepth, 1);

    const calls = callsOf(chain, b.id);
    assert.deepEqual(
      calls.map((call) => `${call.capability}:${call.decision}`).sort(),
      ["sandbox.exec:allowed", "sandbox.fs.write:allowed"],
    );
    const exec = calls.find((call) => call.capability === "sandbox.exec");
    assert.equal(exec.exitCode, 0);
    assert.equal(exec.stdoutBytes, Buffer.byteLength(script, "utf8"));
    assert.equal(exec.stderrBytes, 0);

    assert.equal(chain.nodes.get(B2_NODE_ID).content.lastRun, undefined);
    assert.equal(chain.runs.all().filter((run) => run.operationId === "acme.b.run").length, 1);

    await writeArtifact("fake-success-rows.json", JSON.stringify(chain.rows(), null, 2));
  });
});

test("untrusted text: the script crosses the boundary as one fixed argv, not a shell", async () => {
  await withChain("fake", async (chain) => {
    const hostile = "import os\nos.system('rm -rf /tmp/acme-canary')\nprint('hostile')\n";
    await writeFile(join(chain.storageRoot, "acme-canary"), "CANARY");
    await runChain(chain, { correlationId: "intent-hostile", script: hostile });

    assert.equal(chain.fake.requests.length, 1);
    const request = chain.fake.requests[0];
    assert.equal(request.command, "python3 -I script.py");
    assert.equal(request.containment.type, "bubblewrap");
    assert.equal(request.workingDirectory, join(chain.root, "nodes", B_NODE_ID));
    assert.deepEqual(request.filesystem.readwritePaths, [join(chain.root, "nodes")]);
    assert.equal(request.inheritDefaultEnvironment, false);
    assert.equal(request.network.egress.default, "deny");
    assert.equal(request.network.ingress.default, "deny");
    assert.equal(request.network.ingress.hostLoopback, "deny");
    assert.equal(request.environment.HOME, undefined);
    assert.equal(request.environment.DBRAINX_SECRET_KEY, undefined);

    assert.equal(
      await readFile(join(chain.storageRoot, "acme-canary"), "utf8"),
      "CANARY",
      "the hostile body never reaches the host filesystem",
    );
    const bRun = runsOf(chain).b;
    assert.equal(bRun.status, "succeeded", "the fake backend ran the file; only the request is asserted");

    await writeAdversarial("untrusted", {
      request,
      canary: await readFile(join(chain.storageRoot, "acme-canary"), "utf8"),
      run: bRun,
    });
  });
});

test("escape: a script path that leaves the node directory is SANDBOX_PATH_ESCAPE", async () => {
  await withChain("fake", async (chain) => {
    await writeFile(join(chain.storageRoot, "host-canary"), "HOST-CANARY");
    await runChain(chain, {
      correlationId: "intent-escape",
      script: "print('escaped?')\n",
      scriptName: "../../../../host-canary",
    });

    const { b } = runsOf(chain);
    assert.equal(b.status, "failed");
    assert.match(b.error, /SANDBOX_PATH_ESCAPE/);

    const lastRun = chain.nodes.get(B_NODE_ID).content.lastRun;
    assert.equal(lastRun.ok, false);
    assert.equal(lastRun.errorCode, "SANDBOX_PATH_ESCAPE");
    assert.equal(lastRun.exitCode, null);
    assert.equal(lastRun.scriptSha256, null);

    const denied = callsOf(chain, b.id);
    assert.equal(denied.length, 1, "the refused write is the only sandbox call");
    assert.equal(denied[0].capability, "sandbox.fs.write");
    assert.equal(denied[0].decision, "denied");
    assert.equal(denied[0].errorCode, "SANDBOX_PATH_ESCAPE");
    assert.match(denied[0].path, /\.\.\/\.\.\/\.\.\/\.\.\/host-canary$/);

    assert.equal(await readFile(join(chain.storageRoot, "host-canary"), "utf8"), "HOST-CANARY");
    const file = await chain.scriptFile();
    assert.equal(file.content, undefined, "no script byte was written");

    await writeAdversarial("escape", {
      run: b,
      lastRun,
      sandbox_calls: denied,
      canary: await readFile(join(chain.storageRoot, "host-canary"), "utf8"),
      script_file: file,
    });
  });
});

test("malformed script payloads are refused with ACME_SCRIPT_INVALID", async () => {
  const results = [];
  const cases = [
    ["empty", ""],
    ["non-string", 42],
    ["oversized", "x".repeat(ACME_SCRIPT_MAX_BYTES + 1)],
  ];
  for (const [label, script] of cases) {
    await withChain("fake", async (chain) => {
      await runChain(chain, { correlationId: `intent-${label}`, script });
      const { b } = runsOf(chain);
      assert.equal(b.status, "failed", label);
      assert.match(b.error, new RegExp(ACME_SCRIPT_INVALID), label);
      const lastRun = chain.nodes.get(B_NODE_ID).content.lastRun;
      assert.equal(lastRun.ok, false, label);
      assert.equal(lastRun.errorCode, ACME_SCRIPT_INVALID, label);
      assert.equal(lastRun.exitCode, null, label);
      assert.equal(callsOf(chain, b.id).length, 0, `${label} never reaches the sandbox`);
      results.push({
        label,
        status: b.status,
        error: b.error,
        lastRun,
        sandbox_calls: callsOf(chain, b.id),
      });
    });
  }
  await writeAdversarial("malformed", results);
});

test("stale state: a second run uses its own script, run id and sandbox calls", async () => {
  await withChain("fake", async (chain) => {
    const first = "print('first')\n";
    const second = "print('second')\n";

    await runChain(chain, { correlationId: "intent-first", script: first });
    const firstB = runsOf(chain).b;
    const firstRun = chain.nodes.get(B_NODE_ID).content.lastRun;

    await runChain(chain, { correlationId: "intent-second", script: second });
    const secondB = runsOf(chain).b;
    const secondRun = chain.nodes.get(B_NODE_ID).content.lastRun;

    assert.notEqual(firstB.id, secondB.id);
    assert.equal(firstRun.runId, firstB.id);
    assert.equal(secondRun.runId, secondB.id);
    assert.equal(firstRun.stdout, first);
    assert.equal(secondRun.stdout, second, "the second run never reuses the first result");
    assert.equal((await chain.scriptFile()).content, second);

    const firstCalls = callsOf(chain, firstB.id);
    const secondCalls = callsOf(chain, secondB.id);
    assert.equal(firstCalls.length, 2);
    assert.equal(secondCalls.length, 2);
    assert.deepEqual(
      secondCalls.map((call) => call.runId),
      [secondB.id, secondB.id],
      "no audit row is borrowed from the first run",
    );
    assert.equal(chain.sandboxRepository.files().length, 1, "one indexed path, overwritten in place");

    await writeAdversarial("stale", {
      first_run: firstB,
      second_run: secondB,
      first_lastRun: firstRun,
      second_lastRun: secondRun,
      first_calls: firstCalls,
      second_calls: secondCalls,
      script_file: await chain.scriptFile(),
    });
  });
});

test("misleading success output: a nonzero exit with empty stderr is a failed run", async () => {
  await withChain("fake", async (chain) => {
    await runChain(chain, {
      correlationId: "intent-nonzero",
      script: "# __ACME_FAIL__\n",
    });
    const { b } = runsOf(chain);
    assert.equal(b.status, "failed");
    assert.match(b.error, /exitCode=1/);
    assert.match(b.error, /ACME_SCRIPT_FAILED/);

    const lastRun = chain.nodes.get(B_NODE_ID).content.lastRun;
    assert.equal(lastRun.ok, false);
    assert.equal(lastRun.exitCode, 1);
    assert.equal(lastRun.stderr, "");
    assert.equal(lastRun.errorCode, "SANDBOX_EXEC_FAILED");

    const exec = callsOf(chain, b.id).find((call) => call.capability === "sandbox.exec");
    assert.equal(exec.decision, "allowed");
    assert.equal(exec.exitCode, 1);
    assert.equal(exec.stderrBytes, 0);
    assert.equal(exec.errorCode, "SANDBOX_EXEC_FAILED");

    await writeAdversarial("nonzero-empty-stderr", {
      run: b,
      lastRun,
      sandbox_calls: callsOf(chain, b.id),
    });
  });
});

test("timeout: the run and its lastRun record the timeout", async () => {
  await withChain("fake", async (chain) => {
    await runChain(chain, {
      correlationId: "intent-timeout",
      script: "# __ACME_TIMEOUT__\nsleep(1)\n",
    });
    const { b } = runsOf(chain);
    assert.equal(b.status, "failed");
    assert.match(b.error, /timedOut=true/);

    const lastRun = chain.nodes.get(B_NODE_ID).content.lastRun;
    assert.equal(lastRun.ok, false);
    assert.equal(lastRun.timedOut, true);
    assert.equal(lastRun.errorCode, "SANDBOX_TIMEOUT");

    const exec = callsOf(chain, b.id).find((call) => call.capability === "sandbox.exec");
    assert.equal(exec.errorCode, "SANDBOX_TIMEOUT");

    await writeAdversarial("timeout", {
      run: b,
      lastRun,
      sandbox_calls: callsOf(chain, b.id),
    });
  });
});

test("real MXC: exitCode 0 on a stable backend", async (t) => {
  const { mode, probe } = await detectBackend();
  if (mode !== "real") {
    t.skip(
      `SANDBOX_SPAWN_UNSTABLE: the native bridge did not complete a probe spawn (code=${String(
        probe?.code,
      )} signal=${String(probe?.signal)}); the exitCode===0 branch is unverified on this host`,
    );
    return;
  }
  await withChain("real", async (chain) => {
    const script = "print('hello from the real sandbox')\n";
    await runChain(chain, { correlationId: "intent-real", script });
    const { b } = runsOf(chain);
    assert.equal(b.status, "succeeded");
    assert.equal(b.output.exitCode, 0);
    const lastRun = chain.nodes.get(B_NODE_ID).content.lastRun;
    assert.equal(lastRun.ok, true);
    assert.equal(lastRun.exitCode, 0);
    assert.equal(lastRun.stdout.trim(), "hello from the real sandbox");
  });
});

