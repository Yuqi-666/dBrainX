// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The seven contract types the SDK re-exports must be the domain types, never a
 * look-alike (§4.1.2 boundary rule 5, GAP-8).
 *
 * The assertions below are compile-time: `pnpm check-types` fails when one of
 * the names leaves the `export type { ... }` list in `./types.ts` (the import
 * stops resolving) or when a local copy drifts from the domain shape (the two
 * directions stop being assignable). The runtime case guards the other half of
 * the entry's contract: it must stay type-only, so importing it adds no value
 * to a browser bundle.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  Actor as SdkActor,
  CapabilityGrant as SdkCapabilityGrant,
  EventEnvelope as SdkEventEnvelope,
  ExecutionScope as SdkExecutionScope,
  PluginManifest as SdkPluginManifest,
  PluginPermission as SdkPluginPermission,
  TriggerDefinition as SdkTriggerDefinition,
} from "@workspace/plugin-sdk/types";
import type {
  Actor as DomainActor,
  CapabilityGrant as DomainCapabilityGrant,
  EventEnvelope as DomainEventEnvelope,
  ExecutionScope as DomainExecutionScope,
  PluginManifest as DomainPluginManifest,
  PluginPermission as DomainPluginPermission,
  TriggerDefinition as DomainTriggerDefinition,
} from "@workspace/domain";

/** `true` only when each type is assignable to the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type PluginManifestIsDomain = Assert<
  Same<SdkPluginManifest, DomainPluginManifest>
>;
export type PluginPermissionIsDomain = Assert<
  Same<SdkPluginPermission, DomainPluginPermission>
>;
export type TriggerDefinitionIsDomain = Assert<
  Same<SdkTriggerDefinition, DomainTriggerDefinition>
>;
export type EventEnvelopeIsDomain = Assert<
  Same<SdkEventEnvelope, DomainEventEnvelope>
>;
export type ActorIsDomain = Assert<Same<SdkActor, DomainActor>>;
export type CapabilityGrantIsDomain = Assert<
  Same<SdkCapabilityGrant, DomainCapabilityGrant>
>;
export type ExecutionScopeIsDomain = Assert<
  Same<SdkExecutionScope, DomainExecutionScope>
>;

test("the type entry carries no runtime value", async () => {
  const entry = await import("./types.ts");

  assert.deepEqual(Object.keys(entry), []);
});
