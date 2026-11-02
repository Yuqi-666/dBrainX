// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The in-memory chain for the monitor → threshold → notifier scenario (item 66).
 *
 * The pieces are the real ones the served engine uses:
 *
 * ```text
 * SchedulerService.tick
 *   -> EngineOperationDispatcher.run -> OperationExecutor -> operation.invoke
 *      -> counter.monitor.tick -> EventPublisher.publish(counter.metric.threshold_crossed)
 *         -> trigger match (createTriggerRegistry) -> edge-follow (TriggerGraphReader)
 *            -> event_deliveries.schedule
 *               -> EventDispatchService.tick -> OperationExecutor
 *                  -> CapabilityGateway.check -> counter.notify
 * ```
 *
 * Only the repositories are in memory, standing in for the PocketBase tables a
 * deployment writes; the engine classes, the trigger registry, the publisher,
 * the capability gateway and the executor are the production ones. No timer is
 * driven: the clock is a variable the scenario advances, so a tick is caused by
 * an assertion, not by a sleep.
 */

import { fileURLToPath } from "node:url";

import { Node } from "../../../backend/domain/src/models/node/entities.ts";
import {
  NodeId,
  NodeType,
  Permission,
} from "../../../backend/domain/src/models/node/base-values.ts";
import {
  computeScopeKey,
  createExecutionScope,
} from "../../../backend/domain/src/models/plugin/capability.ts";
import { createOperationRegistry } from "../../../backend/domain/src/ports/operation-handler.ts";
import { canTransitionRun } from "../../../backend/domain/src/repositories/operation-run.repository.ts";
import { createTriggerRegistry } from "../../../backend/domain/src/models/automation/trigger-registry.ts";
import { CapabilityGateway } from "../../../backend/application/src/engine/capability-gateway.ts";
import {
  EngineOperationDispatcher,
  createEngineAuthorizer,
} from "../../../backend/application/src/engine/engine-dispatcher.ts";
import { EventDispatchService } from "../../../backend/application/src/engine/event-dispatch.service.ts";
import { OperationExecutor } from "../../../backend/application/src/engine/operation-executor.ts";
import { SchedulerService } from "../../../backend/application/src/engine/scheduler.service.ts";
import { EventPublisher } from "../../../backend/infrastructure/src/event-publisher/event-publisher.ts";
import { InMemoryEventBus } from "../../../backend/infrastructure/src/event-bus/in-memory-event-bus.ts";
import { readPluginManifest } from "../../../backend/plugin-host/src/index.ts";
import {
  MONITOR_ALERT_EDGE_SEMANTIC,
  MONITOR_SAMPLE_INTERVAL_MS,
  counterMonitorTick,
  counterNotify,
  monitorNodeTypes,
  monitorOperations,
  monitorTriggers,
} from "../../../plugins/counter/server/index.ts";

export const WORKSPACE_ID = "ws-monitor";
export const PLUGIN_ID = "dbrainx.counter";
export const MONITOR_NODE_ID = "node-monitor";
export const NOTIFIER_NODE_ID = "node-notifier";
export const SECOND_NOTIFIER_NODE_ID = "node-notifier-2";
export const FIXED_NOW = "2026-11-02T12:00:00.000Z";

const pluginDirectory = fileURLToPath(
  new URL("../../../plugins/counter/", import.meta.url),
);

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
    const stored = { ...input, sequence, workspaceSequence: this.#workspaceSequence };
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

  byType(eventType) {
    return this.#events.filter((event) => event.eventType === eventType);
  }
}

