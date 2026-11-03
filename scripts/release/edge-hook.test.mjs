// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { runInNewContext } from "node:vm";

const scope = { module: { exports: {} }, BadRequestError: Error };
runInNewContext(readFileSync(new URL("../../pb/pb_hooks/lib/edge.js", import.meta.url), "utf8"), scope);
const { validateEdge } = scope.module.exports;

const T0 = "2026-11-02T00:00:00.000Z";
const at = (seconds) => new Date(Date.parse(T0) + seconds * 1_000).toISOString();

function automation({ id = "auto-1", triggerIds = [], updated = T0, workspaceId = "w" } = {}) {
  return {
    id,
    getString: (field) => field === "workspaceId" ? workspaceId : field === "updated" ? updated : "",
    get: (field) => field === "triggerIds" ? triggerIds : field === "updated" ? updated : undefined,
  };
}

function scopeRow(nodeId, recomputedAt) {
  return {
    nodeId,
    recomputedAt,
    getString: (field) => field === "recomputedAt" ? recomputedAt : "",
    get: (field) => field === "recomputedAt" ? recomputedAt : undefined,
  };
}

function job(automationId) {
  return { getString: (field) => field === "automationId" ? automationId : "" };
}

function event({
  semanticId = "",
  targetWorkspace = "w",
  semanticWorkspace = "w",
  runId = "",
  run = null,
  automations = [],
  closureRows = [],
  nodeUpdated = T0,
} = {}) {
  const lookups = [];
  const values = { workspaceId: "w", from: "source", to: "target", semanticId, runId };
  return {
    lookups,
    record: { getString: (field) => values[field] },
    app: {
      findRecordById(collection, id) {
        lookups.push([collection, id]);
        if (!id) throw new Error("Record not found");
        if (collection === "edge_semantics") return { getString: () => semanticWorkspace };
        if (collection === "nodes") {
          return {
            id,
            getString: (field) => field === "workspaceId" ? (id === "target" ? targetWorkspace : "w") : field === "updated" ? nodeUpdated : "",
            get: (field) => field === "updated" ? nodeUpdated : undefined,
          };
        }
        if (collection === "operation_runs" && run) {
          return { id, getString: (field) => run[field] ?? "", get: (field) => run[field] };
        }
        if (collection === "automations") {
          const found = automations.find((entry) => entry.id === id);
          if (found) return found;
        }
        throw new Error("Record not found");
      },
      findRecordsByFilter(collection, _filter, _sort, _limit, _offset, params) {
        if (collection === "automations") {
          return automations.filter((entry) => entry.getString("workspaceId") === params.workspaceId);
        }
        if (collection === "scheduled_jobs") return run?.jobs ?? [];
        if (collection === "automation_scope") {
          return closureRows
            .filter((entry) => entry.nodeId === params.nodeId)
            .map((entry) => ({
              getString: (field) => field === "recomputedAt" ? entry.recomputedAt : "",
              get: (field) => field === "recomputedAt" ? entry.recomputedAt : undefined,
            }));
        }
        return [];
      },
    },
    next: () => "saved",
  };
}

function automationRun(overrides = {}) {
  return {
    workspaceId: "w",
    triggerId: "trigger-1",
    actorKind: "plugin",
    nodeId: "",
    operationId: "",
    ...overrides,
  };
}

test("the edge hook refuses an out-of-scope automation edge and accepts an in-scope one", () => {
  const automations = [automation({ triggerIds: ["trigger-1"] })];
  const closureRows = [scopeRow("source", at(60)), scopeRow("target", at(60))];
  const accepted = event({ runId: "run-1", run: automationRun(), automations, closureRows });
  assert.equal(validateEdge(accepted), "saved");
  const refused = event({
    runId: "run-1",
    run: automationRun(),
    automations,
    closureRows: [scopeRow("source", at(60))],
  });
  assert.throws(() => validateEdge(refused), /node target is outside automation auto-1/);
});

test("untyped edges validate both endpoints without looking up an empty semantic", () => {
  const e = event();
  assert.equal(validateEdge(e), "saved");
  assert.deepEqual(e.lookups, [["nodes", "source"], ["nodes", "target"]]);
});

