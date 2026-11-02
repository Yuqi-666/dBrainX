// SPDX-License-Identifier: AGPL-3.0-only

// `automations` declares `created` / `updated`.
//
// The edge hook compares an automation's `updated` against the
// `automation_scope.recomputedAt` of its closure, and the automation domain
// model carries both timestamps. The table had neither column: a base
// collection has no implicit timestamp pair (see 0012), so the hook read an
// empty string and every automation-created edge was refused as
// "cannot be verified". The materialiser (plan item 65) writes those closures,
// so the comparison has to have a source.
//
// Existing rows get the moment this migration runs. That is not their original
// creation time — it was never stored — but it is one stable value that every
// later write moves forward, which is exactly what the freshness check needs.
//
// New databases get both columns from `pb_migrations_base/0000000001_base_schema.js`.
/// <reference path="../pb_data/types.d.ts" />

const COLLECTION = "automations";

const TIMESTAMP_FIELDS = [
  { name: "created", onCreate: true },
  { name: "updated", onCreate: true, onUpdate: true },
];

const NOW = "strftime('%Y-%m-%d %H:%M:%fZ', 'now')";

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId(COLLECTION);
    const added = [];
    for (const field of TIMESTAMP_FIELDS) {
      if (collection.fields.getByName(field.name)) continue;
      collection.fields.add(new AutodateField(field));
      added.push(field.name);
    }
    if (added.length > 0) app.save(collection);
    app
      .db()
      .newQuery(
        `UPDATE ${COLLECTION} SET ` +
          `created = CASE WHEN created IS NULL OR created = '' THEN ${NOW} ELSE created END, ` +
          `updated = CASE WHEN updated IS NULL OR updated = '' THEN ${NOW} ELSE updated END ` +
          "WHERE created IS NULL OR created = '' OR updated IS NULL OR updated = ''",
      )
      .execute();
    console.log(
      `[0014] ${COLLECTION}: ` +
        (added.length === 0 ? "columns already present" : `added ${added.join(", ")}`),
    );
  },
  (app) => {
    const collection = app.findCollectionByNameOrId(COLLECTION);
    for (const field of ["updated", "created"]) {
      if (!collection.fields.getByName(field)) continue;
      collection.fields.removeByName(field);
    }
    app.save(collection);
  },
);
