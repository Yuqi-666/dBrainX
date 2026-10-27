// SPDX-License-Identifier: AGPL-3.0-only

onRecordCreateRequest((e) => require(`${__hooks}/lib/edge.js`).validateEdge(e), "edges");
onRecordUpdateRequest((e) => require(`${__hooks}/lib/edge.js`).validateEdge(e), "edges");
