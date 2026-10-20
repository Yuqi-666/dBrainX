// SPDX-License-Identifier: AGPL-3.0-only

// A workspace shows an icon in front of its name in the workspace picker, and
// the edit dialog lets the owner pick an emoji or a Lucide graphic. The value is
// the same JSON shape a node uses (`{ kind: "emoji" | "icon", value, color? }`),
// but a workspace only accepts the emoji and icon kinds: it has no file of its
// own to upload an image to.
//
// Only an owner may change the column. The update rule pins `ownerId` and
// `isDefault`, not `icon`, so the owner's edit reaches the database while a
// member and a forged `isDefault` still do not.
//
// New databases get the column from
// `pb_migrations_base/0000000001_base_schema.js` and skip this file.
/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const workspaces = app.findCollectionByNameOrId("workspaces");
    workspaces.fields.add(new JSONField({ name: "icon" }));
    app.save(workspaces);
  },
  (app) => {
    const workspaces = app.findCollectionByNameOrId("workspaces");
    workspaces.fields.removeByName("icon");
    app.save(workspaces);
  },
);
