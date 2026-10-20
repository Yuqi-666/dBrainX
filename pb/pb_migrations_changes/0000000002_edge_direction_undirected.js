// SPDX-License-Identifier: AGPL-3.0-only

// The `edges.direction` select listed "unidirectional" while the domain, the
// API, and the UI all say "undirected". Those two words mean opposite things:
// forward and reverse are the unidirectional states, while this state draws
// no arrowhead at all. Rename the stored value and carry existing rows over.
// New databases get the renamed field from the base schema and skip this file.
/// <reference path="../pb_data/types.d.ts" />
const UNDIRECTED = "undirected";
const LEGACY_UNDIRECTED = "unidirectional";
const FORWARD = "forward";
const REVERSE = "reverse";
const BIDIRECTIONAL = "bidirectional";

function setSelectValues(app, values) {
  const collection = app.findCollectionByNameOrId("edges");
  const field = collection.fields.getByName("direction");
  if (!field) throw new Error("edges.direction field is missing");
  field.values = values;
  app.save(collection);
}

function replaceStoredDirection(app, from, to) {
  for (const record of app.findAllRecords("edges")) {
    if (record.getString("direction") !== from) continue;
    record.set("direction", to);
    app.save(record);
  }
}

migrate(
  (app) => {
    // Widen the whitelist first, so the migrated rows pass validation.
    setSelectValues(app, [FORWARD, REVERSE, BIDIRECTIONAL, UNDIRECTED]);
    replaceStoredDirection(app, LEGACY_UNDIRECTED, UNDIRECTED);
  },
  (app) => {
    setSelectValues(app, [FORWARD, REVERSE, BIDIRECTIONAL, LEGACY_UNDIRECTED]);
    replaceStoredDirection(app, UNDIRECTED, LEGACY_UNDIRECTED);
  },
);
