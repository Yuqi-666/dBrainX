# pb/AGENTS.md

Scope: the `pb/` directory.
Parent map: [../AGENTS.md](../AGENTS.md).

This directory holds the PocketBase server for development and for the container image.
PocketBase stores records, files, and user identity.
It is the only data store in the project.

## Map

| Path | Content | Tracked in Git |
| --- | --- | --- |
| `pb_hooks/` | JavaScript hooks for edge and file requests | Yes |
| `pb_migrations_base/` | Complete schema for a new database | Yes |
| `pb_migrations_changes/` | Immutable incremental migrations for existing databases | Yes |
| `pb_data/pb_migrations/` | Default local run directory prepared before PocketBase starts | No |
| `pb_data/` | The local database, attachments, and generated types | No |

`pb_data/` holds live local state.
It also holds `.superuser-credentials.txt`.
Never commit, print, or copy that file.

## Mechanisms

`pb_hooks/edges.pb.js` calls `pb_hooks/lib/edge.js`.
It rejects an edge when the endpoints or the semantic link belong to another workspace.

`pb_hooks/files.pb.js` calls `pb_hooks/lib/storage-limits.js` for every create request.
The module sets the file owner from the authenticated user, enforces the per-category file ceiling and the per-user storage quota, and stamps the `size`, `mimeType`, and default `displayName` that the resource library reads.
The same module enforces an update that replaces the stored blob in place: the owner may send a new `file` with the same record id, and the hook recomputes `size` and `mimeType`, applies the same category ceiling, and charges only the difference against the quota.
The update rule therefore lets `file` change and still pins `ownerId`, `workspaceId`, `size`, `mimeType`, and `derivedFrom`.
The same file authorizes a download for the file owner, the workspace owner, or a workspace member.
It also accepts a `pb_token` cookie, because media elements cannot send an authorization header.
After a resource is deleted it calls `pb_hooks/lib/node-references.js`, which clears the deleted file address (and the measurements that belong to it) from the nodes that reference it; each node type keeps its own shape, and one failing node does not abort the rest.
A web page node is one of those types: it holds a stored document address, so the delete clears the address and the recorded byte length.
Then it calls `pb_hooks/lib/media-derived.js`, which removes the artifacts derived from that resource (a PDF cover, an HLS playlist, its segments, a poster). Those rows carry `derivedFrom` and are hidden from the resource library.

`0000000001_base_schema.js` is the genesis migration. Future changes use higher numbers and are immutable after release; `0000000003_media_library.js` adds the media metadata fields, the owner update rule, and the size backfill, `0000000004_media_analysis.js` adds the analysis cache on a resource (`pageCount`, dimensions, `coverUrl`, `hlsUrl`), the `derivedFrom` provenance, and the backfill from the media nodes that already carry those values, `0000000005_media_replace.js` drops the `file` pin from the owner update rule so a stored blob can be replaced in place, and `0000000006_node_content_size.js` raises the `nodes.content` JSON ceiling from the PocketBase default of 1 MiB to 24 MiB.
That ceiling is a compatibility bound now: a web page node used to keep its whole source in `content`, so an old database may still hold one until `0000000007_webpage_object_storage.js` runs.
The 0007 migration moves each inline source into the `files` collection, decoding the JSON-column text first because `getString` on a JSON column returns the serialized JSON; it then writes the stored address and byte length back onto the node and leaves already-migrated records alone.
It is one-way: a downgrade keeps the blobs in the library, because restoring one inline could take a resource the user uploaded separately out of the library.
A web page node now stores an address like a PDF node, so a reader must use `content.url`, not source text.

`0000000011_dynamic_engine.js` makes `nodes.content` the only type payload.
It folds the 23 legacy type columns into `content`, stamps `typeVersion`, drops the columns, adds `createdBy` / `runId` to `edges`, and creates the execution tables (`event_log` with both the aggregate `sequence` and the workspace `workspaceSequence`, `event_deliveries`, `operation_runs`) plus the plugin, automation, and scheduling tables.
The fold reads 200 records per page and aborts, naming the record and the columns, when a value would not survive; `typeVersion` is its resume marker, so a re-run continues with the unfolded records.
`pb_migrations_base` carries the same shape, so a new database is born with it and never runs this script.
The base copy in a run directory is made once, at genesis, and its sha256 is recorded in `.dbrainx-migration-origin`; editing the base therefore changes only databases created afterwards, and an installed one upgrades through this change script alone.
Databases created before this baseline are unsupported. The launcher refuses them instead of silently skipping schema work.
The `files.file` cap is 2 GiB, which must stay equal to `MAX_UPLOAD_BYTES` in `packages/utils/src/upload.ts`.

The development launcher `scripts/dev-pocketbase.mjs` prepares the run directory inside the selected data directory before creating the operator account.
It passes `--dir`, `--migrationsDir`, and `--hooksDir`, and it sets `--automigrate=0`.
The working directory of the shell therefore does not change the target database.

## Rules

1. Never edit an applied change migration. For each schema change, update the base script and add one new change script with a higher timestamp.
2. Test an upgrade against a copy of old data before you release the new migration.
3. Write a hook change in `pb_hooks/` and test it with `scripts/release/edge-hook.test.mjs`.
4. Keep the collection rules in the migration. Do not change rules by hand in the admin UI.
5. Remember that ESLint ignores `pb/`. A hook change needs a manual review.
