// SPDX-License-Identifier: AGPL-3.0-only

// Every create request on `files` goes through one enforcement point: it sets
// the owner from the verified token, applies the per-category file ceiling and
// the per-user storage quota, and stamps the size / MIME type / default display
// name the resource library reads. The module also serves the API's own store
// writes, so a derived artifact (a PDF cover, an HLS segment) is accounted too.
onRecordCreateRequest(
  (e) => require(`${__hooks}/lib/storage-limits.js`).enforceFileCreate(e),
  "files",
);
// An owner may replace the stored blob in place (same record id): the
// Excalidraw save rewrites its preview that way. The update rule lets the
// `file` field change and pins everything that decides where the bytes land and
// who owns them; this hook re-runs the ceiling and the quota as a delta and
// recomputes the stored metadata from the replacement. An update without a new
// file (a rename, the analysis cache) passes straight through.
onRecordUpdateRequest(
  (e) => require(`${__hooks}/lib/storage-limits.js`).enforceFileUpdate(e),
  "files",
);
// Keep native Range/media support while authorizing every direct file download.
onFileDownloadRequest((e) => {
  if (e.collection.name !== "files") return e.next();
  const request = e.requestEvent || e;
  let auth = request.auth;
  // Local development uses direct PocketBase media URLs. Browser media elements
  // cannot attach Authorization, but same-site requests carry the session cookie.
  if (!auth && (request.request.method === "GET" || request.request.method === "HEAD")) {
    const match = request.request.header.get("Cookie").match(/(?:^|;\s*)pb_token=([^;]+)/);
    if (match) { try { auth = request.app.findAuthRecordByToken(decodeURIComponent(match[1]), "auth"); } catch (_) {} }
  }
  if (!auth || auth.collection().name !== "users") throw new NotFoundError("File not found");
  if (e.record.getString("ownerId") === auth.id) return e.next();
  const workspaceId = e.record.getString("workspaceId");
  if (workspaceId) {
    try {
      const workspace = request.app.findRecordById("workspaces", workspaceId);
      if (workspace.getString("ownerId") === auth.id) return e.next();
      request.app.findFirstRecordByFilter("workspace_members", "workspaceId = {:workspace} && userId = {:user}", { workspace: workspaceId, user: auth.id });
      return e.next();
    } catch (_) {}
  }
  throw new NotFoundError("File not found");
});
// A resource owns the artifacts the server derived from it: a PDF cover, an
// HLS playlist, its segments, a video poster. They are hidden from the resource
// library and deleted together with the resource, so the bytes the library
// frees are the bytes the quota charged. See `pb_hooks/lib/media-derived.js`.
// Before those rows go, every node that points at the deleted blob loses the
// link (`pb_hooks/lib/node-references.js`); the artifact deletion then repeats
// the same cleanup for the artifacts. Both steps are best effort: the source is
// already gone, so a failure must not abort the request.
onRecordAfterDeleteSuccess((e) => {
  if (e.collection && e.collection.name !== "files") return;
  require(`${__hooks}/lib/node-references.js`).detachNodeReferences(e);
  require(`${__hooks}/lib/media-derived.js`).deleteDerived(e);
}, "files");
