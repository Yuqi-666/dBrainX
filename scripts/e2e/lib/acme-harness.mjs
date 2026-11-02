// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The A/B chain harness for plan item 67 (design §4.7.5).
 *
 * It composes the real pieces the engine uses, with in-memory persistence:
 *
 * ```text
 * acme.a.fire (OperationService + CapabilityGateway)
 *   -> EventPublisher.publish(acme.a.fired)
 *      -> trigger match (createTriggerRegistry) -> edge-follow (TriggerGraphReader)
 *         -> event_deliveries.schedule
 *            -> EventDispatchService.tick -> OperationExecutor
 *               -> CapabilityGateway.check
 *                  -> acme.b.run (fixture handler)
 *                     -> SandboxService -> SandboxGuard -> SandboxFileStore (disk)
 *                        -> MxcSandboxAdapter (real, fake-backend or refused)
 *                     -> content.lastRun -> acme.b.executed
 * ```
 *
 * Only four things are fakes, and each stands for a boundary the server owns:
 * the repositories (PocketBase), the event bus delivery (the same in-memory
 * bus the server uses, fed with a stored envelope), the trigger graph reader
 * (an `IEdgeRepository` projection), and — in `fake` mode only — the MXC module
 * (`spawn`), because this host's native bridge crashes (see the evidence).
 * Nothing here runs a subprocess as a stand-in for the sandbox.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

import { Node } from "../../../backend/domain/src/models/node/entities.ts";
import { NodeId, NodeType, Permission } from "../../../backend/domain/src/models/node/base-values.ts";
import { canTransitionRun } from "../../../backend/domain/src/repositories/operation-run.repository.ts";
import { computeScopeKey, createExecutionScope } from "../../../backend/domain/src/models/plugin/capability.ts";
import {
  createTriggerRegistry,
} from "../../../backend/domain/src/models/automation/trigger-registry.ts";
import { OperationService } from "../../../backend/application/src/commands/operation/operation.service.ts";
import { CapabilityGateway } from "../../../backend/application/src/engine/capability-gateway.ts";
import { EventDispatchService } from "../../../backend/application/src/engine/event-dispatch.service.ts";
import { SandboxService } from "../../../backend/application/src/engine/sandbox-guard.ts";
import { AccessDeniedError } from "../../../backend/application/src/ports/access-denied.ts";
import { EventPublisher } from "../../../backend/infrastructure/src/event-publisher/event-publisher.ts";
import { InMemoryEventBus } from "../../../backend/infrastructure/src/event-bus/in-memory-event-bus.ts";
import {
  createPluginHost,
  readPluginManifest,
} from "../../../backend/plugin-host/src/index.ts";
import {
  MxcSandboxAdapter,
} from "../../../backend/sandbox/src/mxc-adapter.ts";
import {
  probeSandboxPlatform,
} from "../../../backend/sandbox/src/mxc-support.ts";
import {
  assessSandboxPolicy,
  deriveSandboxPolicy,
  planSandboxInvocation,
  selectSandboxHost,
} from "../../../backend/sandbox/src/sandbox-policy.ts";
import { parseSandboxPath } from "../../../backend/sandbox/src/sandbox-path.ts";
import {
  SandboxFileStore,
  sandboxRootPath,
} from "../../../backend/sandbox/src/sandbox-file-store.ts";
import {
  acmeAFire,
  acmeBRun,
  counterTick,
  incrementCounter,
  nodeTypes as counterNodeTypes,
  operations as counterOperations,
  triggers as counterTriggers,
} from "../../../plugins/counter/server/index.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const pluginDirectory = join(repoRoot, "plugins", "counter");
export const WORKSPACE_ID = "ws-acme";
export const PLUGIN_ID = "dbrainx.counter";
export const SANDBOX_ID = "sbx-acme";
export const A_NODE_ID = "node-a";
export const B_NODE_ID = "node-b";
export const B2_NODE_ID = "node-b2";
export const USER_ID = "user-owner";

