// SPDX-License-Identifier: AGPL-3.0-only

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setTimeout as pause } from "node:timers/promises";
import { stopRuntimeChild } from "../lib/stop-runtime-child.mjs";

function child(graceful) {
  const simulated = new EventEmitter();
  simulated.exitCode = null;
  simulated.signalCode = null;
  simulated.kills = 0;
  simulated.stdin = { end() {
    if (graceful) queueMicrotask(() => {
      simulated.exitCode = 0;
      simulated.emit("exit", 0, null);
    });
  } };
  simulated.kill = signal => {
    simulated.kills++;
    simulated.signalCode = signal;
    simulated.emit("exit", null, signal);
  };
  return simulated;
}
test("graceful shutdown retires its deadline before a new backend starts", async () => {
  const first = child(true);
  assert.deepEqual(await stopRuntimeChild(first, 10), [0, null]);
  const restarted = child(false);
  await pause(30);
  assert.equal(first.kills, 0, "completed process retains no kill timer");
  assert.equal(restarted.kills, 0);
  assert.equal(restarted.signalCode, null);
});
test("a forced shutdown remains a signal exit and cannot pass graceful acceptance", async () => {
  const stuck = child(false);
  assert.deepEqual(await stopRuntimeChild(stuck, 10), [null, "SIGKILL"]);
  assert.equal(stuck.kills, 1);
  assert.deepEqual(await stopRuntimeChild(stuck, 10), [null, "SIGKILL"]);
  assert.equal(stuck.kills, 1);
});
