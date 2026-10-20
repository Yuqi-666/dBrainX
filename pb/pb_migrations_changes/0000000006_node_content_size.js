// SPDX-License-Identifier: AGPL-3.0-only

// A web page node stores its HTML source in `nodes.content`, and PocketBase caps
// a JSON field at 1 MiB unless the field sets a size. The web page file category
// accepts sources up to `DBRAIN_STORAGE_MAX_WEBPAGE_BYTES` (16 MiB by default),
// so an imported source could never be written: PocketBase answered the node
// update with "The maximum allowed JSON size is 1048576 bytes", which the editor
// showed as a failed import. The ceiling is now high enough for the largest
// source the default policy allows, with room for the JSON escaping.
//
// The value mirrors `NODE_CONTENT_MAX_BYTES` in
// `packages/utils/src/node-content.ts`; a release test keeps the two equal.
//
// New databases get the same ceiling from
// `pb_migrations_base/0000000001_base_schema.js` and skip this file.
/// <reference path="../pb_data/types.d.ts" />

const NODE_CONTENT_MAX_BYTES = 24 * 1024 * 1024;

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("nodes");
    collection.fields.getByName("content").maxSize = NODE_CONTENT_MAX_BYTES;
    app.save(collection);
  },
  (app) => {
    // Zero means the PocketBase default (1 MiB).
    const collection = app.findCollectionByNameOrId("nodes");
    collection.fields.getByName("content").maxSize = 0;
    app.save(collection);
  },
);