export const FIXED_NOW = "2026-11-02T12:00:00.000Z";

// ---------------------------------------------------------------------------
// Persistence fakes: the same contracts PocketBase implements.
// ---------------------------------------------------------------------------

class MemoryEventStore {
  #events = [];
  #aggregateSequences = new Map();
  #workspaceSequence = 0;

  async append(input) {
    const existing = this.#events.find((event) => event.eventId === input.eventId);
    if (existing !== undefined) return existing;
    const aggregateKey = `${input.aggregateType}:${input.aggregateId}`;
    const sequence = (this.#aggregateSequences.get(aggregateKey) ?? 0) + 1;
    this.#aggregateSequences.set(aggregateKey, sequence);
    this.#workspaceSequence += 1;
    const stored = {
      ...input,
      sequence,
      workspaceSequence: this.#workspaceSequence,
    };
    this.#events.push(stored);
    return stored;
  }

  async readAfter(input) {
    return this.#events
      .filter((event) => event.workspaceId === input.workspaceId)
      .filter((event) => event.workspaceSequence > (input.cursor ?? 0))
      .slice(0, input.limit);
  }

  findById(eventId) {
    return this.#events.find((event) => event.eventId === eventId) ?? null;
  }

  all() {
    return [...this.#events];
  }
}

class MemoryDeliveryRepository {
  #rows = [];
  #sequence = 0;

  async schedule(dispatch) {
    const existing = this.#rows.find(
      (row) =>
        row.eventId === dispatch.eventId &&
        row.triggerId === dispatch.triggerId &&
        row.targetKey === dispatch.targetKey,
    );
    if (existing !== undefined) return { kind: "duplicate", delivery: { ...existing } };
    this.#sequence += 1;
    const row = {
      id: `delivery-${this.#sequence}`,
      ...dispatch,
      status: "pending",
      attempts: 0,
    };
    this.#rows.push(row);
    return { kind: "scheduled", delivery: { ...row } };
  }

  async claim({ owner, limit, leaseMs, now }) {
    const instant = Date.parse(now);
    const due = this.#rows
      .filter((row) => {
        if (row.status === "pending") return Date.parse(row.availableAt) <= instant;
        if (row.status === "processing") {
          return row.lease !== undefined && Date.parse(row.lease.expiresAt) <= instant;
        }
        return false;
      })
      .sort((left, right) =>
        left.availableAt < right.availableAt ? -1 : left.availableAt > right.availableAt ? 1 : 0,
      )
      .slice(0, limit);
    return due.map((row) => {
      row.status = "processing";
      row.lease = {
        owner,
        expiresAt: new Date(instant + leaseMs).toISOString(),
      };
      return { ...row };
    });
  }

  async complete({ deliveryId, lease, now }) {
    const row = this.#rows.find((candidate) => candidate.id === deliveryId);
    if (row === undefined || !leaseHolds(row, lease, now)) {
      return { kind: "lease-lost", delivery: { ...row } };
    }
    row.status = "done";
    return { kind: "done", delivery: { ...row } };
  }

  async fail({ deliveryId, lease, now, error, retryAt, maxAttempts }) {
    const row = this.#rows.find((candidate) => candidate.id === deliveryId);
    if (row === undefined || !leaseHolds(row, lease, now)) {
      return { kind: "lease-lost", delivery: { ...row } };
    }
    row.attempts += 1;
    row.lastError = error;
    if (row.attempts >= maxAttempts) {
      row.status = "dead";
      return { kind: "dead", delivery: { ...row } };
    }
    row.status = "failed";
    row.availableAt = retryAt;
    return { kind: "retrying", delivery: { ...row } };
  }

  async find(key) {
    return (
      this.#rows.find(
        (row) =>
          row.eventId === key.eventId &&
          row.triggerId === key.triggerId &&
          row.targetKey === key.targetKey,
      ) ?? null
    );
  }

