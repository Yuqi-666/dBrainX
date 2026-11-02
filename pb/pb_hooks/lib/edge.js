// SPDX-License-Identifier: AGPL-3.0-only

// Scope validation for an edge created by an automation run.
//
// The switch is on since plan item 64. An edge that names a `runId` must belong
// to an automation whose materialised `automation_scope` closure contains both
// endpoints and is newer than the automation and both endpoint records. A person
// drawn edge (no `runId`) keeps the workspace checks only. Every lookup failure
// is a BadRequestError: an unverifiable scope never falls back to "allow".
var EDGE_SCOPE_CHECK = true;

function scopeTime(value) {
  if (!value) return NaN;
  var text = String(value);
  return Date.parse(text.indexOf(" ") === 10 ? text.replace(" ", "T") : text);
}

function assertFresh(recomputedAt, updatedAt, label) {
  var base = scopeTime(recomputedAt);
  var next = scopeTime(updatedAt);
  if (!Number.isFinite(base) || !Number.isFinite(next)) {
    throw new BadRequestError("Edge scope cannot be verified: " + label + " has no readable timestamp");
  }
  if (next > base) {
    throw new BadRequestError("Edge scope is stale: " + label + " changed after the closure was materialised");
  }
}

function automationForRun(e, run) {
  var workspaceId = run.getString("workspaceId");
  var triggerId = run.getString("triggerId");
  if (triggerId) {
    var automations = e.app.findRecordsByFilter(
      "automations",
      "workspaceId = {:workspaceId}",
      "",
      0,
      0,
      { workspaceId: workspaceId },
    );
    for (var index = 0; index < automations.length; index += 1) {
      var triggers = automations[index].get("triggerIds") || [];
      for (var trigger = 0; trigger < triggers.length; trigger += 1) {
        if (triggers[trigger] === triggerId) return automations[index];
      }
    }
    throw new BadRequestError("Edge scope cannot be verified: no automation owns this run");
  }

  // A user-initiated run is authorised by the workspace role, not by an
  // automation closure, so there is no closure to check. Any other actor that
  // names no automation cannot be verified and is refused: skipping the check
  // here would let a plugin write outside the scope that created it.
  var actorKind = run.getString("actorKind");
  if (actorKind === "user") return null;
  if (actorKind !== "scheduler") {
    throw new BadRequestError("Edge scope cannot be verified: a " + actorKind + " run names no automation");
  }

  var jobs = e.app.findRecordsByFilter(
    "scheduled_jobs",
    "workspaceId = {:workspaceId} && nodeId = {:nodeId} && operationId = {:operationId}",
    "",
    0,
    0,
    {
      workspaceId: workspaceId,
      nodeId: run.getString("nodeId"),
      operationId: run.getString("operationId"),
    },
  );
  for (var job = 0; job < jobs.length; job += 1) {
    var automationId = jobs[job].getString("automationId");
    if (!automationId) continue;
    var automation = e.app.findRecordById("automations", automationId);
    if (automation.getString("workspaceId") !== workspaceId) {
      throw new BadRequestError("Edge scope: automation belongs to another workspace");
    }
    return automation;
  }
  throw new BadRequestError("Edge scope cannot be verified: the scheduled run names no automation");
}

/**
 * Rejects an edge whose endpoints fall outside the automation scope that
 * created it.
 *
 * A `runId` is the only automation link an edge stores. The run names a trigger
 * or a scheduled job, which names the automation; that automation's
 * `automation_scope` rows are the closure. An empty closure, a missing row, an
 * unreadable timestamp, or a stale record is rejected, never skipped.
 */
function validateEdgeScope(e) {
  var runId = e.record.getString("runId");
  if (!runId) return;

  var workspaceId = e.record.getString("workspaceId");
  if (!workspaceId) throw new BadRequestError("Edge scope: workspace is required");

  var run;
  try {
    run = e.app.findRecordById("operation_runs", runId);
  } catch (error) {
    throw new BadRequestError("Edge scope cannot be verified: run " + runId + " is missing");
  }
  if (run.getString("workspaceId") !== workspaceId) {
    throw new BadRequestError("Edge scope: run belongs to another workspace");
  }

  var automation = automationForRun(e, run);
  if (!automation) return;

  var automationId = automation.id;
  var nodeIds = [];
  var recomputedAt = null;
  var recomputedMs = null;
  var endpoints = ["from", "to"];
  for (var field = 0; field < endpoints.length; field += 1) {
    var nodeId = e.record.getString(endpoints[field]);
    nodeIds.push(nodeId);
    var rows = e.app.findRecordsByFilter(
      "automation_scope",
      "automationId = {:automationId} && workspaceId = {:workspaceId} && nodeId = {:nodeId}",
      "",
      1,
      0,
      { automationId: automationId, workspaceId: workspaceId, nodeId: nodeId },
    );
    if (rows.length === 0) {
      throw new BadRequestError("Edge scope: node " + nodeId + " is outside automation " + automationId);
    }
    var rowStamp = rows[0].getString("recomputedAt");
    var rowMs = scopeTime(rowStamp);
    if (!Number.isFinite(rowMs)) {
      throw new BadRequestError("Edge scope cannot be verified: closure has no recomputedAt");
    }
    if (recomputedMs === null || rowMs < recomputedMs) {
      recomputedAt = rowStamp;
      recomputedMs = rowMs;
    }
  }

  assertFresh(recomputedAt, automation.getString("updated"), "automation " + automationId);
  for (var node = 0; node < nodeIds.length; node += 1) {
    var record = e.app.findRecordById("nodes", nodeIds[node]);
    assertFresh(recomputedAt, record.getString("updated"), "node " + nodeIds[node]);
  }
}

// Text foreign keys must never connect nodes from different workspaces.
function validateEdge(e) {
  const workspace = e.record.getString("workspaceId");
  if (!workspace) throw new BadRequestError("Workspace is required");
  for (const field of ["from", "to"]) {
    const node = e.app.findRecordById("nodes", e.record.getString(field));
    if (node.getString("workspaceId") !== workspace) throw new BadRequestError("Edge endpoints must belong to its workspace");
  }
  // New edges have no semantic until the user selects one in the edge menu.
  const semanticId = e.record.getString("semanticId");
  if (semanticId) {
    const semantic = e.app.findRecordById("edge_semantics", semanticId);
    if (semantic.getString("workspaceId") !== workspace) throw new BadRequestError("Edge semantic must belong to its workspace");
  }
  if (EDGE_SCOPE_CHECK) validateEdgeScope(e);
  return e.next();
}
module.exports = { validateEdge, validateEdgeScope, EDGE_SCOPE_CHECK };
