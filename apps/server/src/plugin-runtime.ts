// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Seeds the builtin plugin's grants per workspace and verifies the composed
 * policy (plan item 51).
 *
 * Two things have to be true before a plugin-actor call can work in this
 * process, and neither is visible from outside:
 *
 * 1. the workspace holds the grants its manifest asks for — install materializes
 *    them from `plugins/builtin/plugin.json`, so removing a permission there
 *    removes the row and the gateway then refuses the call;
 * 2. the gate was composed *with* a grant source. A gateway built without one
 *    answers `CAPABILITY_POLICY_UNAVAILABLE` for every plugin call, which looks
 *    identical to "the plugin has no grants" from the client's side.
 *
 * The second is what this module proves at the moment the first workspace
 * exists: it authorizes a builtin call that the seeded grant covers, and one
 * for a plugin that holds nothing. A process that forgot the repository fails
 * the first probe, so the check is the wiring test rather than a smoke-screen.
 *
 * The probe runs through the container's own `CapabilityGateway`, so it reads
 * the same rows a real invocation would; it does not execute a handler.
 */
import type { CapabilityGateway } from "@workspace/application";
import type { IOperationHandlerRegistry } from "@workspace/domain";
import { createExecutionScope } from "@workspace/domain";

import type { AppContainer } from "@workspace/adapter-front";

/** A plugin that ships but holds no grants for any workspace. */
const UNGRANTED_PLUGIN_ID = "dbrainx.counter";
/**
 * The refusal codes a capability denial may carry.
 *
 * The grant-backed branch reported `FORBIDDEN` and the composed authorizer
 * reported `CAPABILITY_DENIED`; plan item 48 folds the first into the second.
 * Both mean "the capability is not granted" — the code this probe must never
 * accept is `CAPABILITY_POLICY_UNAVAILABLE`, which means the process composed
 * no policy source at all.
 */
const CAPABILITY_DENIAL_CODES: ReadonlySet<string> = new Set([
  "FORBIDDEN",
  "CAPABILITY_DENIED",
]);
/** Workspace-target operation; its capability is the one the builtin manifest asks for. */
const PROBE_OPERATION_ID = "edge.create";

export interface PluginPolicyProbeResult {
  readonly granted: "allowed";
  readonly denied: string;
}

/**
 * Checks one granted and one ungranted plugin call through the real gate.
 *
 * `check`, not `authorize`: a startup probe must not write two run rows per
 * workspace (one of them never completed, because a probe executes nothing).
 * Throws when the granted call is not allowed or the ungranted one is not a
 * refusal, so a caller that only logs the line has actually verified both.
 */
export async function probePluginGrantPolicy(input: {
  readonly gateway: CapabilityGateway;
  readonly operations: Pick<IOperationHandlerRegistry, "get">;
  readonly workspaceId: string;
  readonly grantedPluginId: string;
}): Promise<PluginPolicyProbeResult> {
  const registration = input.operations.get(PROBE_OPERATION_ID);
  if (registration === undefined)
    throw new Error(
      `the policy probe needs the operation "${PROBE_OPERATION_ID}", which this process did not register`,
    );
  const scope = createExecutionScope({
    kind: "workspace",
    workspaceId: input.workspaceId,
  });
  const invocation = {
    operationId: PROBE_OPERATION_ID,
    target: { kind: "workspace" as const, workspaceId: input.workspaceId },
    input: {},
  };

  await input.gateway.check(invocation, {
    actor: { kind: "plugin", pluginId: input.grantedPluginId },
    workspaceId: input.workspaceId,
    scope,
    correlationId: `plugin-grants-probe-${input.workspaceId}`,
  });

  let denied = "";
  try {
    await input.gateway.check(invocation, {
      actor: { kind: "plugin", pluginId: UNGRANTED_PLUGIN_ID },
      workspaceId: input.workspaceId,
      scope,
      correlationId: `plugin-grants-probe-ungranted-${input.workspaceId}`,
    });
  } catch (error) {
    denied = codeOf(error);
  }
  if (!CAPABILITY_DENIAL_CODES.has(denied))
    throw new Error(
      `an ungranted plugin call was answered "${denied || "allowed"}" instead of a capability denial`,
    );
  return { granted: "allowed", denied };
}

function codeOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error)
    return String((error as { code: unknown }).code);
  return "";
}

/**
 * Runs the seeding on every workspace the moment it is created.
 *
 * The event is the same `WorkspaceCreated` the client receives, so there is no
 * second creation path to keep in step. A failure is logged and does not fail
 * the creation: the workspace exists either way, and a later enable retries the
 * same idempotent install.
 */
export function startBuiltinGrantSeeding(
  container: AppContainer,
  onReport: (line: string) => void = (line) => console.log(line),
): () => void {
  const unsubscribe = container.eventBus.subscribe<{ id?: string }>(
    "WorkspaceCreated",
    (event) => {
      const workspaceId = event.data?.id;
      if (typeof workspaceId !== "string" || workspaceId.trim() === "") return;
      void seed(workspaceId);
    },
  );

  async function seed(workspaceId: string): Promise<void> {
    try {
      const outcome = await container.ensureBuiltinPluginGrants(workspaceId);
      if (outcome === null) {
        onReport(
          `[plugin-grants] workspace ${workspaceId}: this process serves no plugin package, so nothing was seeded`,
        );
        return;
      }
      const probe = await probePluginGrantPolicy({
        gateway: container.capabilityGateway,
        operations: container.operationRegistry,
        workspaceId,
        grantedPluginId: outcome.plugin.pluginId,
      });
      onReport(
        `[plugin-grants] workspace ${workspaceId}: ${outcome.plugin.pluginId} install ${outcome.kind} ` +
          `(seeded ${outcome.seeded}, already ${outcome.alreadyGranted}); ` +
          `${outcome.plugin.pluginId} ${PROBE_OPERATION_ID} -> ${probe.granted}; ` +
          `${UNGRANTED_PLUGIN_ID} ${PROBE_OPERATION_ID} -> ${probe.denied}`,
      );
      const triggers = await container.refreshTriggerContributions();
      onReport(
        `[plugin-triggers] workspace ${workspaceId}: ${triggers} trigger(s) registered from the served snapshot`,
      );
    } catch (error) {
      console.warn(
        `[plugin-grants] workspace ${workspaceId}: seeding failed`,
        error,
      );
    }
  }

  return unsubscribe;
}