test("semantic selection validates its workspace and rejects missing records", () => {
  assert.equal(validateEdge(event({ semanticId: "semantic" })), "saved");
  assert.throws(() => validateEdge(event({ semanticId: "semantic", semanticWorkspace: "foreign" })), /semantic must belong/);
  const e = event({ semanticId: "missing" });
  const lookup = e.app.findRecordById;
  e.app.findRecordById = (collection, id) => {
    if (collection === "edge_semantics") throw new Error("Record not found");
    return lookup(collection, id);
  };
  assert.throws(() => validateEdge(e), /Record not found/);
});

test("omitting semantics does not bypass endpoint workspace checks", () => {
  assert.throws(() => validateEdge(event({ targetWorkspace: "foreign" })), /endpoints must belong/);
});

test("a person-drawn edge is not scope checked", () => {
  assert.equal(validateEdge(event()), "saved");
});

test("an in-scope automation edge is accepted", () => {
  const e = event({
    runId: "run-1",
    run: automationRun(),
    automations: [automation({ triggerIds: ["trigger-1"] })],
    closureRows: [
      scopeRow("source", "2026-11-02 00:01:00.000Z"),
      scopeRow("target", "2026-11-02 00:01:00.000Z"),
    ],
    nodeUpdated: at(30),
  });
  assert.equal(validateEdge(e), "saved");
});

test("an endpoint outside the materialised closure is refused", () => {
  const e = event({
    runId: "run-1",
    run: automationRun(),
    automations: [automation({ triggerIds: ["trigger-1"] })],
    closureRows: [scopeRow("source", at(60))],
  });
  assert.throws(() => validateEdge(e), /node target is outside automation auto-1/);
});

test("an empty closure is refused", () => {
  const e = event({
    runId: "run-1",
    run: automationRun(),
    automations: [automation({ triggerIds: ["trigger-1"] })],
    closureRows: [],
  });
  assert.throws(() => validateEdge(e), /node source is outside automation auto-1/);
});

test("a closure older than the automation is refused", () => {
  const e = event({
    runId: "run-1",
    run: automationRun(),
    automations: [automation({ triggerIds: ["trigger-1"], updated: at(120) })],
    closureRows: [scopeRow("source", at(60)), scopeRow("target", at(60))],
  });
  assert.throws(() => validateEdge(e), /stale: automation auto-1 changed/);
});

test("a closure older than an endpoint node is refused", () => {
  const e = event({
    runId: "run-1",
    run: automationRun(),
    automations: [automation({ triggerIds: ["trigger-1"] })],
    closureRows: [scopeRow("source", at(60)), scopeRow("target", at(60))],
    nodeUpdated: at(120),
  });
  assert.throws(() => validateEdge(e), /stale: node source changed/);
});

test("a missing run cannot be verified", () => {
  const e = event({ runId: "run-missing" });
  assert.throws(() => validateEdge(e), /run run-missing is missing/);
});

test("a run whose trigger owns no automation is refused", () => {
  const e = event({
    runId: "run-1",
    run: automationRun(),
    automations: [automation({ triggerIds: ["other-trigger"] })],
    closureRows: [scopeRow("source", at(60)), scopeRow("target", at(60))],
  });
  assert.throws(() => validateEdge(e), /no automation owns this run/);
});

test("a user-acted run is authorised by its role and not scope checked", () => {
  const e = event({
    runId: "run-1",
    run: automationRun({ triggerId: "", actorKind: "user" }),
  });
  assert.equal(validateEdge(e), "saved");
});

test("a plugin-acted run that names no automation is refused", () => {
  const e = event({
    runId: "run-1",
    run: automationRun({ triggerId: "", actorKind: "plugin" }),
  });
  assert.throws(() => validateEdge(e), /a plugin run names no automation/);
});

test("a scheduled run resolves its automation through its job", () => {
  const e = event({
    runId: "run-1",
    run: automationRun({
      triggerId: "",
      actorKind: "scheduler",
      nodeId: "source",
      operationId: "timer.tick",
      jobs: [job("auto-1")],
    }),
    automations: [automation({ id: "auto-1" })],
    closureRows: [scopeRow("source", at(60)), scopeRow("target", at(60))],
  });
  assert.equal(validateEdge(e), "saved");
});

test("a scheduled run with no automation is refused", () => {
  const e = event({
    runId: "run-1",
    run: automationRun({
      triggerId: "",
      actorKind: "scheduler",
      nodeId: "source",
      operationId: "timer.tick",
      jobs: [job("")],
    }),
    closureRows: [scopeRow("source", at(60)), scopeRow("target", at(60))],
  });
  assert.throws(() => validateEdge(e), /scheduled run names no automation/);
});
