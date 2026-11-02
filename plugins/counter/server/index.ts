// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The counter fixture plugin's server entry (§5.4.11).
 *
 * It exists to prove a third-party type needs no host change: one node type,
 * one operation, both declared through `@workspace/plugin-sdk`, and nothing
 * here imports `backend/**` or any package UI module. The scheduled
 * `counter.tick` operation a later plan todo adds belongs in its own module
 * beside this one.
 *
 * `counter.increment` is declaration-only, exactly like the builtin type
 * operations: it is built with `defineOperationDefinition`, so its `handler`
 * names the export the host must bind, and the increment itself lives in
 * {@link incrementCounter} — a pure function over the node content. The domain
 * `OperationContext` has no `writeNode` yet (the executor lands later), so a
 * handler here could compute the next value and nowhere to persist it; the
 * plugin host must refuse the enable until the export is bound.
 */

import type { JsonSchema, OperationDefinition } from "@workspace/plugin-sdk";
import { defineNodeType, defineOperationDefinition } from "@workspace/plugin-sdk";

import { counterPluginId } from "../plugin-id.ts";
import { counterSchedules, counterTickOperation } from "./tick.ts";

export { counterPluginId };
export { counterSchedules, counterTickOperation, COUNTER_TICK_INTERVAL_MS } from "./tick.ts";

/** The whole persisted payload: the counter's current value. */
export interface CounterContent {
  value: number;
}

export const counterSchema: JsonSchema = {
  type: "object",
  required: ["value"],
  properties: {
    value: { type: "number" },
  },
  additionalProperties: false,
};

/** A fresh counter starts at zero, so `node.add` needs no input beyond the type. */
export function createCounterContent(): CounterContent {
  return { value: 0 };
}

export const counterNodeType = defineNodeType<CounterContent>({
  type: "counter",
  version: 1,
  pluginId: counterPluginId,
  schema: counterSchema,
  defaultContent: createCounterContent,
  display: { label: "Counter", icon: "Hash" },
  operations: ["counter.increment", "counter.tick"],
  schedules: counterSchedules,
});

export const counterIncrementOperation: OperationDefinition =
  defineOperationDefinition({
    id: "counter.increment",
    pluginId: counterPluginId,
    exportName: "counterIncrement",
    target: "node",
    appliesTo: { nodeTypes: ["counter"] },
    effect: "invoke",
    reach: "self",
    inputSchema: {
      type: "object",
      properties: { by: { type: "number" } },
      additionalProperties: false,
    },
    requiredCapabilities: ["node.write"],
    idempotent: false,
  });

export const operations: readonly OperationDefinition[] = [
  counterIncrementOperation,
  counterTickOperation,
];

export const nodeTypes = [counterNodeType];

/**
 * The increment rule the bound handler calls: add `by` to the current value.
 *
 * `by` defaults to one and is applied as sent (including a negative or
 * fractional step), because the counter is a fixture for the operation path,
 * not a validated business number.
 */
export function incrementCounter(
  content: CounterContent,
  by?: number,
): CounterContent {
  return { value: content.value + (by ?? 1) };
}

/**
 * The handler `counter.tick` names. It is a no-op on the content and exists so
 * the declaration has a binding: a type that declares a schedule or an
 * operation whose export the host cannot find must be refused at enable, not at
 * the first firing.
 */
export function counterTick(content: CounterContent): CounterContent {
  return content;
}
