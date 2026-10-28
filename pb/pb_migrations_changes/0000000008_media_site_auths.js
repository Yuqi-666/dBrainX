// SPDX-License-Identifier: AGPL-3.0-only

// Saved logins of the media import (video and audio), one record per owner and
// site. The cookie is a credential and never reaches the database in plaintext:
// `cookieCiphertext`, `nonce` and `tag` hold its AES-256-GCM encryption, written
// by `PocketBaseMediaSiteAuthRepository`. A `browser` login stores only the
// browser name, because yt-dlp reads that browser's cookie itself; its three
// cookie columns stay empty.
//
// Every rule is owner-scoped: a login of somebody else is invisible, exactly
// like a missing one. The unique index backs the "one login per owner and site"
// contract at the database level even though the repository looks the record up
// before writing.
//
// New databases get the collection from
// `pb_migrations_base/0000000001_base_schema.js` and skip this file.
/// <reference path="../pb_data/types.d.ts" />

const OWNER_RULE = '@request.auth.id != "" && ownerId = @request.auth.id';

migrate(
  (app) => {
    app.save(
      new Collection({
        name: "media_site_auths",
        type: "base",
        listRule: OWNER_RULE,
        viewRule: OWNER_RULE,
        createRule: OWNER_RULE,
        updateRule: OWNER_RULE,
        deleteRule: OWNER_RULE,
        fields: [
          { name: "ownerId", type: "text", required: true, max: 100 },
          { name: "siteKey", type: "text", required: true, max: 100 },
          // Reserved for the domains a login was stored for. The domain model
          // derives them from the site catalog, so this column is written empty
          // today; it stays in the schema so an implementation may cache them
          // without a migration.
          { name: "hosts", type: "text", max: 2000 },
          // A Netscape `cookies.txt` is capped at 1 MiB by the import endpoint;
          // hex encoding doubles it, so 4 MiB leaves room for a full export.
          { name: "cookieCiphertext", type: "text", max: 4194304 },
          { name: "nonce", type: "text", max: 64 },
          { name: "tag", type: "text", max: 64 },
          { name: "accountLabel", type: "text", max: 300 },
          { name: "authMethod", type: "text", max: 32 },
          { name: "browserName", type: "text", max: 64 },
          { name: "status", type: "text", max: 32 },
          { name: "lastCheckedAt", type: "text", max: 64 },
          { name: "lastUsedAt", type: "text", max: 64 },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_media_site_auths_owner_site ON media_site_auths (ownerId, siteKey)",
        ],
      }),
    );
  },
  (app) => {
    // The rollback drops the saved logins. The user can connect a site again;
    // keeping an encrypted credential in a collection no code reads would be
    // worse.
    app.delete(app.findCollectionByNameOrId("media_site_auths"));
  },
);
