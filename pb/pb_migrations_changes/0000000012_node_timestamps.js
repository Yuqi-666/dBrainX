// SPDX-License-Identifier: AGPL-3.0-only

// `nodes` and `edges` declare `created` / `updated`.
//
// A PocketBase base collection has no implicit timestamp columns (only `id`),
// and neither collection had them, while both mappers read `record.created` /
// `record.updated`. Every read produced `undefined`, `Node.create` /
// `Edge.create` replaced it with `new Date()`, and two reads of one row reported
// two different versions (measured: .600Z → .612Z → .614Z → .618Z). That made
// `expectedVersion` unsatisfiable and `VERSION_CONFLICT` unreachable.
//
// Rows that already exist have no historical timestamp — it was never stored,
// and PocketBase drops an explicit value for an autodate field on save
// (`record.set("created", …)` is ignored, measured on this build), so the
// backfill writes the columns directly in the format the server itself stores.
// It stamps the moment the migration runs: not the original creation time, but a
// value that is identical across reads and moves forward on the next write.
//
// New databases get both field pairs from
// `pb_migrations_base/0000000001_base_schema.js` and skip this file. `views`,
// `workspaces`, and `workspace_members` are left alone: no read compares their
// timestamps. `files` and `event_log` already declare what they need.
/// <reference path="../pb_data/types.d.ts" />

const TIMESTAMPED_COLLECTIONS = ["nodes", "edges"];

const TIMESTAMP_FIELDS = [
  // Written once, on insert.
  { name: "created", onCreate: true },
  // The version marker: every update must move it forward.
  { name: "updated", onCreate: true, onUpdate: true },
];

// PocketBase's stored datetime format (`YYYY-MM-DD HH:MM:SS.sssZ`, UTC).
const NOW = "strftime('%Y-%m-%d %H:%M:%fZ', 'now')";

function countMissing(app, name) {
  const rows = arrayOf(new DynamicModel({ total: 0 }));
  app
    .db()
    .newQuery(
      `SELECT COUNT(*) AS total FROM ${name} ` +
        "WHERE created IS NULL OR created = '' OR updated IS NULL OR updated = ''",
    )
    .all(rows);
  return rows.length === 0 ? 0 : Number(rows[0].total);
}

function ensureTimestamps(app, name) {
  const collection = app.findCollectionByNameOrId(name);
  const added = [];
  for (const field of TIMESTAMP_FIELDS) {
    if (collection.fields.getByName(field.name)) continue;
    collection.fields.add(new AutodateField(field));
    added.push(field.name);
  }
  if (added.length > 0) app.save(collection);
  const stale = countMissing(app, name);
  if (stale > 0) {
    app
      .db()
      .newQuery(
        `UPDATE ${name} SET ` +
          `created = CASE WHEN created IS NULL OR created = '' THEN ${NOW} ELSE created END, ` +
          `updated = CASE WHEN updated IS NULL OR updated = '' THEN ${NOW} ELSE updated END ` +
          "WHERE created IS NULL OR created = '' OR updated IS NULL OR updated = ''",
      )
      .execute();
  }
  const columns = added.length > 0 ? `added ${added.join(", ")}` : "columns already present";
  console.log(`[0012] ${name}: ${columns}; backfilled ${stale} record(s)`);
}

function removeTimestamps(app, name) {
  const collection = app.findCollectionByNameOrId(name);
  const removed = [];
  for (const field of ["updated", "created"]) {
    if (!collection.fields.getByName(field)) continue;
    collection.fields.removeByName(field);
    removed.push(field);
  }
  if (removed.length === 0) {
    console.log(`[0012] ${name}: no timestamp columns to drop`);
    return;
  }
  app.save(collection);
  console.log(`[0012] ${name}: dropped ${removed.join(", ")}`);
}

migrate(
  (app) => {
    for (const name of TIMESTAMPED_COLLECTIONS) ensureTimestamps(app, name);
  },
  (app) => {
    // The timestamps are dropped with the columns: `created` has no other
    // source, and `updated` only ever mirrored the writes it recorded.
    for (const name of TIMESTAMPED_COLLECTIONS) removeTimestamps(app, name);
  },
);