  async listByStatus(status, limit) {
    return this.#rows
      .filter((row) => row.status === status)
      .sort((left, right) => (left.availableAt < right.availableAt ? -1 : 1))
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  all() {
    return this.#rows.map((row) => ({ ...row, lease: undefined }));
  }
}

function leaseHolds(row, lease, now) {
  if (row.status !== "processing" || row.lease === undefined) return false;
  if (row.lease.owner !== lease.owner) return false;
  return Date.parse(row.lease.expiresAt) > Date.parse(now);
}

class MemoryRunRepository {
  #runs = [];
  #byKey = new Map();
  #sequence = 0;

  async create(draft) {
    const existing = this.#byKey.get(draft.idempotencyKey);
    if (existing !== undefined) return { kind: "duplicate", run: { ...existing } };
    this.#sequence += 1;
    const run = {
      id: `run-${this.#sequence}`,
      ...draft,
      decision: draft.decision ?? "allowed",
      status: "running",
    };
    this.#runs.push(run);
    this.#byKey.set(run.idempotencyKey, run);
    return { kind: "created", run: { ...run } };
  }

  async findById(runId) {
    const run = this.#runs.find((candidate) => candidate.id === runId);
    return run === undefined ? null : { ...run };
  }

  async findByIdempotencyKey(key) {
    const run = this.#byKey.get(key);
    return run === undefined ? null : { ...run };
  }

  async transition(change) {
    const run = this.#runs.find((candidate) => candidate.id === change.runId);
    if (run === undefined) return { kind: "not-found" };
    if (run.status !== change.from) {
      return { kind: "status-changed", run: { ...run } };
    }
    if (!canTransitionRun(change.from, change.to)) {
      return { kind: "invalid-transition", from: change.from, to: change.to };
    }
    run.status = change.to;
    run.finishedAt = change.at;
    if (change.output !== undefined) run.output = change.output;
    if (change.error !== undefined) run.error = change.error;
    if (change.durationMs !== undefined) run.durationMs = change.durationMs;
    if (change.attempt !== undefined) run.attempt = change.attempt;
    return { kind: "transitioned", run: { ...run } };
  }

  async findByDelivery(deliveryId) {
    return this.#runs
      .filter((run) => run.deliveryId === deliveryId)
      .map((run) => ({ ...run }));
  }

  async listRecent(workspaceId, limit) {
    return this.#runs
      .filter((run) => run.workspaceId === workspaceId)
      .reverse()
      .slice(0, limit)
      .map((run) => ({ ...run }));
  }

  all() {
    return this.#runs.map((run) => ({ ...run }));
  }
}

class MemorySandboxRepository {
  #instances = [];
  #files = [];
  #calls = [];
  #sequence = 0;

  async upsertInstance(draft) {
    const existing = this.#instances.find(
      (instance) =>
        instance.workspaceId === draft.workspaceId &&
        instance.pluginId === draft.pluginId,
    );
    if (existing !== undefined) {
      Object.assign(existing, draft);
      return { ...existing };
    }
    const row = { id: `sandbox-${++this.#sequence}`, ...draft };
    this.#instances.push(row);
    return { ...row };
  }

