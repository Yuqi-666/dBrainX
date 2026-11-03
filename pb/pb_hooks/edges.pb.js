// SPDX-License-Identifier: AGPL-3.0-only

// The automation-scope validation lives in `lib/edge.js`. Both write paths go
// through the same `validateEdge`, so create and update are covered together.
onRecordCreateRequest((e) => require(`${__hooks}/lib/edge.js`).validateEdge(e), "edges");
onRecordUpdateRequest((e) => require(`${__hooks}/lib/edge.js`).validateEdge(e), "edges");
