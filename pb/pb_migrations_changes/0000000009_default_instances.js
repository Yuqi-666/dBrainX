// SPDX-License-Identifier: AGPL-3.0-only

// Every user gets one workspace and every workspace one global view, created by
// the server itself. Those two instances must stay: deleting the default
// workspace would delete everything the user sees on first login, and deleting
// the default view would leave the graph with nothing to render. A rename stays
// possible, so the rule is "cannot delete", not "cannot edit".
//
// The schema now carries that fact in one server-owned column on each
// collection:
//
//   * `workspaces.isDefault` — true for the workspace provisioned on a user's
//               first login;
//   * `views.isDefault` — true for the global view created with a workspace.
//
// A client may not change the column (the update rules pin it), because clearing
// the flag would make the protected instance deletable again. Existing databases
// also need the flag filled in: the provisioning code creates the default
// workspace/view before any user-created instance, and the collections carry no
// `created` column, so the first record of each group in storage order is the
// instance to mark.
//
// New databases get both columns from
// `pb_migrations_base/0000000001_base_schema.js` and skip this file.
/// <reference path="../pb_data/types.d.ts" />

const IS_DEFAULT_PIN = " && @request.body.isDefault:changed = false";

/**
 * The first record of every group, keyed by `key`.
 *
 * `workspaces` and `views` never declared an autodate field, so their tables have
 * no `created` column (`views` has an `isPinned` flag, but no timestamps). The
 * order `findAllRecords` returns is therefore the only ordering available, and it
 * is insertion order: the provisioning code writes the default workspace/view
 * before any user-created instance. A record without a group key belongs to
 * nothing and is skipped rather than guessed.
 */
function firstPerGroup(records, key) {
  const first = new Map();
  for (const record of records) {
    if (!record) continue;
    const group = record.getString(key);
    if (!group || first.has(group)) continue;
    first.set(group, record);
  }
  return Array.from(first.values());
}

/** Marks the first record of each group as the default and saves it once. */
function markFirstDefault(app, collection, groupKey) {
  for (const record of firstPerGroup(
    app.findAllRecords(collection),
    groupKey,
  )) {
    if (record.getBool("isDefault")) continue;
    record.set("isDefault", true);
    app.save(record);
  }
}

migrate(
  (app) => {
    const auth = '@request.auth.id != ""';
    const owner =
      "@collection.workspaces:workspace_scope.id ?= workspaceId && @collection.workspaces:workspace_scope.ownerId ?= @request.auth.id";
    const member =
      "@collection.workspace_members:membership_scope.workspaceId ?= workspaceId && @collection.workspace_members:membership_scope.userId ?= @request.auth.id";
    const editor =
      member +
      ' && @collection.workspace_members:membership_scope.role ?!= "viewer"';
    const write = auth + " && (" + owner + " || (" + editor + "))";

    const workspaces = app.findCollectionByNameOrId("workspaces");
    workspaces.fields.add(new BoolField({ name: "isDefault" }));
    workspaces.updateRule =
      auth +
      " && ownerId = @request.auth.id && @request.body.ownerId:changed = false" +
      IS_DEFAULT_PIN;
    app.save(workspaces);

    const views = app.findCollectionByNameOrId("views");
    views.fields.add(new BoolField({ name: "isDefault" }));
    views.updateRule =
      write +
      " && @request.body.workspaceId:changed = false" +
      IS_DEFAULT_PIN;
    app.save(views);

    markFirstDefault(app, "workspaces", "ownerId");
    markFirstDefault(app, "views", "workspaceId");
  },
  (app) => {
    const workspaces = app.findCollectionByNameOrId("workspaces");
    workspaces.fields.removeByName("isDefault");
    workspaces.updateRule = String(workspaces.updateRule).replace(
      IS_DEFAULT_PIN,
      "",
    );
    app.save(workspaces);

    const views = app.findCollectionByNameOrId("views");
    views.fields.removeByName("isDefault");
    views.updateRule = String(views.updateRule).replace(IS_DEFAULT_PIN, "");
    app.save(views);
  },
);
