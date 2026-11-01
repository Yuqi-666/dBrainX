// SPDX-License-Identifier: AGPL-3.0-only

// Scope validation for an edge created by an automation run.
//
// TODO(engine: turn on in 64): the automation-scope contract — the
// `automation_scope` closure and the `ExecutionScope` it is checked against —
// lands in todo 64, and that change is the one that turns this switch on.
// While it stays off, `validateEdge` performs the workspace checks below and
// nothing else, so the hook rejects exactly what it rejected before.
var EDGE_SCOPE_CHECK = false;

/**
 * Rejects an edge whose endpoints fall outside the automation scope that
 * created it.
 *
 * This is the seam todo 64 fills in. It is deliberately inert today: turning
 * `EDGE_SCOPE_CHECK` on before the closure lookup exists must not change what
 * the hook accepts or rejects.
 */
function validateEdgeScope(e) {
  return;
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
