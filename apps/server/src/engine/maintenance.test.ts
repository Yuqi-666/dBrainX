// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RetentionRunResult } from "../../../../backend/application/src/engine/retention.service.ts";
import type { EngineMaintenanceConfig } from "./config.ts";
import { EngineMaintenance } from "./maintenance.ts";
import { EngineWorker, type EngineWorkerQueue } from "./worker.ts";

const CONFIG: EngineMaintenanceConfig = {
  intervalMs: 60_000,
  eventRetentionMs: 60_000,
  sandboxIdleMs: 60_000,
  batchSize: 2,
};

function result(overrides: Partial<RetentionRunResult> = {}): RetentionRunResult {
  return {
    startedAt: "2026-11-02T12:00:00.000Z",
    finishedAt: "2026-11-02T12:00:01.000Z",
    events: {
      retentionMs: 60_000,
      cutoff: "2026-11-02T11:59:00.000Z",
      candidates: 3,
      deleted: 2,
      skipped: 1,
      deliveriesDeleted: 4,
      truncated: true,
      rows: [
        { eventId: "e1", outcome: "deleted", deliveriesDeleted: 2, blockingStatuses: [] },
        { eventId: "e2", outcome: "deleted", deliveriesDeleted: 2, blockingStatuses: [] },
        {
          eventId: "e3",
          outcome: "skipped-referenced",
          deliveriesDeleted: 0,
          blockingStatuses: ["dead"],
        },
      ],
    },
    automationScopes: { scanned: 5, deleted: 1, orphanedAutomationIds: ["automation-gone"] },
    sandbox: {
      cutoff: "2026-11-01T12:00:00.000Z",
      expired: 1,
      filesSoftDeleted: 2,
      bytesReleased: 128,
      sandboxIds: ["sb-1"],
    },
    failures: [],
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function queue(claimed: number): EngineWorkerQueue {
  return {
    async tick() {
      return { claimed };
    },
  };
}

describe("engine maintenance", () => {
  it("joins the batch in flight instead of reclaiming the same rows twice", async () => {
    const gate = deferred<RetentionRunResult>();
    let runs = 0;
    const maintenance = new EngineMaintenance({
      service: {
        run() {
          runs += 1;
          return gate.promise;
        },
      },
      config: CONFIG,
      log: () => undefined,
    });

    const first = maintenance.runOnce();
    const second = maintenance.runOnce();
    assert.equal(runs, 1);
    assert.equal(maintenance.running, true);

    gate.resolve(result());
    const [a, b] = await Promise.all([first, second]);

    assert.equal(a, b);
    assert.equal(maintenance.running, false);
  });

  it("does not delay an engine tick while a cleanup batch is still running", async () => {
    const gate = deferred<RetentionRunResult>();
    const maintenance = new EngineMaintenance({
      service: { run: () => gate.promise },
      config: CONFIG,
      log: () => undefined,
    });
    const worker = new EngineWorker({
      config: {
        enabled: true,
        owner: "test-worker",
        pollMs: 500,
        idleBackoffMs: 1_000,
        idleBackoffMaxMs: 30_000,
        drainDeadlineMs: 50,
        scheduler: { limit: 10, leaseMs: 30_000, concurrency: 2 },
        dispatch: { limit: 20, leaseMs: 30_000, concurrency: 2, maxAttempts: 5 },
        maintenance: CONFIG,
      },
      scheduler: queue(1),
      dispatcher: queue(2),
      log: () => undefined,
    });

    void maintenance.runOnce();
    const tick = await worker.tick();

    assert.equal(tick.claimed, 3);
    assert.equal(maintenance.running, true, "the cleanup is still in flight");
    gate.resolve(result());
    await maintenance.stop();
  });

  it("logs one JSON line with the run's own counters", async () => {
    const lines: string[] = [];
    const maintenance = new EngineMaintenance({
      service: { run: async () => result() },
      config: CONFIG,
      log: (line) => lines.push(line),
    });

    await maintenance.runOnce();
    await Promise.resolve();

    assert.equal(lines.length, 1);
    const line = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.equal(line.event, "engine.cleanup");
    assert.equal(line.ok, true);
    assert.equal(line.deleted, 2);
    assert.equal(line.skipped, 1);
    assert.equal(line.deliveriesDeleted, 4);
    assert.equal(line.truncated, true);
    assert.equal(line.scopeRowsDeleted, 1);
    assert.equal(line.sandboxesExpired, 1);
  });

  it("reports a failed stage as ok:false and still rejects the caller", async () => {
    const lines: string[] = [];
    const maintenance = new EngineMaintenance({
      service: {
        run: async () =>
          result({
            events: { ...result().events, deleted: 0, candidates: 0 },
            failures: [{ stage: "events", message: "event_log is unreachable" }],
          }),
      },
      config: CONFIG,
      log: (line) => lines.push(line),
    });

    const outcome = await maintenance.runOnce();
    await Promise.resolve();

    assert.deepEqual(outcome.failures, [
      { stage: "events", message: "event_log is unreachable" },
    ]);
    assert.equal((JSON.parse(lines[0]!) as { ok: boolean }).ok, false);
  });

  it("stop waits for the batch that is already running", async () => {
    const gate = deferred<RetentionRunResult>();
    const maintenance = new EngineMaintenance({
      service: { run: () => gate.promise },
      config: CONFIG,
      log: () => undefined,
    });

    void maintenance.runOnce();
    let stopped = false;
    const stopping = maintenance.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    assert.equal(stopped, false);

    gate.resolve(result());
    await stopping;
    assert.equal(stopped, true);
    assert.equal(maintenance.running, false);
  });
});
