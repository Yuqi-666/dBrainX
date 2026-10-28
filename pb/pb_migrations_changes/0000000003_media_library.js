// SPDX-License-Identifier: AGPL-3.0-only

// Media resources need three pieces of metadata the `files` collection never
// stored:
//
//   * `size`  — the byte length. The per-user storage quota counts it, and the
//               resource library shows it. It is written by the PocketBase hook
//               from the unsaved upload, never accepted from a client.
//   * `mimeType` — what the library groups by. Also written by the hook.
//   * `displayName` — the user-editable label. PocketBase names the stored blob
//               with a random suffix, and the file bytes must not change when a
//               resource is renamed, so a rename edits this field only.
//
// The owner may now update a record, because a rename is an update. The rule
// pins every field that decides what is stored or who owns it, so a rename can
// never become an upload that skips the quota check above.
//
// Historic rows get their size from the local storage directory. A deployment
// that keeps files in S3 cannot stat them here, so those rows stay at 0 and are
// therefore not counted against the quota — an underestimate is preferable to
// refusing uploads over a size nobody can read.
/// <reference path="../pb_data/types.d.ts" />

/**
 * The byte length of one stored blob, or 0 when it cannot be read.
 *
 * `record.baseFilesPath()` is relative to the app's `storage` directory
 * (`<collectionId>/<recordId>`); PocketBase resolves it against
 * `<dataDir>/storage/`. A deployment whose files live in S3 has no local path to
 * stat, so it falls through to 0 — the quota then undercounts old records rather
 * than refusing every upload.
 */
function storedFileSize(app, record) {
  const fileName = record.getString("file");
  if (!fileName) return 0;
  try {
    const base =
      typeof record.baseFilesPath === "function"
        ? record.baseFilesPath()
        : record.baseFilesPath;
    if (!base) return 0;
    const info = $os.stat(`${app.dataDir()}/storage/${base}/${fileName}`);
    if (!info) return 0;
    const size = typeof info.size === "function" ? info.size() : info.size;
    return typeof size === "number" && size > 0 ? size : 0;
  } catch (_) {
    return 0;
  }
}

function addMediaFields(collection) {
  collection.fields.add(new NumberField({ name: "size", min: 0 }));
  collection.fields.add(new TextField({ name: "mimeType", max: 200 }));
  collection.fields.add(new TextField({ name: "displayName", max: 300 }));
}

function removeMediaFields(collection) {
  for (const name of ["size", "mimeType", "displayName"]) {
    collection.fields.removeByName(name);
  }
}

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("files");
    addMediaFields(collection);

    // The label is the one field an owner may edit. Everything else that
    // decides where the bytes land, who owns them or how big they are stays
    // server-owned: the hook writes it, and an update may not touch it.
    collection.updateRule =
      '@request.auth.id != "" && ownerId = @request.auth.id' +
      " && @request.body.ownerId:changed = false" +
      " && @request.body.workspaceId:changed = false" +
      " && @request.body.size:changed = false" +
      " && @request.body.mimeType:changed = false" +
      " && @request.body.file:changed = false";
    app.save(collection);

    // Backfill the accounting field so the quota and the storage view include
    // the files that were uploaded before this migration.
    for (const record of app.findAllRecords("files")) {
      if (record.getFloat("size") > 0) continue;
      const size = storedFileSize(app, record);
      if (size === 0) continue;
      record.set("size", size);
      app.save(record);
    }
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("files");
    collection.updateRule = null;
    removeMediaFields(collection);
    app.save(collection);
  },
);