  async findInstance(workspaceId, pluginId) {
    const row = this.#instances.find(
      (instance) =>
        instance.workspaceId === workspaceId && instance.pluginId === pluginId,
    );
    return row === undefined ? null : { ...row };
  }

  async findInstanceBySandboxId(workspaceId, sandboxId) {
    const row = this.#instances.find(
      (instance) =>
        instance.workspaceId === workspaceId && instance.sandboxId === sandboxId,
    );
    return row === undefined ? null : { ...row };
  }

  async touchInstance(workspaceId, sandboxId, at) {
    const row = this.#instances.find(
      (instance) =>
        instance.workspaceId === workspaceId && instance.sandboxId === sandboxId,
    );
    if (row !== undefined) row.lastUsedAt = at;
  }

  async listInstances(options = {}) {
    return this.#instances
      .filter((instance) =>
        options.workspaceId === undefined || instance.workspaceId === options.workspaceId,
      )
      .slice(0, options.limit ?? 500)
      .map((instance) => ({ ...instance }));
  }

  async listFiles(workspaceId, sandboxId, options = {}) {
    return this.#files
      .filter(
        (file) =>
          file.sandboxId === sandboxId &&
          (options.includeDeleted === true || file.deletedAt === undefined),
      )
      .sort((left, right) => (left.path < right.path ? -1 : 1))
      .slice(0, options.limit ?? 500)
      .map((file) => ({ ...file }));
  }

  async findFile(workspaceId, sandboxId, path) {
    const row = this.#files.find(
      (file) =>
        file.sandboxId === sandboxId &&
        file.path === path &&
        file.deletedAt === undefined,
    );
    return row === undefined ? null : { ...row };
  }

  async upsertFile(workspaceId, draft) {
    const existing = this.#files.find(
      (file) => file.sandboxId === draft.sandboxId && file.path === draft.path,
    );
    if (existing !== undefined) {
      Object.assign(existing, draft, { deletedAt: undefined });
      return { ...existing };
    }
    const row = { id: `file-${++this.#sequence}`, ...draft };
    this.#files.push(row);
    return { ...row };
  }

  async softDeleteFile(workspaceId, sandboxId, path, at) {
    const row = this.#files.find(
      (file) =>
        file.sandboxId === sandboxId &&
        file.path === path &&
        file.deletedAt === undefined,
    );
    if (row === undefined) return false;
    row.deletedAt = at;
    return true;
  }

  async softDeleteTree(workspaceId, sandboxId, path, at) {
    let count = 0;
    for (const file of this.#files) {
      if (
        file.sandboxId === sandboxId &&
        file.deletedAt === undefined &&
        (file.path === path || file.path.startsWith(`${path}/`))
      ) {
        file.deletedAt = at;
        count += 1;
      }
    }
    return count;
  }

  async countFiles(workspaceId, sandboxId) {
    return this.#files.filter(
      (file) => file.sandboxId === sandboxId && file.deletedAt === undefined,
    ).length;
  }

  async sumFileBytes(workspaceId, sandboxId) {
    return this.#files
      .filter((file) => file.sandboxId === sandboxId && file.deletedAt === undefined)
      .reduce((total, file) => total + file.size, 0);
  }

  async recordCall(call) {
    const row = { id: `call-${++this.#sequence}`, ...call };
    this.#calls.push(row);
    return { ...row };
  }

  async listCalls(workspaceId, sandboxId, limit = 500) {
    return this.#calls
      .filter((call) => call.sandboxId === sandboxId)
      .reverse()
      .slice(0, limit)
      .map((call) => ({ ...call }));
  }

  calls() {
    return this.#calls.map((call) => ({ ...call }));
  }

  files() {
    return this.#files.map((file) => ({ ...file }));
  }
}

// ---------------------------------------------------------------------------
// Node records and the graph.
// ---------------------------------------------------------------------------

