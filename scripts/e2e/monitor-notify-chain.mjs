// SPDX-License-Identifier: AGPL-3.0-only

/**
 * End-to-end monitor → threshold → notifier scenario (plan item 66).
 *
 * Run it directly for a transcript:
 *
 * ```bash
 * node --experimental-strip-types scripts/e2e/monitor-notify-chain.mjs
 * ```
 *
 * It is also a `node:test` file, so appending this path to
 * `scripts/release/test-manifest.mjs` makes CI run the same assertions.
 *
 * The chain starts at the scheduler, not at a hand-built context: a due job is
 * claimed and run through `EngineOperationDispatcher.run` and
 * `OperationExecutor`, the handler publishes through the real `EventPublisher`,
 * the delivery is claimed by `EventDispatchService.tick`, and the notifier run
 * is opened by that service's own `OperationExecutor`. The clock is advanced by
 * the test, never waited on, and no AWS, DingTalk or subprocess is involved.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import {
  MONITOR_NODE_ID,
  MONITOR_SAMPLE_INTERVAL_MS,
  NOTIFIER_NODE_ID,
  SECOND_NOTIFIER_NODE_ID,
  createMonitorChain,
} from "./lib/monitor-harness.mjs";

const THRESHOLD_EVENT = "counter.metric.threshold_crossed";

function advanceToNextSample(chain) {
  chain.advance(MONITOR_SAMPLE_INTERVAL_MS + 1);
}

async function fireOneSample(chain) {
  advanceToNextSample(chain);
  const tick = await chain.tickScheduler();
  assert.equal(tick.claimed, 1, "one due job is claimed");
  assert.equal(tick.fired, 1, "the job fires");
  assert.equal(tick.failed, 0);
  return tick;
}

function monitorRuns(chain) {
  return chain.runs.all().filter((run) => run.operationId === "counter.monitor.tick");
}

function notifierRuns(chain) {
  return chain.runs.all().filter((run) => run.operationId === "counter.notify");
}

function assertEveryDoneDeliveryHasRun(chain) {
  for (const delivery of chain.deliveries.all()) {
    if (delivery.status !== "done") continue;
    const runs = chain.runs
      .all()
      .filter((run) => run.deliveryId === delivery.id);
    assert.ok(
      runs.some((run) => run.status === "succeeded"),
      `delivery ${delivery.id} is done without a succeeded downstream run`,
    );
  }
}

test("a due job pulls a sample, publishes on a crossing, and the notifier run shares the correlation id", async () => {
  const chain = await createMonitorChain();

  const first = await fireOneSample(chain);
  assert.equal(first.fired, 1);
  assert.equal(
    chain.eventRows(THRESHOLD_EVENT).length,
    0,
    "a 42 reading under an 80 threshold is not an alert",
  );

  await fireOneSample(chain);
  const events = chain.eventRows(THRESHOLD_EVENT);
  assert.equal(events.length, 1, "the 91 reading crosses the threshold once");
  const event = events[0];

  const jobs = chain.jobs.all();
  assert.equal(jobs.length, 1, "the monitor type's schedule created the job");
  assert.equal(jobs[0].operationId, "counter.monitor.tick");

  const dispatch = await chain.tickDispatcher();
  assert.equal(dispatch.claimed, 1, "the threshold event scheduled one delivery");
  assert.equal(dispatch.rows.length, 1);
  assert.equal(dispatch.rows[0].kind, "done");

  const delivery = chain.deliveries.all()[0];
  assert.equal(delivery.status, "done");
  assert.equal(delivery.eventId, event.eventId);
  assert.equal(delivery.triggerId, "counter.notifier.on-threshold");
  assert.equal(delivery.targetKey, `node:${NOTIFIER_NODE_ID}`);

  const monitor = monitorRuns(chain).at(-1);
  const notifier = notifierRuns(chain).at(-1);
  assert.ok(monitor, "the scheduled monitor run exists");
  assert.ok(notifier, "the downstream notifier run exists");
  assert.equal(monitor.status, "succeeded");
  assert.equal(notifier.status, "succeeded");
  assert.equal(notifier.correlationId, monitor.correlationId);
  assert.equal(event.correlationId, monitor.correlationId);
  assert.equal(notifier.eventId, event.eventId);
  assert.equal(notifier.deliveryId, delivery.id);
  assert.equal(notifier.triggerId, "counter.notifier.on-threshold");

  const notifications = chain.notificationOf();
  assert.deepEqual(notifications, [
    {
      monitorId: MONITOR_NODE_ID,
      metric: 91,
      threshold: 80,
      source: "simulated",
      correlationId: monitor.correlationId,
      runId: notifier.id,
    },
  ]);

  assertEveryDoneDeliveryHasRun(chain);

  const linked = chain.runRows().filter(
    (run) =>
      run.id === monitor.id ||
      run.id === notifier.id,
  );
  console.log(
    `## operation_runs (one correlationId)\n${JSON.stringify(linked, null, 2)}`,
  );
  console.log(`## event\n${JSON.stringify(event, null, 2)}`);
  console.log(`## delivery\n${JSON.stringify(delivery, null, 2)}`);
});

test("stale state: a below-threshold sample fires the job but publishes nothing", async () => {
  const chain = await createMonitorChain();
  await fireOneSample(chain);
  await fireOneSample(chain);
  assert.equal(chain.eventRows(THRESHOLD_EVENT).length, 1);

  const before = chain.eventRows(THRESHOLD_EVENT).length;
  await fireOneSample(chain);
  assert.equal(chain.eventRows(THRESHOLD_EVENT).length, before, "55 is below 80");
  assert.equal(monitorRuns(chain).length, 3, "the job still ran");
  assert.equal(chain.deliveries.all().length, 1, "no delivery was added");
});

test("failure: removing the alert edge fans the same event type out to zero runs", async () => {
  const chain = await createMonitorChain();
  await fireOneSample(chain);
  await fireOneSample(chain);
  await chain.tickDispatcher();
  assert.equal(notifierRuns(chain).length, 1);
  const eventBefore = chain.eventRows(THRESHOLD_EVENT).length;

  chain.edges.remove(MONITOR_NODE_ID, NOTIFIER_NODE_ID);
  await fireOneSample(chain);
  assert.equal(chain.eventRows(THRESHOLD_EVENT).length, eventBefore, "55 is below the threshold");
  await fireOneSample(chain);
  const events = chain.eventRows(THRESHOLD_EVENT);
  assert.equal(events.length, eventBefore + 1, "the 93 reading still crosses");
  assert.equal(chain.deliveries.all().length, 1, "no edge means no delivery");

  const dispatch = await chain.tickDispatcher();
  assert.equal(dispatch.claimed, 0);
  assert.equal(notifierRuns(chain).length, 1, "zero downstream runs");
});

test("misleading output: a notifier write failure is not a done delivery", async () => {
  const chain = await createMonitorChain({ failWritesFor: [NOTIFIER_NODE_ID] });
  await fireOneSample(chain);
  await fireOneSample(chain);
  const dispatch = await chain.tickDispatcher();

  assert.equal(dispatch.claimed, 1);
  assert.notEqual(dispatch.rows[0].kind, "done", "a failed notifier is not success");
  const delivery = chain.deliveries.all()[0];
  assert.notEqual(delivery.status, "done");
  const run = notifierRuns(chain)[0];
  assert.equal(run.status, "failed");
  assert.match(run.error, /refused the write/);
  assert.equal(chain.notificationOf().length, 0);
  assertEveryDoneDeliveryHasRun(chain);
});

test("untrusted text: a hostile source label is stored as data, never executed", async () => {
  const source = "$(touch /tmp/dbrainx-pwned); <script>alert(1)</script>";
  const chain = await createMonitorChain({ source });
  await fireOneSample(chain);
  await fireOneSample(chain);
  await chain.tickDispatcher();

  const notifications = chain.notificationOf();
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].source, source);
  assert.equal(typeof notifications[0].source, "string");
  assert.equal(chain.eventRows(THRESHOLD_EVENT)[0].payload.source, source);
  assert.equal(existsSync("/tmp/dbrainx-pwned"), false);
});

test("long work: one failing downstream operation does not stop the tick", async () => {
  const chain = await createMonitorChain({
    edges: "fan-out",
    failWritesFor: [SECOND_NOTIFIER_NODE_ID],
  });
  await fireOneSample(chain);
  await fireOneSample(chain);
  assert.equal(chain.deliveries.all().length, 2, "the event reached two notifiers");

  const dispatch = await chain.tickDispatcher();
  assert.equal(dispatch.claimed, 2);
  const kinds = dispatch.rows.map((row) => row.kind).sort();
  assert.deepEqual(kinds, ["done", "retrying"]);

  const primary = chain.notificationOf(NOTIFIER_NODE_ID);
  const second = chain.notificationOf(SECOND_NOTIFIER_NODE_ID);
  assert.equal(primary.length, 1, "the healthy notifier still delivered");
  assert.equal(second.length, 0, "the failing notifier wrote nothing");
  assertEveryDoneDeliveryHasRun(chain);
});
