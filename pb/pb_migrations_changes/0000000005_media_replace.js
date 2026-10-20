// SPDX-License-Identifier: AGPL-3.0-only

// An owner may now replace the stored blob of a `files` record in place, with
// the same record id. The Excalidraw save is the first caller: it keeps one
// storage unit per drawing, so the preview PNG overwrites the record instead of
// creating a new one. The update hook
// (`pb_hooks/lib/storage-limits.js` → `enforceFileUpdate`) re-checks the
// per-category ceiling and the per-user quota as a delta and recomputes `size`
// and `mimeType` from the replacement.
//
// The rule change is only to stop pinning `file`; `size` and `mimeType` stay
// pinned against the request body because the hook, not the client, writes
// them. Everything that decides where the bytes land or who owns them
// (`ownerId`, `workspaceId`, `derivedFrom`) stays pinned too.
//
// New databases get the same rule from
// `pb_migrations_base/0000000001_base_schema.js` and skip this file.
/// <reference path="../pb_data/types.d.ts" />

const AUTH = '@request.auth.id != ""';

/** The rule an existing database must carry after this migration. */
function ownerUpdateRule() {
  return (
    AUTH +
    " && ownerId = @request.auth.id" +
    " && @request.body.ownerId:changed = false" +
    " && @request.body.workspaceId:changed = false" +
    " && @request.body.size:changed = false" +
    " && @request.body.mimeType:changed = false" +
    " && @request.body.derivedFrom:changed = false"
  );
}

/**
 * The rule this migration replaces, restored on a rollback.
 *
 * It is the rule that `0000000004_media_analysis.js` left behind: the same pins
 * plus `file:changed = false`.
 */
function previousUpdateRule() {
  return (
    AUTH +
    " && ownerId = @request.auth.id" +
    " && @request.body.ownerId:changed = false" +
    " && @request.body.workspaceId:changed = false" +
    " && @request.body.size:changed = false" +
    " && @request.body.mimeType:changed = false" +
    " && @request.body.file:changed = false" +
    " && @request.body.derivedFrom:changed = false"
  );
}

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("files");
    collection.updateRule = ownerUpdateRule();
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("files");
    collection.updateRule = previousUpdateRule();
    app.save(collection);
  },
);