function createNodeRecord(id, nodeType, content) {
  return {
    id,
    nodeType,
    content,
    title: id,
    semanticId: `node:${id}`,
    workspaceId: WORKSPACE_ID,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

class NodeStore {
  #records = new Map();

  constructor(records) {
    for (const record of records) this.#records.set(record.id, record);
  }

  get(id) {
    return this.#records.get(id);
  }

  write(id, content) {
    const record = this.#records.get(id);
    if (record === undefined) throw new Error(`node "${id}" does not exist`);
    record.content = content;
  }

  entity(id) {
    const record = this.#records.get(id);
    if (record === undefined) return null;
    return Node.create({
      id: new NodeId(record.id),
      title: record.title,
      permission: Permission.private(),
      semanticId: record.semanticId,
      workspaceId: record.workspaceId,
      nodeType: new NodeType(record.nodeType),
      content: record.content,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  byType(nodeType) {
    return [...this.#records.values()]
      .filter((record) => record.nodeType === nodeType)
      .map((record) => this.entity(record.id));
  }

  accessTarget(id) {
    const record = this.#records.get(id);
    if (record === undefined) return null;
    return {
      id: record.id,
      workspaceId: record.workspaceId,
      nodeType: record.nodeType,
      permission: "private",
    };
  }

  contents() {
    return Object.fromEntries(
      [...this.#records.values()].map((record) => [record.id, record.content]),
    );
  }
}

class MemoryEdgeReader {
  constructor(edges) {
    this.edges = edges;
  }

  async readEdges(workspaceId) {
    return this.edges;
  }
}

class MemoryGrantRepository {
  constructor(grants) {
    this.grants = grants;
  }

  async listForPlugin(pluginId, workspaceId) {
    return this.grants.filter(
      (grant) => grant.pluginId === pluginId && grant.workspaceId === workspaceId,
    );
  }
}

// ---------------------------------------------------------------------------
// The sandbox: real service, real guard, real file store.
// ---------------------------------------------------------------------------

export function unavailableReport(detail) {
  return {
    status: "unavailable",
    umbrella: "SANDBOX_UNAVAILABLE",
    reason: { code: "SANDBOX_NO_BACKEND", detail },
    host: { platform: process.platform, arch: process.arch, triple: `${process.platform}-${process.arch}` },
    mxc: {},
    backends: [],
    availableBackends: [],
    features: {},
    notes: { sdkSupported: false, isolationWarnings: [], unavailableReasons: {}, unrecognizedBackends: [] },
  };
}

/**
 * A synthetic linux/bubblewrap matrix for the fake-spawn tests.
 *
 * They assert the request mapping and the guard, not this host's backend, so an
 * unavailable or non-linux CI box must not change their answer.
 */
async function fakeSupportReport() {
  return probeSandboxPlatform({
    platform: "linux",
    arch: "arm64",
    node: "scenario",
    env: {},
    loadModule: async () => ({
      SDK_CONTRACT_VERSION: "scenario",
      getAvailableBackends: () => [
        { backend: "bubblewrap", capabilities: [], warnings: [] },
      ],
      getPlatformSupport: () => ({
        isSupported: true,
        reason: "",
        availableMethods: ["bubblewrap"],
      }),
    }),
  });
}

/** The behaviours a fixture script can ask the fake backend for. */
const SCRIPT_BEHAVIOURS = [
  ["__ACME_FAIL__", ({ script }) => ({ exitCode: 1, stderr: "", stdout: "" })],
  ["__ACME_STDERR__", () => ({ exitCode: 2, stderr: "boom\n", stdout: "" })],
  ["__ACME_TIMEOUT__", () => ({ exitCode: -1, stderr: "", stdout: "", timedOut: true })],
];

function fakeMxcModule(root) {
  const requests = [];
  return {
    requests,
    module: {
      async spawn(request) {
        requests.push(request);
        let script = "";
        try {
          script = await readFile(join(request.workingDirectory, "script.py"), "utf8");
        } catch {
          script = "";
        }
        const behaviour =
          SCRIPT_BEHAVIOURS.find(([marker]) => script.includes(marker))?.[1] ??
          (() => ({ exitCode: 0, stderr: "", stdout: script }));
        const result = behaviour({ script, root });
        return {
          standardOutput: Readable.from(
            result.stdout === "" ? [] : [Buffer.from(result.stdout)],
          ),
          standardError: Readable.from(
            result.stderr === "" ? [] : [Buffer.from(result.stderr)],
          ),
          async wait() {
            return {
              exitCode: result.exitCode,
              timedOut: result.timedOut === true,
            };
          },
          kill() {},
          dispose() {},
        };
      },
    },
  };
}

/**
 * One composed chain.
 *
 * `backend` is one of:
 * - `real`: the MXC adapter runs the script for real (only when a probe said
 *   the host's native bridge is stable);
 * - `fake`: the real adapter runs, but `spawn` is a deterministic fake process;
 *   the request mapping, guard, file store and result mapping are the real ones;
 * - `unstable`: the matrix is available, but the native bridge is known to
 *   crash, so the executor factory refuses before it is built;
 * - `unavailable`: no backend on this host; the planner refuses.
 */
export async function createAcmeChain(options = {}) {
  const backend = options.backend ?? "real";
  const storageRoot = options.storageRoot;
  const now = options.now ?? (() => FIXED_NOW);
  const support =
    options.support ??
    (backend === "unavailable"
      ? unavailableReport("this scenario simulates a host without an MXC backend")
      : backend === "fake"
        ? await fakeSupportReport()
        : await probeSandboxPlatform());
  const fake = backend === "fake" ? fakeMxcModule(storageRoot) : undefined;

  const nodes = new NodeStore([
    createNodeRecord(A_NODE_ID, "acme.a", { message: "ping" }),
    createNodeRecord(B_NODE_ID, "acme.b", { script: "print('hello')\n" }),
    createNodeRecord(B2_NODE_ID, "acme.b", { script: "print('unrelated')\n" }),
  ]);
  const edges = new MemoryEdgeReader([
    { from: A_NODE_ID, to: B_NODE_ID, direction: "forward", semantic: "acme.triggers" },
    { from: A_NODE_ID, to: B2_NODE_ID, direction: "forward", semantic: "monitors" },
  ]);

  const manifest = (await readPluginManifest(pluginDirectory)).manifest;
  const grants = manifest.permissions.map((permission) => ({
    pluginId: manifest.id,
    workspaceId: WORKSPACE_ID,
    capability: permission.capability,
    scope: [...permission.scope],
    scopeKey: computeScopeKey(permission.capability, permission.scope),
    grantedBy: "scenario",
    grantedAt: FIXED_NOW,
  }));
  const grantRepository = new MemoryGrantRepository(grants);

  const events = new MemoryEventStore();
  const deliveries = new MemoryDeliveryRepository();
  const runs = new MemoryRunRepository();
  const sandboxRepository = new MemorySandboxRepository();
  const eventIds = [];

  const root = sandboxRootPath(storageRoot, WORKSPACE_ID, SANDBOX_ID);
  await mkdir(root, { recursive: true });
  await sandboxRepository.upsertInstance({
    workspaceId: WORKSPACE_ID,
    pluginId: PLUGIN_ID,
    sandboxId: SANDBOX_ID,
    backend: support.preferred ?? "none",
    status: "ready",
    rootPath: root,
    policyHash: "scenario",
    maxBytes: 1024 * 1024 * 1024,
    maxFiles: 500,
    maxProcesses: 1,
  });

  const fileStore = new SandboxFileStore({
    repository: sandboxRepository,
    storageRoot,
    now,
  });

  const handles = { publisher: undefined };
  let requestSequence = 0;

  const sandboxService = new SandboxService({
    repository: sandboxRepository,
    grants: grantRepository,
    derivePolicy: (grantRows) => deriveSandboxPolicy(grantRows),
    createExecutor: (policy, identity) => {
      const selection = selectSandboxHost(support);
      if (!selection.ok) {
        return {
          ok: false,
          code: "SANDBOX_UNAVAILABLE",
          detail: selection.detail,
        };
      }
      const verdict = assessSandboxPolicy(policy, selection.host);
      if (!verdict.ok) {
        return {
          ok: false,
          code: "SANDBOX_UNAVAILABLE",
          matrixCode: verdict.code,
          detail: verdict.detail,
        };
      }
      const identityRoot = sandboxRootPath(
        storageRoot,
        identity.workspaceId,
        identity.sandboxId,
      );
      const plan = planSandboxInvocation(policy, selection.host, {
        root: identityRoot,
      });
      if (!plan.ok) {
        return {
          ok: false,
          code: "SANDBOX_UNAVAILABLE",
          matrixCode: plan.code,
          detail: plan.detail,
        };
      }
      if (backend === "unstable") {
        return {
          ok: false,
          code: "SANDBOX_UNAVAILABLE",
          matrixCode: "SANDBOX_SPAWN_UNSTABLE",
          detail:
            "the native MXC bridge of this host crashed on a probe spawn; the executor is refused instead of crashing the run",
        };
      }
      return {
        ok: true,
        executor: new MxcSandboxAdapter({
          invocation: plan.invocation,
          layout: { root: identityRoot },
          ...(backend === "fake" ? { platform: "linux" } : {}),
          ...(fake === undefined ? {} : { loadModule: async () => fake.module }),
        }),
      };
    },
    files: (call) => ({
      readFile: (path, options) => fileStore.readFile(call, path, options),
      writeFile: (path, data, options) => fileStore.writeFile(call, path, data, options),
      list: (path) => fileStore.list(call, path),
      remove: (path, options) => fileStore.remove(call, path, options),
    }),
    parsePath: parseSandboxPath,
    now,
  });

  function hostPorts(context) {
    return {
      sandbox: {
        invoke: (method, payload) =>
          sandboxService.call({
            context,
            pluginId: PLUGIN_ID,
            operationId: "acme.b.run",
            requestId: `request-${++requestSequence}`,
            method,
            payload,
          }),
      },
      writeNode: async (nodeId, patch) => {
        nodes.write(nodeId, patch.content);
      },
      emit: async (eventType, payload, emitOptions) => {
        const stored = await handles.publisher.publish({
          eventType,
          aggregateType: "node",
          aggregateId: context.node.id,
          workspaceId: context.workspaceId,
          payload,
          correlationId: emitOptions.correlationId,
          causationId: emitOptions.causationId,
          producer: context.actor,
          cascadeDepth: emitOptions.cascadeDepth,
        });
        eventIds.push(stored.eventId);
        return { eventId: stored.eventId };
      },
    };
  }

  const handlers = {
    "counter.increment": async (input, context) =>
      incrementCounter(context.node.content, input.by),
    "counter.tick": async (_input, context) => counterTick(context.node.content),
    "acme.a.fire": async (input, context) =>
      acmeAFire(input, { ...context, ...hostPorts(context) }),
    "acme.b.run": async (input, context) =>
      acmeBRun(input, { ...context, ...hostPorts(context) }),
  };

  const trustedKeys = JSON.parse(
    await readFile(join(pluginDirectory, "trusted-keys.test.json"), "utf8"),
  );
  const host = createPluginHost({
    packages: [
      {
        directory: pluginDirectory,
        kind: "trusted",
        nodeTypes: counterNodeTypes,
        operations: counterOperations,
        triggers: counterTriggers,
        handlers,
      },
    ],
    trust: { trustedKeys, allowTestKey: true },
  });
  const snapshot = await host.loadAll();

  const triggers = createTriggerRegistry();
  for (const trigger of counterTriggers) {
    triggers.register(trigger, {
      manifests: [manifest],
      grants,
      operations: snapshot.operations,
    });
  }

  const publisher = new EventPublisher({
    store: events,
    triggers,
    deliveries,
    nodes: {
      findByNodeType: async (nodeType) => nodes.byType(nodeType),
    },
    edges,
    bus: new InMemoryEventBus(),
    clock: now,
    onCascadeLimit: () => undefined,
    onRouteSkipped: (outcome) => {
      throw new Error(`${outcome.code}: ${outcome.detail}`);
    },
  });
  handles.publisher = publisher;

  const gateway = new CapabilityGateway({
    operations: snapshot.operations,
    nodes: {
      resolve: async (nodeId) => nodes.accessTarget(nodeId),
      assertCanInvoke: async (userId) => {
        if (userId !== USER_ID) {
          throw new AccessDeniedError(`user "${userId}" may not invoke a node operation`);
        }
      },
    },
    workspaces: {
      resolve: async (workspaceId) =>
        workspaceId === WORKSPACE_ID ? { id: WORKSPACE_ID } : null,
      assertCanWrite: async () => undefined,
      assertCanManage: async () => undefined,
    },
    runs,
    grants: grantRepository,
    now,
  });

  const operationService = new OperationService({
    operations: snapshot.operations,
    gateway,
    runs,
    nodes: {
      findById: async (nodeId) => nodes.entity(nodeId.value),
    },
    now,
  });

  const dispatchPort = {
    async dispatch(request) {
      const approval = await gateway.check(
        {
          operationId: request.operationId,
          target: request.target,
          ...(request.input === undefined ? {} : { input: request.input }),
        },
        {
          actor: request.actor,
          workspaceId: request.workspaceId,
          scope: createExecutionScope({
            kind: "workspace",
            workspaceId: request.workspaceId,
          }),
          correlationId: request.correlationId,
        },
      );
      const run = await runs.findByIdempotencyKey(request.idempotencyKey);
      const record =
        request.target.kind === "node" ? nodes.get(request.target.nodeId) : undefined;
      const context = {
        actor: request.actor,
        workspaceId: request.workspaceId,
        scope: approval.scope,
        target: request.target,
        correlationId: request.correlationId,
        ...(run === null ? {} : { runId: run.id }),
        ...(record === undefined
          ? {}
          : {
              node: {
                id: record.id,
                nodeType: record.nodeType,
                workspaceId: record.workspaceId,
                title: record.title,
                permission: "private",
                semanticId: record.semanticId,
                tags: [],
                isPinned: false,
                content: record.content,
                typeVersion: 1,
                createdAt: record.createdAt,
                updatedAt: record.updatedAt,
              },
            }),
      };
      const output = await snapshot.operations.resolve(request.operationId)(
        request.input,
        context,
      );
      return { ok: true, output };
    },
  };

  const dispatch = new EventDispatchService({
    deliveries,
    events: {
      findById: async (eventId) => {
        const event = events.findById(eventId);
        if (event === null) return null;
        return {
          eventId: event.eventId,
          eventType: event.eventType,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          payload: event.payload,
          workspaceId: event.workspaceId,
          cascadeDepth: event.cascadeDepth ?? 0,
        };
      },
    },
    triggers,
    runs,
    dispatch: dispatchPort,
    operations: {
      find: (operationId) => snapshot.operations.get(operationId)?.definition,
    },
    now,
    owner: "scenario-worker",
  });

  return {
    backend,
    support,
    root,
    storageRoot,
    manifest,
    grants,
    nodes,
    edges,
    events,
    deliveries,
    runs,
    sandboxRepository,
    fileStore,
    sandboxService,
    gateway,
    operationService,
    dispatch,
    publisher,
    triggers,
    snapshot,
    fake,
    eventIds,
    async invokeA({ correlationId, message } = {}) {
      if (message !== undefined) {
        nodes.write(A_NODE_ID, { message });
      }
      return operationService.invoke(
        {
          operationId: "acme.a.fire",
          target: { kind: "node", nodeId: A_NODE_ID },
          input: {},
          ...(correlationId === undefined ? {} : { correlationId }),
        },
        {
          actor: { kind: "user", userId: USER_ID },
          workspaceId: WORKSPACE_ID,
          scope: createExecutionScope({ kind: "workspace", workspaceId: WORKSPACE_ID }),
        },
      );
    },
    async tick() {
      return dispatch.tick();
    },
    setBNext(content) {
      nodes.write(B_NODE_ID, { ...nodes.get(B_NODE_ID).content, ...content });
    },
    rows() {
      return {
        operation_runs: runs.all(),
        sandbox_calls: sandboxRepository.calls(),
        sandbox_files: sandboxRepository.files(),
        event_log: events.all(),
        event_deliveries: deliveries.all(),
        node_content: nodes.contents(),
      };
    },
    async scriptFile() {
      const path = join(root, "nodes", B_NODE_ID, "script.py");
      try {
        return { path, content: await readFile(path, "utf8") };
      } catch (error) {
        return { path, missing: error.code };
      }
    },
    async close() {
      await rm(storageRoot, { recursive: true, force: true });
    },
  };
}

/** Write one file under the sandbox root, for a canary check. */
export async function writeSandboxFile(root, relativePath, content) {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}
