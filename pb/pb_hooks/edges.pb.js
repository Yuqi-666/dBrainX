// SPDX-License-Identifier: AGPL-3.0-only

// The automation-scope validation switch lives in `lib/edge.js`
// (`EDGE_SCOPE_CHECK`, on since plan item 64). Both write paths go through the
// same `validateEdge`, so the switch covers them together.
onRecordCreateRequest((e) => require(`${__hooks}/lib/edge.js`).validateEdge(e), "edges");
onRecordUpdateRequest((e) => require(`${__hooks}/lib/edge.js`).validateEdge(e), "edges");
