// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The monitor → threshold → notifier fixture (plan item 66).
 *
 * This is a fixture, not a product feature. It exists to prove the chain a
 * scheduled job starts:
 *
 * ```text
 * counter.monitor.tick (job)
 *   -> simulated sample crosses the threshold
 *      -> counter.metric.threshold_crossed
 *         -> counter.notifier.on-threshold (edge-follow: counter.alerts)
 *            -> counter.notify (node write on the reached notifier)
 * ```
 *
 * The definitions are built with `@workspace/plugin-sdk` and contribute to the
 * counter fixture package. They are exported separately from the package's
 * `nodeTypes` / `operations` / `triggers` lists because those lists are the
 * frozen item-67 contract: the A/B scenario asserts exactly three node types
 * and one trigger, and item 66 may not move that contract. The scenario and
 * the served-engine composition mount these definitions directly.
 *
 * The monitor pulls a sample from its own `content.samples`. Nothing here
 * reaches AWS, DingTalk, or any network: the "metric source" is a list of
 * numbers, and the "channel" is the notifier node's own content. A payload is
 * data — the notifier copies strings into its record and never interprets
 * them.
 */

import type {
  JsonSchema,
  OperationDefinition,
  ScheduleDefinition,
  TriggerDefinitionShape,
} from "@workspace/plugin-sdk";
import {
  defineNodeType,
  defineOperationDefinition,
  defineTrigger,
} from "@workspace/plugin-sdk";

import { counterPluginId } from "../plugin-id.ts";

/** The event the monitor publishes when a sample crosses the threshold. */
export const COUNTER_METRIC_THRESHOLD_CROSSED =
  "counter.metric.threshold_crossed";
/** The `edge_semantics` record id the notifier trigger follows from the monitor. */
export const MONITOR_ALERT_EDGE_SEMANTIC = "ctralertsedge01";
/** The fixture's default channel; it is a node field, never a transport. */
export const MONITOR_DEFAULT_CHANNEL = "fixture-channel";
/** The cadence a monitor node schedules; the scenario ticks the loop by hand. */
export const MONITOR_SAMPLE_INTERVAL_MS = 1_000;

/** A monitor sample or threshold is missing, non-numeric, or otherwise unfit. */
export const MONITOR_INVALID = "MONITOR_INVALID" as const;
/** A notification the trigger dispatched is missing the data it carries. */
export const NOTIFY_INVALID = "NOTIFY_INVALID" as const;

export type MonitorErrorCode = typeof MONITOR_INVALID | typeof NOTIFY_INVALID;

/** A refusal a caller switches on by `code`, never by message. */
export class MonitorFixtureError extends Error {
  readonly code: MonitorErrorCode;

  constructor(code: MonitorErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "MonitorFixtureError";
    this.code = code;
  }
}

/** What a monitor keeps: the simulated source, the cursor and the last read. */
export interface MonitorContent {
  /** A label for the simulated source; carried as data, never evaluated. */
  readonly source: string;
  readonly threshold: number;
  readonly samples: readonly number[];
  /** How many samples have been pulled; the next sample is `samples[cursor]`. */
  readonly cursor: number;
  /** The previous reading, so crossing is a transition and not just a level. */
  readonly lastSample?: number | null;
}

/** One row a notifier keeps in its fixture channel. */
export interface MonitorNotification {
  readonly monitorId: string;
  readonly metric: number;
  readonly threshold: number;
  readonly source: string;
  readonly correlationId: string;
  readonly runId: string | null;
}

/** What a notifier keeps: the channel name and every delivered record. */
export interface NotifierContent {
  readonly channel: string;
  readonly notifications: readonly MonitorNotification[];
}

/** The host ports the fixture handlers run against. */
export interface MonitorContext {
  readonly node?: { readonly id: string; readonly content: unknown };
  readonly correlationId: string;
  readonly runId?: string;
  writeNode(nodeId: string, patch: { readonly content: unknown }): Promise<void>;
  emit(eventType: string, payload: unknown): Promise<void>;
}

export const monitorSchema: JsonSchema = {
  type: "object",
  required: ["source", "threshold", "samples", "cursor"],
  properties: {
    source: { type: "string" },
    threshold: { type: "number" },
    samples: { type: "array", items: { type: "number" } },
    cursor: { type: "integer", minimum: 0 },
    lastSample: { type: ["number", "null"] },
  },
  additionalProperties: false,
};

