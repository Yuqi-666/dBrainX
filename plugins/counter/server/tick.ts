// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The counter fixture's scheduled operation and the schedule that triggers it
 * (plan item 61).
 *
 * The type declares the schedule, so `node.add` is what creates the job; the
 * plugin never runs a timer of its own and an operator never creates one by
 * hand. `counter.tick` is declaration-only for the same reason
 * `counter.increment` is: the handler export is named here and the host binds
 * it, so a build without that binding refuses the enable instead of failing at
 * the first firing.
 */

import type { OperationDefinition, ScheduleDefinition } from "@workspace/plugin-sdk";
import { defineOperationDefinition } from "@workspace/plugin-sdk";

import { counterPluginId } from "../plugin-id.ts";

/** Five seconds, the cadence this fixture uses to prove a due job fires. */
export const COUNTER_TICK_INTERVAL_MS = 5_000;

export const counterTickOperation: OperationDefinition =
  defineOperationDefinition({
    id: "counter.tick",
    pluginId: counterPluginId,
    exportName: "counterTick",
    target: "node",
    appliesTo: { nodeTypes: ["counter"] },
    effect: "invoke",
    reach: "self",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiredCapabilities: ["node.write"],
    idempotent: false,
  });

export const counterSchedules: readonly ScheduleDefinition[] = [
  {
    id: "counter.tick",
    operationId: "counter.tick",
    intervalMs: COUNTER_TICK_INTERVAL_MS,
    enabledByDefault: true,
  },
];
