// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EngineConfig } from "./config.ts";
import { EngineWorker, backoffFor, type EngineWorkerQueue } from "./worker.ts";

const CONFIG: EngineConfig = {
  enabled: true,
  owner: "test-worker",
  pollMs: 500,
  idleBackoffMs: 1_000,
  idleBackoffMaxMs: 30_000,
  drainDeadlineMs: 50,
  scheduler: { limit: 10, leaseMs: 30_000, concurrency: 2 },
  dispatch: { limit: 20, leaseMs: 30_000, concurrency: 2, maxAttempts: 5 },
  maintenance: {
    intervalMs: 3_600_000,
    eventRetentionMs: 604_800_000,
    sandboxIdleMs: 604_800_000,
    batchSize: 100,
  },
};

/** A queue that answers the same claim count forever. */
function queue(claimed: number): EngineWorkerQueue {
  return { async tick() { return { claimed }; } };
}

/** Resolves once `count` sleeps have been observed; no wall-clock waiting. */
function signalAfter(count: number) {
  const sleeps: number[] = [];
  let resolve: () => void = () => {};
  const reached = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    sleeps,
    reached,
    sleep: async (ms: number): Promise<void> => {
      sleeps.push(ms);
      if (sleeps.length >= count) resolve();
    },
  };
}

describe("the idle loop backs off instead of spinning", () => {
  it("records the doubling delays of five empty cycles", async () => {
    const recorder = signalAfter(5);
    const worker = new EngineWorker({
      config: CONFIG,
      scheduler: queue(0),
      dispatcher: queue(0),
      sleep: recorder.sleep,
      log: () => {},
    });

    worker.start();
    await recorder.reached;
    const drain = await worker.stop();

    assert.deepEqual(recorder.sleeps.slice(0, 5), [1_000, 2_000, 4_000, 8_000, 16_000]);
    assert.equal(worker.status().idleTicks >= 5, true);
    assert.equal(drain.drained, true);
  });

  it("caps the delay at idleBackoffMaxMs", () => {
    assert.equal(backoffFor(CONFIG, 1), 1_000);
    assert.equal(backoffFor(CONFIG, 2), 2_000);
    assert.equal(backoffFor(CONFIG, 6), 30_000);
    assert.equal(backoffFor(CONFIG, 60), 30_000);
  });

  it("waits the poll interval after a cycle that claimed work", async () => {
    const recorder = signalAfter(3);
    const worker = new EngineWorker({
      config: CONFIG,
      scheduler: queue(1),
      dispatcher: queue(1),
      sleep: recorder.sleep,
      log: () => {},
    });

    worker.start();
    await recorder.reached;
    await worker.stop();

    assert.deepEqual(recorder.sleeps.slice(0, 3), [500, 500, 500]);
    assert.deepEqual(worker.status().backoffMs, []);
  });
});

describe("one queue cannot stall the other", () => {
  it("serves the delivery queue while a job tick is hung, and reports the drain honestly", async () => {
    let deliveries = 0;
    let release: () => void = () => {};
    const reached = new Promise<void>((done) => {
      release = done;
    });
    const worker = new EngineWorker({
      config: CONFIG,
      scheduler: { tick: () => new Promise(() => {}) },
      dispatcher: {
        async tick() {
          deliveries += 1;
          release();
          return { claimed: 0 };
        },
      },
      sleep: async () => {},
      log: () => {},
    });

    worker.start();
    await reached;
    assert.equal(deliveries, 1);

    const drain = await worker.stop();
    assert.equal(drain.drained, false);
    assert.equal(drain.pending, 1);
  });

  it("keeps looping after a tick rejects", async () => {
    const recorder = signalAfter(2);
    const worker = new EngineWorker({
      config: CONFIG,
      scheduler: {
        async tick() {
          throw new Error("the job queue is unreachable");
        },
      },
      dispatcher: queue(0),
      sleep: recorder.sleep,
      log: () => {},
    });

    worker.start();
    await recorder.reached;
    await worker.stop();

    assert.match(worker.lastError ?? "", /job queue is unreachable/);
  });
});

describe("shutdown", () => {
  it("drains idle in-flight work and can be called twice", async () => {
    const recorder = signalAfter(1);
    const worker = new EngineWorker({
      config: CONFIG,
      scheduler: queue(0),
      dispatcher: queue(0),
      sleep: recorder.sleep,
      log: () => {},
    });

    worker.start();
    await recorder.reached;
    const first = await worker.stop();
    const second = await worker.stop();

    assert.deepEqual(first, { drained: true, pending: 0, waitedMs: first.waitedMs });
    assert.equal(second.drained, true);
    assert.equal(second.pending, 0);
    assert.equal(worker.status().running, false);
  });
});