export const notifierSchema: JsonSchema = {
  type: "object",
  required: ["channel", "notifications"],
  properties: {
    channel: { type: "string" },
    notifications: {
      type: "array",
      items: {
        type: "object",
        required: ["monitorId", "metric", "threshold", "source", "correlationId", "runId"],
        properties: {
          monitorId: { type: "string" },
          metric: { type: "number" },
          threshold: { type: "number" },
          source: { type: "string" },
          correlationId: { type: "string" },
          runId: { type: ["string", "null"] },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

export function createMonitorContent(): MonitorContent {
  return {
    source: "simulated",
    threshold: 80,
    samples: [42, 91],
    cursor: 0,
    lastSample: null,
  };
}

export function createNotifierContent(): NotifierContent {
  return { channel: MONITOR_DEFAULT_CHANNEL, notifications: [] };
}

export const monitorNodeType = defineNodeType<MonitorContent>({
  type: "counter.monitor",
  version: 1,
  pluginId: counterPluginId,
  schema: monitorSchema,
  defaultContent: createMonitorContent,
  display: { label: "Metric monitor (fixture)", icon: "Activity" },
  operations: ["counter.monitor.tick"],
  schedules: [
    {
      id: "counter.monitor.sample",
      operationId: "counter.monitor.tick",
      intervalMs: MONITOR_SAMPLE_INTERVAL_MS,
      enabledByDefault: true,
    } satisfies ScheduleDefinition,
  ],
});

export const notifierNodeType = defineNodeType<NotifierContent>({
  type: "counter.notifier",
  version: 1,
  pluginId: counterPluginId,
  schema: notifierSchema,
  defaultContent: createNotifierContent,
  display: { label: "Notification channel (fixture)", icon: "Bell" },
  operations: ["counter.notify"],
});

export const monitorTickOperation: OperationDefinition =
  defineOperationDefinition({
    id: "counter.monitor.tick",
    pluginId: counterPluginId,
    exportName: "counterMonitorTick",
    target: "node",
    appliesTo: { nodeTypes: ["counter.monitor"] },
    effect: "invoke",
    reach: "self",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiredCapabilities: ["node.write", "event.emit"],
    idempotent: true,
  });

export const notifyOperation: OperationDefinition = defineOperationDefinition({
  id: "counter.notify",
  pluginId: counterPluginId,
  exportName: "counterNotify",
  target: "node",
  appliesTo: { nodeTypes: ["counter.notifier"] },
  effect: "invoke",
  reach: "self",
  inputSchema: {
    type: "object",
    required: ["monitorId", "metric", "threshold", "source"],
    properties: {
      monitorId: { type: "string" },
      metric: { type: "number" },
      threshold: { type: "number" },
      source: { type: "string" },
    },
    additionalProperties: false,
  },
  requiredCapabilities: ["node.write"],
  idempotent: true,
});

export interface MonitorTrigger extends TriggerDefinitionShape {
  readonly route: {
    readonly kind: "edge-follow";
    readonly from: "event.source";
    readonly direction: "forward";
    readonly edgeSemantic: string;
  };
  readonly target: { readonly kind: "node-type"; readonly nodeType: string };
  readonly input: Record<string, unknown>;
  readonly maxCascadeDepth: number;
}

/**
 * The trigger that carries one threshold event to the notifier reached by a
 * `counter.alerts` edge from the monitor.
 *
 * The input template is data expansion (`$event.payload.*`), not an
 * expression: the notifier receives the numbers and the source label the
 * monitor published.
 */
export const notifierTrigger: MonitorTrigger = defineTrigger<MonitorTrigger>({
  id: "counter.notifier.on-threshold",
  pluginId: counterPluginId,
  event: COUNTER_METRIC_THRESHOLD_CROSSED,
  operation: "counter.notify",
  route: {
    kind: "edge-follow",
    from: "event.source",
    direction: "forward",
    edgeSemantic: MONITOR_ALERT_EDGE_SEMANTIC,
  },
  target: { kind: "node-type", nodeType: "counter.notifier" },
  input: {
    monitorId: "$event.aggregateId",
    metric: "$event.payload.metric",
    threshold: "$event.payload.threshold",
    source: "$event.payload.source",
  },
  maxCascadeDepth: 4,
});

export const monitorNodeTypes = [monitorNodeType, notifierNodeType];
export const monitorOperations = [monitorTickOperation, notifyOperation];
export const monitorTriggers = [notifierTrigger];

function nodeOf(context: MonitorContext) {
  if (context.node === undefined) {
    throw new MonitorFixtureError(
      MONITOR_INVALID,
      "the operation needs the node snapshot of its target",
    );
  }
  return context.node;
}

function contentOf(context: MonitorContext): Record<string, unknown> {
  const content = nodeOf(context).content;
  return typeof content === "object" && content !== null && !Array.isArray(content)
    ? (content as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown, field: string, code: MonitorErrorCode): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new MonitorFixtureError(code, `${field} must be a finite number`);
}

/**
 * Pull one sample and publish only on a crossing.
 *
 * "Crossing" is a transition: the previous reading was below the threshold and
 * this one is at or above it. A monitor with no previous reading treats a
 * first reading at or above the threshold as a crossing. A sample below the
 * threshold writes the cursor and last sample but emits nothing, which is the
 * stale-state case the scenario pins: activity is not an alert.
 */
export async function counterMonitorTick(
  _input: unknown,
  context: MonitorContext,
): Promise<{
  sampled: boolean;
  sample: number | null;
  crossed: boolean;
  cursor: number;
}> {
  const node = nodeOf(context);
  const content = contentOf(context);
  const threshold = finiteNumber(content.threshold, "content.threshold", MONITOR_INVALID);
  const samples = Array.isArray(content.samples) ? content.samples : [];
  const cursor =
    typeof content.cursor === "number" &&
    Number.isInteger(content.cursor) &&
    content.cursor >= 0
      ? content.cursor
      : 0;

  if (cursor >= samples.length) {
    return { sampled: false, sample: null, crossed: false, cursor };
  }

  const sample = finiteNumber(samples[cursor], `content.samples[${cursor}]`, MONITOR_INVALID);
  const previous =
    typeof content.lastSample === "number" && Number.isFinite(content.lastSample)
      ? content.lastSample
      : null;
  const wasBelow = previous === null || previous < threshold;
  const crossed = wasBelow && sample >= threshold;
  const nextCursor = cursor + 1;

  await context.writeNode(node.id, {
    content: { ...content, cursor: nextCursor, lastSample: sample },
  });

  if (crossed) {
    await context.emit(COUNTER_METRIC_THRESHOLD_CROSSED, {
      sourceNodeId: node.id,
      monitorId: node.id,
      metric: sample,
      threshold,
      source: typeof content.source === "string" ? content.source : "",
    });
  }

  return { sampled: true, sample, crossed, cursor: nextCursor };
}

/**
 * Record one dispatched notification in the notifier node.
 *
 * The payload is untrusted data: every string is copied verbatim, and a value
 * that is not a finite number is refused by code instead of being coerced. A
 * source label such as `$(...)` therefore stays a label.
 */
export async function counterNotify(
  input: unknown,
  context: MonitorContext,
): Promise<{ delivered: number; channel: string; total: number }> {
  const node = nodeOf(context);
  const content = contentOf(context);
  const record =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const monitorId = record.monitorId;
  if (typeof monitorId !== "string" || monitorId.trim() === "") {
    throw new MonitorFixtureError(NOTIFY_INVALID, "input.monitorId must be a non-empty string");
  }
  const metric = finiteNumber(record.metric, "input.metric", NOTIFY_INVALID);
  const threshold = finiteNumber(record.threshold, "input.threshold", NOTIFY_INVALID);
  const source = typeof record.source === "string" ? record.source : "";
  const channel =
    typeof content.channel === "string" && content.channel.trim() !== ""
      ? content.channel
      : MONITOR_DEFAULT_CHANNEL;
  const existing = Array.isArray(content.notifications)
    ? content.notifications
    : [];
  const notification: MonitorNotification = {
    monitorId,
    metric,
    threshold,
    source,
    correlationId: context.correlationId,
    runId: context.runId ?? null,
  };
  const notifications = [...existing, notification];

  await context.writeNode(node.id, {
    content: { ...content, channel, notifications },
  });

  return { delivered: 1, channel, total: notifications.length };
}

/** The handlers by operation id, for a host that binds them in-process. */
export function monitorHandlers(): Readonly<
  Record<string, (input: unknown, context: MonitorContext) => Promise<unknown>>
> {
  return {
    "counter.monitor.tick": counterMonitorTick,
    "counter.notify": counterNotify,
  };
}
