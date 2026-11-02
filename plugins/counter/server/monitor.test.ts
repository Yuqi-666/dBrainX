// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The monitor fixture declarations and handlers (plan item 66).
 *
 * These cases pin the two facts the end-to-end scenario relies on: a sample
 * below the threshold writes activity but publishes nothing, and the notifier
 * copies a payload into its channel without interpreting it. The chain itself
 * is proved by `scripts/e2e/monitor-notify-chain.mjs`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { Validator } from "@cfworker/json-schema";
import type { Schema } from "@cfworker/json-schema";

import {
  COUNTER_METRIC_THRESHOLD_CROSSED,
  MONITOR_ALERT_EDGE_SEMANTIC,
  MONITOR_INVALID,
  NOTIFY_INVALID,
  MonitorFixtureError,
  counterMonitorTick,
  counterNotify,
  createMonitorContent,
  createNotifierContent,
  monitorNodeType,
  monitorNodeTypes,
  monitorOperations,
  monitorTriggers,
  notifierNodeType,
  notifierTrigger,
} from "./monitor.ts";

function validate(schema: unknown, input: unknown) {
  return new Validator(schema as Schema, "2020-12").validate(input);
}

function fixtureContext(content: unknown, options: { failWrite?: boolean } = {}) {
  const writes: Array<{ nodeId: string; content: unknown }> = [];
  const emitted: Array<{ eventType: string; payload: unknown; options: unknown }> = [];
  return {
    writes,
    emitted,
    context: {
      node: { id: "node-monitor", content },
      correlationId: "intent-1",
      runId: "run-1",
      eventId: undefined,
      writeNode: async (nodeId: string, patch: { content: unknown }) => {
        if (options.failWrite === true) throw new Error("write refused");
        writes.push({ nodeId, content: patch.content });
      },
      emit: async (eventType: string, payload: unknown, emitOptions: unknown) => {
        emitted.push({ eventType, payload, options: emitOptions });
        return { eventId: `event-${emitted.length}` };
      },
    },
  };
}

test("the monitor fixture declares a scheduled monitor and an edge-follow notifier", () => {
  assert.deepEqual(
    monitorNodeTypes.map((definition) => definition.type),
    ["counter.monitor", "counter.notifier"],
  );
  assert.deepEqual(
    monitorOperations.map((definition) => definition.id),
    ["counter.monitor.tick", "counter.notify"],
  );
  assert.deepEqual(
    monitorNodeType.schedules?.map((schedule) => schedule.operationId),
    ["counter.monitor.tick"],
  );
  assert.deepEqual([...notifierNodeType.operations], ["counter.notify"]);
  assert.equal(validate(monitorNodeType.schema, createMonitorContent()).valid, true);
  assert.equal(validate(notifierNodeType.schema, createNotifierContent()).valid, true);

  assert.equal(notifierTrigger.id, "counter.notifier.on-threshold");
  assert.equal(notifierTrigger.event, COUNTER_METRIC_THRESHOLD_CROSSED);
  assert.equal(notifierTrigger.operation, "counter.notify");
  assert.equal(notifierTrigger.route.kind, "edge-follow");
  assert.equal(notifierTrigger.route.edgeSemantic, MONITOR_ALERT_EDGE_SEMANTIC);
  assert.deepEqual(notifierTrigger.target, {
    kind: "node-type",
    nodeType: "counter.notifier",
  });
  assert.deepEqual(monitorTriggers, [notifierTrigger]);
});

test("a sample below the threshold records activity and emits nothing", async () => {
  const { context, writes, emitted } = fixtureContext({
    source: "simulated",
    threshold: 80,
    samples: [42],
    cursor: 0,
    lastSample: null,
  });

  const result = await counterMonitorTick({}, context);

  assert.deepEqual(result, { sampled: true, sample: 42, crossed: false, cursor: 1 });
  assert.equal(emitted.length, 0, "an in-range metric is not an alert");
  assert.deepEqual(writes, [
    {
      nodeId: "node-monitor",
      content: {
        source: "simulated",
        threshold: 80,
        samples: [42],
        cursor: 1,
        lastSample: 42,
      },
    },
  ]);
});

test("a crossing publishes the metric and threshold as data", async () => {
  const { context, emitted } = fixtureContext({
    source: "simulated",
    threshold: 80,
    samples: [42, 91],
    cursor: 1,
    lastSample: 42,
  });

  const result = await counterMonitorTick({}, context);

  assert.deepEqual(result, { sampled: true, sample: 91, crossed: true, cursor: 2 });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.eventType, COUNTER_METRIC_THRESHOLD_CROSSED);
  assert.deepEqual(emitted[0]?.payload, {
    sourceNodeId: "node-monitor",
    monitorId: "node-monitor",
    metric: 91,
    threshold: 80,
    source: "simulated",
  });
  assert.deepEqual(emitted[0]?.options, {
    correlationId: "intent-1",
    causationId: null,
    cascadeDepth: 0,
  });
});

test("an exhausted sample list and a malformed threshold are named refusals", async () => {
  const exhausted = fixtureContext({
    source: "simulated",
    threshold: 80,
    samples: [42],
    cursor: 1,
    lastSample: 42,
  });
  assert.deepEqual(await counterMonitorTick({}, exhausted.context), {
    sampled: false,
    sample: null,
    crossed: false,
    cursor: 1,
  });
  assert.equal(exhausted.emitted.length, 0);

  const malformed = fixtureContext({
    source: "simulated",
    threshold: "80",
    samples: [42],
    cursor: 0,
  });
  await assert.rejects(
    () => counterMonitorTick({}, malformed.context),
    (error: unknown) =>
      error instanceof MonitorFixtureError && error.code === MONITOR_INVALID,
  );
});

test("the notifier records the payload verbatim, including a hostile source label", async () => {
  const source = "$(touch /tmp/dbrainx-pwned); <script>alert(1)</script>";
  const { context, writes, emitted } = fixtureContext(createNotifierContent());

  const result = await counterNotify(
    { monitorId: "node-monitor", metric: 91, threshold: 80, source },
    context,
  );

  assert.deepEqual(result, {
    delivered: 1,
    channel: "fixture-channel",
    total: 1,
  });
  assert.equal(emitted.length, 0, "recording a notification is not an event");
  const content = writes[0]?.content as {
    channel: string;
    notifications: Array<Record<string, unknown>>;
  };
  assert.equal(content.channel, "fixture-channel");
  assert.deepEqual(content.notifications, [
    {
      monitorId: "node-monitor",
      metric: 91,
      threshold: 80,
      source,
      correlationId: "intent-1",
      runId: "run-1",
    },
  ]);
  assert.equal(typeof content.notifications[0]?.source, "string");
});

test("a non-numeric metric is refused by code instead of being coerced", async () => {
  const { context } = fixtureContext(createNotifierContent());
  await assert.rejects(
    () =>
      counterNotify(
        { monitorId: "node-monitor", metric: "91", threshold: 80, source: "simulated" },
        context,
      ),
    (error: unknown) =>
      error instanceof MonitorFixtureError && error.code === NOTIFY_INVALID,
  );
});

test("a notifier write failure is surfaced, not swallowed as delivery", async () => {
  const { context } = fixtureContext(createNotifierContent(), { failWrite: true });
  await assert.rejects(() =>
    counterNotify(
      { monitorId: "node-monitor", metric: 91, threshold: 80, source: "simulated" },
      context,
    ),
  );
});
