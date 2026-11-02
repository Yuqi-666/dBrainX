// SPDX-License-Identifier: AGPL-3.0-only

// `automation_scope.recomputedAt` records the instant a closure was computed.
//
// It was an autodate column, so PocketBase stamped each row *after* the graph
// read. A node or edge written while the closure was being computed then looked
// older than the closure, and the next resolution served that stale set as
// fresh. The service stamps the instant before its graph read
// (`automation-scope.service.ts`) and hands it to the repository; the column has
// to store that value instead of overwriting it.
//
// A PocketBase field cannot change its type in place, and removing and
// re-adding the column would drop the values. The migration therefore parks the
// old stamps in a temporary date column, swaps the field, and copies them back.
// An installed database reaches the date shape with its instants intact; a
// fresh database gets the same shape from
// `pb_migrations_base/0000000001_base_schema.js`.
/// <reference path="../pb_data/types.d.ts" />

const COLLECTION = "automation_scope";
const FIELD = "recomputedAt";
const PARKED = "recomputedAtParked";

function typeOf(field) {
  return typeof field.type === "function" ? String(field.type()) : "";
}

/** Moves every stamp through a temporary column while the field is rebuilt. */
function convert(app, collection, field) {
  collection.fields.add(new DateField({ name: PARKED }));
  app.save(collection);
  app
    .db()
    .newQuery(
      `UPDATE ${COLLECTION} SET ${PARKED} = ${FIELD} ` +
        `WHERE ${FIELD} IS NOT NULL AND ${FIELD} <> ''`,
    )
    .execute();
  collection.fields.removeByName(FIELD);
  collection.fields.add(field);
  app.save(collection);
  app
    .db()
    .newQuery(
      `UPDATE ${COLLECTION} SET ${FIELD} = ${PARKED} ` +
        `WHERE ${PARKED} IS NOT NULL AND ${PARKED} <> ''`,
    )
    .execute();
  collection.fields.removeByName(PARKED);
  app.save(collection);
}

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId(COLLECTION);
    const existing = collection.fields.getByName(FIELD);
    if (!existing) {
      throw new Error(`[0015] ${COLLECTION} has no ${FIELD} field`);
    }
    const type = typeOf(existing);
    if (type === "date") {
      console.log(`[0015] ${COLLECTION}.${FIELD} is already a date column`);
      return;
    }
    if (type !== "autodate") {
      throw new Error(
        `[0015] ${COLLECTION}.${FIELD} is ${type}, expected autodate or date`,
      );
    }
    convert(app, collection, new DateField({ name: FIELD }));
    console.log(`[0015] ${COLLECTION}.${FIELD} is now a writable date column`);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId(COLLECTION);
    const existing = collection.fields.getByName(FIELD);
    if (!existing) {
      throw new Error(`[0015] ${COLLECTION} has no ${FIELD} field`);
    }
    if (typeOf(existing) === "autodate") return;
    convert(
      app,
      collection,
      new AutodateField({ name: FIELD, onCreate: true, onUpdate: true }),
    );
  },
);
