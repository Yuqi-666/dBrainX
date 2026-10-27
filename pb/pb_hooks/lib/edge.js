// SPDX-License-Identifier: AGPL-3.0-only

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
  return e.next();
}
module.exports = { validateEdge };