function leaseHolds(row, lease, now) {
  if (row.status !== "processing" || row.lease === undefined) return false;
  if (row.lease.owner !== lease.owner) return false;
  return Date.parse(row.lease.expiresAt) > Date.parse(now);
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
      row.lease = { owner, expiresAt: new Date(instant + leaseMs).toISOString() };
      return { ...row };
    });
  }

  async complete({ deliveryId, lease, now }) {
    const row = this.#rows.find((candidate) => candidate.id === deliveryId);
    if (row === undefined || !leaseHolds(row, lease, now)) {
      return { kind: "lease-lost", delivery: { ...row } };
    }
    row.status = "done";
    row.lease = undefined;
    return { kind: "done", delivery: { ...row } };
  }

  async fail({ deliveryId, lease, now, error, retryAt, maxAttempts }) {
    const row = this.#rows.find((candidate) => candidate.id === deliveryId);
    if (row === undefined || !leaseHolds(row, lease, now)) {
      return { kind: "lease-lost", delivery: { ...row } };
    }
    row.attempts += 1;
    row.lastError = error;
    row.lease = undefined;
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
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  all() {
    return this.#rows.map((row) => ({ ...row, lease: undefined }));
  }
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

  async findByDelivery(deliveryId) {
    return this.#runs
      .filter((run) => run.deliveryId === deliveryId)
      .map((run) => ({ ...run }));
  }

  async listRecent(_workspaceId, limit) {
    return this.#runs.slice(-limit).map((run) => ({ ...run }));
  }

  async transition(change) {
    const run = this.#runs.find((candidate) => candidate.id === change.runId);
    if (run === undefined) return { kind: "not-found" };
    if (run.status !== change.from) return { kind: "status-changed", run: { ...run } };
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

  all() {
    return this.#runs.map((run) => ({ ...run }));
  }
}

class MemoryJobRepository {
  #rows = [];
  #sequence = 0;

  async create(draft) {
    const existing = this.#rows.find(
      (row) =>
        row.pluginId === draft.pluginId &&
        row.operationId === draft.operationId &&
        (row.nodeId ?? null) === (draft.nodeId ?? null) &&
        row.workspaceId === draft.workspaceId,
    );
    if (existing !== undefined) return { kind: "duplicate", job: { ...existing } };
    this.#sequence += 1;
    const row = {
      id: `job-${this.#sequence}`,
      ...draft,
      enabled: draft.enabled ?? true,
    };
    this.#rows.push(row);
    return { kind: "created", job: { ...row } };
  }

  async findById(jobId) {
    return this.#rows.find((row) => row.id === jobId) ?? null;
  }

  async claimDue({ owner, limit, leaseMs, now }) {
    const instant = Date.parse(now);
    return this.#rows
      .filter((row) => {
        if (!row.enabled) return false;
        if (Date.parse(row.nextRunAt) > instant) return false;
        return (
          row.leaseUntil === undefined || Date.parse(row.leaseUntil) <= instant
        );
      })
      .slice(0, limit)
      .map((row) => {
        row.leaseOwner = owner;
        row.leaseUntil = new Date(instant + leaseMs).toISOString();
        return {
          ...row,
          scheduledFor: row.nextRunAt,
          lease: { owner, expiresAt: row.leaseUntil },
        };
      });
  }

  async complete({ jobId, lease, ranAt, nextRunAt }) {
    const row = this.#rows.find((candidate) => candidate.id === jobId);
    if (row === undefined) return { kind: "not-found" };
    if (row.leaseOwner !== lease.owner || row.leaseUntil !== lease.expiresAt) {
      return { kind: "lease-lost", job: { ...row } };
    }
    row.nextRunAt = nextRunAt;
    row.lastRanAt = ranAt;
    row.leaseOwner = undefined;
    row.leaseUntil = undefined;
    return { kind: "completed", job: { ...row } };
  }

  async release(jobId, lease) {
    const row = this.#rows.find((candidate) => candidate.id === jobId);
    if (row === undefined || row.leaseOwner !== lease.owner) return false;
    row.leaseOwner = undefined;
    row.leaseUntil = undefined;
    return true;
  }

  async setEnabled(jobId, enabled) {
    const row = this.#rows.find((candidate) => candidate.id === jobId);
    if (row === undefined) return false;
    row.enabled = enabled;
    return true;
  }

  async disableForNode(nodeId, workspaceId) {
    let disabled = 0;
    for (const row of this.#rows) {
      if (row.nodeId === nodeId && row.workspaceId === workspaceId && row.enabled) {
        row.enabled = false;
        disabled += 1;
      }
    }
    return disabled;
  }

  async remove(jobId) {
    const index = this.#rows.findIndex((row) => row.id === jobId);
    if (index === -1) return false;
    this.#rows.splice(index, 1);
    return true;
  }

  all() {
    return this.#rows.map((row) => ({ ...row }));
  }
}

class MemoryNodeStore {
  #records = new Map();
  #failWrites = new Set();

  constructor(records, { failWritesFor = [] } = {}) {
    for (const record of records) this.#records.set(record.id, record);
    for (const id of failWritesFor) this.#failWrites.add(id);
  }

  get(nodeId) {
    return this.#records.get(nodeId);
  }

  write(nodeId, content) {
    const record = this.#records.get(nodeId);
    if (record === undefined) throw new Error(`node "${nodeId}" does not exist`);
    if (this.#failWrites.has(nodeId)) {
      throw new Error(`node "${nodeId}" refused the write`);
    }
    record.content = content;
  }

