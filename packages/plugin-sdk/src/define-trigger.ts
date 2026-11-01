// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The fields a trigger must carry for the builder to accept it.
 *
 * `TriggerDefinition` lands in `domain` with the automation model (plan
 * todo 61, §4.5.3). Until then this is the smallest set the builder can check;
 * todo 61 replaces the constraint with the domain type and keeps the runtime
 * identity behavior.
 */
export interface TriggerDefinitionShape {
  readonly id: string
  readonly pluginId: string
  /** Exact event type, or a wildcard such as `"aws.*"`. */
  readonly event: string
  /** Operation id the trigger dispatches to; never a handler implementation. */
  readonly operation: string
}

/**
 * Declares a trigger (§4.5.3).
 *
 * Identity plus a cheap structural check: the trigger registry owns the
 * authoritative validation (event ownership, `event.subscribe` grant, cascade
 * depth) at registration time.
 */
export function defineTrigger<T extends TriggerDefinitionShape>(
  trigger: T,
): T {
  if (typeof trigger.id !== "string" || trigger.id.trim() === "") {
    throw new TypeError("defineTrigger: `id` must be a non-empty string")
  }
  if (
    typeof trigger.pluginId !== "string" ||
    trigger.pluginId.trim() === ""
  ) {
    throw new TypeError(`defineTrigger("${trigger.id}"): \`pluginId\` is required`)
  }
  if (typeof trigger.event !== "string" || trigger.event.trim() === "") {
    throw new TypeError(`defineTrigger("${trigger.id}"): \`event\` is required`)
  }
  if (
    typeof trigger.operation !== "string" ||
    trigger.operation.trim() === ""
  ) {
    throw new TypeError(
      `defineTrigger("${trigger.id}"): \`operation\` is required`,
    )
  }
  return trigger
}