  contents() {
    return Object.fromEntries(
      [...this.#records.values()].map((record) => [record.id, record.content]),
    );
  }

  entity(nodeId) {
    const record = this.#records.get(nodeId);
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

  accessTarget(nodeId) {
    const record = this.#records.get(nodeId);
    if (record === undefined) return null;
    return {
      id: record.id,
      workspaceId: record.workspaceId,
      nodeType: record.nodeType,
      permission: "private",
    };
  }
}

class MemoryEdgeReader {
  #edges;

  constructor(edges) {
    this.#edges = [...edges];
  }

  async readEdges(workspaceId) {
    return this.#edges
      .filter((edge) => edge.workspaceId === workspaceId)
      .map((edge) => ({
        from: edge.from,
        to: edge.to,
        direction: edge.direction,
        semantic: edge.semantic,
      }));
  }

  remove(from, to) {
    this.#edges = this.#edges.filter(
      (edge) => !(edge.from === from && edge.to === to),
    );
  }

  add(edge) {
    this.#edges.push({ direction: "forward", workspaceId: WORKSPACE_ID, ...edge });
  }

  all() {
    return [...this.#edges];
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

  async find() {
    return null;
  }

  async grant() {
    throw new Error("the scenario seeds grants from the manifest and never writes one");
  }

  async revoke() {
    return false;
  }

  async revokeAllForPlugin() {
    return 0;
  }
}

function nodeRecord(id, nodeType, content) {
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

function monitorContent({ samples, threshold = 80, source = "simulated" }) {
  return { source, threshold, samples, cursor: 0, lastSample: null };
}

function notifierContent(channel = "fixture-channel") {
  return { channel, notifications: [] };
}

/**
 * Build one chain. `edges` is `"linked"` (monitor → notifier), `"none"`
 * (both nodes exist, no alert edge), or `"fan-out"` (monitor → notifier and
 * monitor → second notifier).
 */
export async function createMonitorChain({
  edges = "linked",
  samples = [42, 91, 55, 93],
  source = "simulated",
  notifierChannel = "fixture-channel",
  failWritesFor = [],
} = {}) {
  const edgeRows = [
    {
      from: MONITOR_NODE_ID,
      to: NOTIFIER_NODE_ID,
      direction: "forward",
      semantic: MONITOR_ALERT_EDGE_SEMANTIC,
      workspaceId: WORKSPACE_ID,
    },
  ];
  if (edges === "fan-out") {
    edgeRows.push({
      from: MONITOR_NODE_ID,
      to: SECOND_NOTIFIER_NODE_ID,
      direction: "forward",
      semantic: MONITOR_ALERT_EDGE_SEMANTIC,
      workspaceId: WORKSPACE_ID,
    });
  }

  const nodes = new MemoryNodeStore(
    [
      nodeRecord(MONITOR_NODE_ID, "counter.monitor", monitorContent({ samples, source })),
      nodeRecord(NOTIFIER_NODE_ID, "counter.notifier", notifierContent(notifierChannel)),
      nodeRecord(SECOND_NOTIFIER_NODE_ID, "counter.notifier", notifierContent("second-channel")),
    ],
    { failWritesFor },
  );
  const edgeStore = new MemoryEdgeReader(edges === "none" ? [] : edgeRows);

  const { manifest } = await readPluginManifest(pluginDirectory);
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
  const jobs = new MemoryJobRepository();

  let now = FIXED_NOW;
  const clock = () => now;
  const advance = (ms) => {
    now = new Date(Date.parse(now) + ms).toISOString();
  };

  const triggers = createTriggerRegistry();
  const operations = createOperationRegistry(
    monitorOperations.map((definition) => ({
      definition,
      handler: (input, context) => handle(definition.id, input, context),
    })),
  );
  for (const trigger of monitorTriggers) {
    triggers.register(trigger, { manifests: [manifest], grants, operations });
  }

  const publisher = new EventPublisher({
    store: events,
    triggers,
    deliveries,
    nodes: { findByNodeType: async (nodeType) => nodes.byType(nodeType) },
    edges: edgeStore,
    bus: new InMemoryEventBus(),
    clock,
    onCascadeLimit: () => undefined,
    onRouteSkipped: (outcome) => {
      throw new Error(`${outcome.code}: ${outcome.detail}`);
    },
  });

  async function handle(operationId, input, context) {
    const run =
      context.runId === undefined ? null : await runs.findById(context.runId);
    const handler = {
      "counter.monitor.tick": counterMonitorTick,
      "counter.notify": counterNotify,
    }[operationId];
    if (handler === undefined) throw new Error(`no handler for "${operationId}"`);
    return handler(input, {
      ...context,
      ...(context.eventId === undefined && run?.eventId === undefined
        ? {}
        : { eventId: context.eventId ?? run.eventId }),
      writeNode: async (nodeId, patch) => {
        nodes.write(nodeId, patch.content);
      },
      emit: async (eventType, payload, options) => {
        const stored = await publisher.publish({
          eventType,
          aggregateType: "node",
          aggregateId: context.node.id,
          workspaceId: context.workspaceId,
          payload,
          correlationId: options.correlationId,
          causationId: context.eventId ?? run?.eventId ?? options.causationId,
          producer: context.actor,
          cascadeDepth: options.cascadeDepth,
        });
        return { eventId: stored.eventId };
      },
    });
  }

  const gateway = new CapabilityGateway({
    operations,
    nodes: {
      resolve: async (nodeId) => nodes.accessTarget(nodeId),
      assertCanInvoke: async () => undefined,
    },
    workspaces: {
      resolve: async (workspaceId) => ({ id: workspaceId }),
      assertCanWrite: async () => undefined,
      assertCanManage: async () => undefined,
    },
    runs,
    grants: grantRepository,
    now: clock,
  });

  const scopes = {
    async resolve(request) {
      if (request.automationId !== undefined) {
        throw new Error("the fixture declares no automation, so no scope closure exists");
      }
      return createExecutionScope({ kind: "workspace", workspaceId: request.workspaceId });
    },
  };
  const authorizeFactory = createEngineAuthorizer({ gateway, scopes, triggers });

  const dispatcher = new EngineOperationDispatcher({
    operations,
    nodes: { findById: async (nodeId) => nodes.entity(nodeId.value) },
    scopes,
    triggers,
    authorize: authorizeFactory,
    execute: (request) => executor.execute(request),
  });
  const executor = new OperationExecutor({
    runs,
    invoke: dispatcher,
    now: clock,
  });

  const nodeTypes = new Map(monitorNodeTypes.map((definition) => [definition.type, definition]));
  const scheduler = new SchedulerService({
    jobs,
    nodeTypes: { get: (type) => nodeTypes.get(type) },
    run: dispatcher,
    now: clock,
    owner: "scenario-scheduler",
  });

  const dispatch = new EventDispatchService({
    deliveries,
    events: {
      findById: async (eventId) => {
        const event = events.findById(eventId);
        if (event === null) return null;
        return {
          eventId: event.eventId,
          correlationId: event.correlationId,
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
    dispatch: dispatcher,
    operations: { find: (operationId) => operations.get(operationId)?.definition },
    authorize: authorizeFactory(undefined),
    now: clock,
    owner: "scenario-dispatcher",
  });

  for (const node of [MONITOR_NODE_ID]) {
    await scheduler.syncForNode({
      id: node,
      workspaceId: WORKSPACE_ID,
      nodeType: "counter.monitor",
    });
  }

  return {
    manifest,
    grants,
    nodes,
    edges: edgeStore,
    events,
    deliveries,
    runs,
    jobs,
    triggers,
    publisher,
    scheduler,
    dispatch,
    operations,
    advance,
    now: () => now,
    async tickScheduler() {
      return scheduler.tick();
    },
    async tickDispatcher() {
      return dispatch.tick();
    },
    eventRows(eventType) {
      return events.byType(eventType).map((event) => ({
        eventId: event.eventId,
        eventType: event.eventType,
        correlationId: event.correlationId,
        causationId: event.causationId,
        cascadeDepth: event.cascadeDepth,
        payload: event.payload,
      }));
    },
    runRows() {
      return runs.all().map((run) => ({
        id: run.id,
        operationId: run.operationId,
        status: run.status,
        correlationId: run.correlationId,
        eventId: run.eventId ?? null,
        deliveryId: run.deliveryId ?? null,
        triggerId: run.triggerId ?? null,
        actor: run.actor,
        error: run.error ?? null,
      }));
    },
    notificationOf(nodeId = NOTIFIER_NODE_ID) {
      const content = nodes.get(nodeId)?.content;
      return content?.notifications ?? [];
    },
  };
}

export { MONITOR_SAMPLE_INTERVAL_MS };
