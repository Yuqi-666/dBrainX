// SPDX-License-Identifier: AGPL-3.0-only

// The dynamic-system schema: `nodes.content` becomes the only type payload, the
// type-private columns are folded into it, and the execution tables
// (`event_log` / `event_deliveries` / `operation_runs`) plus the plugin,
// automation, and scheduling tables are created. The node-type / operation
// registry itself is built from manifests at startup and is never stored as a
// table; `plugins` keeps only the install facts and the manifest snapshot.
//
// Existing databases reach this shape through this file alone: the base
// migration a database was created with is copied into its run directory once,
// at genesis, and that copy stays pinned (`.dbrainx-migration-origin` records
// its sha256). Editing `pb_migrations_base/0000000001_base_schema.js` therefore
// only changes what a *new* database is born with; it never reaches an installed
// one. The two files must still describe the same shape, so a fresh database and
// an upgraded one are field-for-field identical — `scripts/lib/pocketbase-migrations.test.mjs`
// builds both and compares them.
//
// The fold is the dangerous half. For every node record:
//   1. the 23 `LEGACY_NODE_COLUMNS` are read into a `content` object,
//   2. the object is written together with `typeVersion = 1`,
//   3. the write is read back and must carry a `content` object,
//   4. every non-empty legacy column must be carried by that object, or the
//      migration aborts with the record id and the columns that would be lost.
// Only after every record passed those checks are the columns dropped. A record
// that would lose data therefore fails the migration loudly instead of silently
// dropping a value.
//
// `typeVersion` is also the resume marker of the fold: each batch queries
// `typeVersion < 1`, so a large table is folded 200 records at a time and a run
// that was interrupted (or a re-run of this script) continues with the records
// that are still unfolded instead of walking the whole table again.
//
// PocketBase wraps a migration's up/down in a transaction (measured with the
// pinned binary: a script that creates a collection, inserts records, and then
// throws leaves none of it behind and no `_migrations` row). The duplicate check
// below still runs before the destructive steps so the failure names the
// conflicting records instead of surfacing an index error.
//
// New databases get this shape from `pb_migrations_base/0000000001_base_schema.js`
// and skip this file; the guard below also returns early if everything it
// creates already exists.
/// <reference path="../pb_data/types.d.ts" />

const NODE_CONTENT_MAX_BYTES = 24 * 1024 * 1024;

// The fold reads 200 records per page. `findRecordsByFilter` keeps the result
// set bounded, so a database with a large `nodes` table never loads it whole.
const NODE_FOLD_PAGE_SIZE = 200;

// The one column list this migration folds and drops. Every entry ends up in
// `content` under the same key (see `contentFromLegacy`), so the list is also
// the contract the data-loss guard checks against.
const LEGACY_NODE_COLUMNS = [
  "width",
  "height",
  "fileSize",
  "location",
  "shootingTime",
  "coverUrl",
  "pageCount",
  "duration",
  "hlsUrl",
  "source",
  "sourceUrl",
  "url",
  "screenshotUrl",
  "codeLanguage",
  "faviconUrl",
  "filterConfig",
  "referencedNodes",
  "docs",
  "fields",
  "rows",
  "views",
  "annotations",
  "timestamps",
];

// The tables this migration creates. `down` deletes them in reverse order and
// `up` skips the ones that already exist (a fresh database is born with them).
const ENGINE_TABLES = [
  "event_log",
  "event_deliveries",
  "operation_runs",
  "plugins",
  "plugin_grants",
  "plugin_secrets",
  "automations",
  "automation_scope",
  "scheduled_jobs",
];

// The rollback restores the pre-0011 `nodes` shape. `url` and `sourceUrl` come
// back as text, not as the URL field the old base declared: an imported media
// node stores an address such as `/api/files/files/<id>/<name>`, and the URL
// field would reject it when the record is saved again.
const LEGACY_NODE_FIELD_SPECS = [
  { name: "width", type: "number" },
  { name: "height", type: "number" },
  { name: "fileSize", type: "number" },
  { name: "location", type: "text" },
  { name: "shootingTime", type: "text" },
  { name: "coverUrl", type: "text" },
  { name: "pageCount", type: "number" },
  { name: "duration", type: "number" },
  { name: "hlsUrl", type: "text" },
  { name: "source", type: "select", values: ["local", "online"] },
  { name: "sourceUrl", type: "text" },
  { name: "url", type: "text" },
  { name: "screenshotUrl", type: "text" },
  { name: "codeLanguage", type: "text" },
  { name: "faviconUrl", type: "text" },
  { name: "filterConfig", type: "json" },
  { name: "referencedNodes", type: "json" },
  { name: "docs", type: "json" },
  { name: "fields", type: "json" },
  { name: "rows", type: "json" },
  { name: "views", type: "json" },
  { name: "annotations", type: "json" },
  { name: "timestamps", type: "json" },
];

// The design document also lists `idx_nodes_ws_updated ON nodes (workspaceId, updated)`.
// This PocketBase build gives a base collection only `id`: `created` / `updated`
// are not implicit columns (measured with `pragma table_info('nodes')` on a
// database built from this base, and on the local development database), so that
// index has no column to cover and is not created.
const NODE_TYPE_INDEXES = [
  "CREATE INDEX idx_nodes_ws_type ON nodes (workspaceId, nodeType)",
  "CREATE INDEX idx_nodes_ws_pinned ON nodes (workspaceId, isPinned)",
  "CREATE UNIQUE INDEX idx_nodes_semantic ON nodes (workspaceId, semanticId) WHERE semanticId <> ''",
];

const EDGE_INDEXES = [
  "CREATE INDEX idx_edges_ws_from ON edges (workspaceId, from)",
  "CREATE INDEX idx_edges_ws_to ON edges (workspaceId, to)",
];

const MEDIA_NODE_TYPES = [
  "image",
  "pdf",
  "video",
  "audio",
  "webpage",
  "website",
];

/** Collection names present in the database, so a probe never throws. */
function collectionNames(app) {
  const names = {};
  for (const collection of app.findAllCollections()) names[collection.name] = true;
  return names;
}

function hasCollection(app, name) {
  return collectionNames(app)[name] === true;
}

/** True when `collection` already carries a field with this name. */
function hasField(collection, name) {
  return !!collection.fields.getByName(name);
}

/** `record.getString` on a JSON column returns the serialized JSON text. */
function legacyJson(record, name) {
  const raw = record.getString(name);
  if (raw === "" || raw === "null") return undefined;
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `0011: node ${record.id} has a corrupt JSON value in "${name}": ${String(error)}`,
    );
  }
  return value === null ? undefined : value;
}

function legacyText(record, name) {
  const value = record.getString(name);
  return value === "" ? undefined : value;
}

function legacyNumber(record, name) {
  const value = record.get(name);
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return isFinite(number) ? number : undefined;
}

/** The field type name; the binding exposes `type` as a method. */
function fieldType(field) {
  return typeof field.type === "function" ? field.type() : field.type;
}

/** Reads a legacy column using the type the column actually has. */
function readLegacyColumn(record, name, kind) {
  if (kind === "number") return legacyNumber(record, name);
  if (kind === "json") return legacyJson(record, name);
  return legacyText(record, name);
}

/** The kind of every legacy column, read from the collection before the drop. */
function legacyColumnKinds(collection) {
  const kinds = {};
  for (const name of LEGACY_NODE_COLUMNS) {
    const field = collection.fields.getByName(name);
    if (!field) continue;
    kinds[name] = fieldType(field);
  }
  return kinds;
}

function compact(object) {
  for (const key of Object.keys(object)) {
    if (object[key] === undefined) delete object[key];
  }
  return object;
}

/** A single comparable JSON string: object keys sorted, `undefined` becomes `null`. */
function canonical(value) {
  if (value === undefined) return "null";
  if (Array.isArray(value)) {
    return "[" + value.map(canonical).join(",") + "]";
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const key of keys) parts.push(JSON.stringify(key) + ":" + canonical(value[key]));
    return "{" + parts.join(",") + "}";
  }
  return JSON.stringify(value);
}

function sameJson(left, right) {
  return canonical(left) === canonical(right);
}

/**
 * The collection node keeps its filter in the record as a picker payload, while
 * the content keeps the selected node ids. The shapes differ on purpose, so the
 * data-loss guard compares the normalized forms.
 */
function normalizeFilterConfig(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const selectedNodes = Array.isArray(raw.selectedNodes)
    ? raw.selectedNodes
        .map((entry) => {
          if (typeof entry === "string") return entry;
          if (entry && typeof entry === "object") {
            return typeof entry.value === "string" ? entry.value : entry._value;
          }
          return undefined;
        })
        .filter((id) => typeof id === "string" && id.length > 0)
    : undefined;
  return compact(Object.assign({}, raw, { selectedNodes: selectedNodes }));
}

/** True when `content` already holds the folded payload of this node type. */
function isFolded(type, content) {
  if (content === null || typeof content !== "object" || Array.isArray(content)) {
    return false;
  }
  if (MEDIA_NODE_TYPES.indexOf(type) >= 0) return true;
  if (type === "text") {
    const keys = Object.keys(content);
    return keys.length === 1 && keys[0] === "docs";
  }
  if (type === "rich-text") return "docs" in content || "referencedNodes" in content;
  if (type === "database") return "fields" in content || "rows" in content;
  if (type === "collection") return "filterConfig" in content || "views" in content;
  return false;
}

/** Builds the `content` payload of one record from its legacy columns. */
function contentFromLegacy(record, current) {
  const type = record.getString("nodeType");

  if (isFolded(type, current)) return current;

  const text = typeof current === "string" ? current : "";
  const object =
    current !== null && typeof current === "object" && !Array.isArray(current)
      ? current
      : undefined;
  const legacyUrl = text || legacyText(record, "url") || "";

  switch (type) {
    case "text":
      // An unfolded text record keeps its block map in `content` itself.
      return { docs: object || {} };
    case "rich-text":
      return {
        docs: legacyJson(record, "docs") || {},
        referencedNodes: legacyJson(record, "referencedNodes") || [],
      };
    case "database":
      return {
        fields: legacyJson(record, "fields") || [],
        rows: legacyJson(record, "rows") || [],
        views: legacyJson(record, "views") || [],
      };
    case "collection":
      return compact({
        filterConfig: normalizeFilterConfig(legacyJson(record, "filterConfig")),
        views: legacyJson(record, "views") || [],
      });
    case "image":
      return compact({
        url: legacyUrl,
        width: legacyNumber(record, "width") || 0,
        height: legacyNumber(record, "height") || 0,
        fileSize: legacyNumber(record, "fileSize") || 0,
        location: legacyText(record, "location"),
        shootingTime: legacyText(record, "shootingTime"),
        annotations: legacyJson(record, "annotations"),
      });
    case "pdf":
      return compact({
        url: legacyUrl,
        coverUrl: legacyText(record, "coverUrl") || "",
        pageCount: legacyNumber(record, "pageCount") || 0,
        fileSize: legacyNumber(record, "fileSize") || 0,
        annotations: legacyJson(record, "annotations"),
      });
    case "video":
      return compact({
        url: legacyUrl,
        coverUrl: legacyText(record, "coverUrl") || "",
        hlsUrl: legacyText(record, "hlsUrl") || "",
        duration: legacyNumber(record, "duration") || 0,
        source: legacyText(record, "source") || "online",
        sourceUrl: legacyText(record, "sourceUrl"),
        fileSize: legacyNumber(record, "fileSize") || 0,
        location: legacyText(record, "location"),
        shootingTime: legacyText(record, "shootingTime"),
        timestamps: legacyJson(record, "timestamps"),
      });
    case "audio":
      return compact({
        url: legacyUrl,
        coverUrl: legacyText(record, "coverUrl"),
        duration: legacyNumber(record, "duration") || 0,
        source: legacyText(record, "source") || "local",
        sourceUrl: legacyText(record, "sourceUrl"),
        fileSize: legacyNumber(record, "fileSize") || 0,
        timestamps: legacyJson(record, "timestamps"),
      });
    case "webpage":
      return {
        url: legacyUrl,
        fileSize: legacyNumber(record, "fileSize") || 0,
      };
    case "website":
      return compact({
        url: legacyUrl,
        faviconUrl: legacyText(record, "faviconUrl"),
      });
    default:
      throw new Error(
        `0011: node ${record.id} has an unknown nodeType "${type}"; the content fold cannot place its columns`,
      );
  }
}

/**
 * Aborts when a legacy column holds a value the new `content` does not carry.
 * This is the guard that turns a silent data loss into a failed migration.
 */
function assertNothingLost(record, content, kinds) {
  const lost = [];
  for (const name of LEGACY_NODE_COLUMNS) {
    const kind = kinds[name];
    if (!kind) continue;
    const legacy = readLegacyColumn(record, name, kind);
    // 0 and "" are the "no value" defaults of the legacy columns.
    if (legacy === undefined || legacy === "" || legacy === 0) continue;
    if (name === "filterConfig") {
      const normalized = normalizeFilterConfig(legacy);
      if (sameJson(normalized === undefined ? null : normalized, content.filterConfig)) continue;
      lost.push(name);
      continue;
    }
    if (sameJson(legacy, content[name])) continue;
    lost.push(name);
  }
  if (lost.length > 0) {
    const details = [];
    for (const name of lost) {
      details.push(`${name}=${JSON.stringify(readLegacyColumn(record, name, kinds[name]))}`);
    }
    throw new Error(
      `0011: node ${record.id} (${record.getString("nodeType")}) would lose data: ` +
        `the new content does not carry ${details.join(", ")}. ` +
        `Reconcile the record, then run the migration again.`,
    );
  }
}

/**
 * Folds every node whose `typeVersion` is below 1, one page of
 * `NODE_FOLD_PAGE_SIZE` records at a time. Each saved record leaves the query,
 * so the next page is always the next unfolded batch and an interrupted run
 * resumes instead of restarting.
 */
function foldNodes(app, kinds) {
  let folded = 0;
  let page = 0;
  for (;;) {
    const batch = app.findRecordsByFilter(
      "nodes",
      "typeVersion < 1",
      "id",
      NODE_FOLD_PAGE_SIZE,
      0,
    );
    if (batch.length === 0) break;
    for (const record of batch) {
      const current = legacyJson(record, "content");
      const content = contentFromLegacy(record, current);
      assertNothingLost(record, content, kinds);
      record.set("content", content);
      record.set("typeVersion", 1);
      const written = legacyJson(record, "content");
      if (written === null || typeof written !== "object" || Array.isArray(written)) {
        throw new Error(
          `0011: node ${record.id} did not carry a content object after the fold`,
        );
      }
      app.save(record);
      folded += 1;
    }
    page += 1;
    console.log(
      `[0011] folded ${folded} node record(s) (page ${page}, batch ${batch.length})`,
    );
  }
  return folded;
}

/** Throws with the conflicting record ids when a unique index cannot be built. */
function assertSemanticIdsUnique(app) {
  const rows = arrayOf(
    new DynamicModel({
      workspaceId: nullString(),
      semanticId: nullString(),
      ids: nullString(),
      total: 0,
    }),
  );
  app
    .db()
    .newQuery(
      "SELECT workspaceId, semanticId, GROUP_CONCAT(id) AS ids, COUNT(*) AS total " +
        "FROM nodes WHERE semanticId IS NOT NULL AND semanticId <> '' " +
        "GROUP BY workspaceId, semanticId HAVING COUNT(*) > 1",
    )
    .all(rows);
  if (rows.length === 0) return;
  const conflicts = [];
  for (const row of rows) {
    const ids = String(row.ids || "")
      .split(",")
      .filter((id) => id !== "")
      .sort();
    conflicts.push(
      `workspace "${row.workspaceId}" semanticId "${row.semanticId}": ${ids.join(", ")}`,
    );
  }
  throw new Error(
    "0011: duplicate (workspaceId, semanticId) pairs block the unique index " +
      "idx_nodes_semantic. Give each listed record a distinct semanticId, then run " +
      "the migration again:\n  " +
      conflicts.join("\n  "),
  );
}

/** The tables this migration owns, in creation order. */
function createEngineTables(app) {
  const existing = collectionNames(app);
  const base = {
    type: "base",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  };
  const definitions = [
    {
      name: "event_log",
      fields: [
        { name: "eventId", type: "text", required: true, max: 100 },
        { name: "eventType", type: "text", required: true, max: 200 },
        { name: "aggregateType", type: "text", required: true, max: 32 },
        { name: "aggregateId", type: "text", max: 100 },
        { name: "workspaceId", type: "text", required: true, max: 100 },
        { name: "sequence", type: "number", required: true, min: 0 },
        { name: "workspaceSequence", type: "number", required: true, min: 0 },
        { name: "payload", type: "json" },
        { name: "metadata", type: "json" },
        { name: "created", type: "autodate", onCreate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_event_log_event_id ON event_log (eventId)",
        "CREATE UNIQUE INDEX idx_event_log_aggregate ON event_log (aggregateType, aggregateId, sequence)",
        "CREATE UNIQUE INDEX idx_event_log_workspace_sequence ON event_log (workspaceId, workspaceSequence)",
        "CREATE INDEX idx_event_log_workspace ON event_log (workspaceId, created)",
      ],
    },
    {
      name: "event_deliveries",
      fields: [
        { name: "eventId", type: "text", required: true, max: 100 },
        { name: "triggerId", type: "text", required: true, max: 200 },
        { name: "targetKey", type: "text", required: true, max: 200 },
        { name: "pluginId", type: "text", required: true, max: 100 },
        { name: "workspaceId", type: "text", required: true, max: 100 },
        {
          name: "status",
          type: "select",
          required: true,
          values: ["pending", "processing", "done", "failed", "dead"],
        },
        { name: "attempts", type: "number", min: 0 },
        { name: "availableAt", type: "date" },
        { name: "leaseOwner", type: "text", max: 100 },
        { name: "leaseUntil", type: "date" },
        { name: "lastError", type: "text", max: 4000 },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_delivery_event_trigger ON event_deliveries (eventId, triggerId, targetKey)",
        "CREATE INDEX idx_delivery_pending ON event_deliveries (status, availableAt)",
      ],
    },
    {
      name: "operation_runs",
      fields: [
        { name: "deliveryId", type: "text", max: 100 },
        { name: "eventId", type: "text", max: 100 },
        { name: "triggerId", type: "text", max: 200 },
        { name: "pluginId", type: "text", required: true, max: 100 },
        { name: "pluginVersion", type: "text", max: 40 },
        { name: "correlationId", type: "text", max: 100 },
        {
          name: "actorKind",
          type: "select",
          required: true,
          values: ["user", "plugin", "scheduler", "system"],
        },
        { name: "actorId", type: "text", max: 200 },
        { name: "operationId", type: "text", required: true, max: 200 },
        {
          name: "targetType",
          type: "select",
          required: true,
          values: ["workspace", "node", "edge", "view"],
        },
        { name: "targetId", type: "text", required: true, max: 200 },
        { name: "nodeId", type: "text", max: 100 },
        { name: "workspaceId", type: "text", required: true, max: 100 },
        { name: "idempotencyKey", type: "text", required: true, max: 300 },
        {
          name: "status",
          type: "select",
          required: true,
          values: ["running", "succeeded", "failed", "dead"],
        },
        { name: "decision", type: "select", values: ["allowed", "denied"] },
        { name: "capability", type: "text", max: 60 },
        { name: "attempt", type: "number", min: 1 },
        { name: "input", type: "json" },
        { name: "output", type: "json" },
        { name: "error", type: "text", max: 4000 },
        { name: "startedAt", type: "date" },
        { name: "finishedAt", type: "date" },
        { name: "durationMs", type: "number", min: 0 },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_runs_idempotency ON operation_runs (idempotencyKey)",
        "CREATE INDEX idx_runs_delivery ON operation_runs (deliveryId)",
        "CREATE INDEX idx_runs_workspace ON operation_runs (workspaceId, startedAt)",
        "CREATE INDEX idx_runs_node ON operation_runs (nodeId, startedAt)",
        "CREATE INDEX idx_runs_target ON operation_runs (targetType, targetId, startedAt)",
        "CREATE INDEX idx_runs_actor ON operation_runs (actorKind, actorId, startedAt)",
      ],
    },
    {
      name: "plugins",
      fields: [
        { name: "pluginId", type: "text", required: true, max: 100 },
        { name: "version", type: "text", required: true, max: 40 },
        { name: "manifest", type: "json", required: true },
        { name: "checksum", type: "text", max: 200 },
        { name: "publisher", type: "text", max: 100 },
        { name: "signature", type: "text", max: 4000 },
        { name: "publicKeyId", type: "text", max: 100 },
        {
          name: "status",
          type: "select",
          required: true,
          values: ["installed", "enabled", "disabled", "upgrading", "failed"],
        },
        { name: "installedBy", type: "text", max: 100 },
        { name: "installedAt", type: "date" },
        { name: "enabledAt", type: "date" },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_plugins_id ON plugins (pluginId)"],
    },
    {
      name: "plugin_grants",
      fields: [
        { name: "pluginId", type: "text", required: true, max: 100 },
        { name: "workspaceId", type: "text", required: true, max: 100 },
        { name: "capability", type: "text", required: true, max: 60 },
        { name: "scope", type: "json" },
        { name: "scopeKey", type: "text", required: true, max: 300 },
        { name: "grantedBy", type: "text", required: true, max: 100 },
        { name: "grantedAt", type: "date" },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_grant_unique ON plugin_grants (pluginId, workspaceId, capability, scopeKey)",
      ],
    },
    {
      name: "plugin_secrets",
      fields: [
        { name: "pluginId", type: "text", required: true, max: 100 },
        { name: "workspaceId", type: "text", required: true, max: 100 },
        { name: "name", type: "text", required: true, max: 100 },
        { name: "ciphertext", type: "text", required: true, max: 20000 },
        { name: "iv", type: "text", required: true, max: 64 },
        { name: "tag", type: "text", required: true, max: 64 },
        { name: "keyVersion", type: "number", min: 1 },
        { name: "createdBy", type: "text", max: 100 },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_secret_unique ON plugin_secrets (pluginId, workspaceId, name)",
      ],
    },
    {
      name: "automations",
      fields: [
        { name: "name", type: "text", required: true, max: 200 },
        { name: "workspaceId", type: "text", required: true, max: 100 },
        { name: "entryNodeIds", type: "json" },
        { name: "triggerIds", type: "json" },
        { name: "maxDepth", type: "number", min: 1 },
        { name: "enabled", type: "bool" },
      ],
      indexes: [
        "CREATE INDEX idx_automations_workspace ON automations (workspaceId)",
      ],
      rules: { listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "" },
    },
    {
      name: "automation_scope",
      fields: [
        { name: "automationId", type: "text", required: true, max: 100 },
        { name: "nodeId", type: "text", required: true, max: 100 },
        { name: "workspaceId", type: "text", required: true, max: 100 },
        { name: "recomputedAt", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_scope_unique ON automation_scope (automationId, nodeId)",
        "CREATE INDEX idx_scope_lookup ON automation_scope (workspaceId, nodeId)",
      ],
    },
    {
      name: "scheduled_jobs",
      fields: [
        { name: "pluginId", type: "text", required: true, max: 100 },
        { name: "workspaceId", type: "text", required: true, max: 100 },
        { name: "automationId", type: "text", max: 100 },
        { name: "nodeId", type: "text", max: 100 },
        { name: "operationId", type: "text", required: true, max: 200 },
        { name: "intervalMs", type: "number", min: 1000 },
        { name: "nextRunAt", type: "date" },
        { name: "scheduledFor", type: "date" },
        { name: "enabled", type: "bool" },
        { name: "leaseOwner", type: "text", max: 100 },
        { name: "leaseUntil", type: "date" },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_jobs_unique ON scheduled_jobs (pluginId, operationId, nodeId, workspaceId)",
        "CREATE INDEX idx_jobs_next ON scheduled_jobs (enabled, nextRunAt)",
        "CREATE INDEX idx_jobs_lease ON scheduled_jobs (enabled, leaseUntil)",
      ],
    },
  ];

  for (const definition of definitions) {
    if (existing[definition.name]) continue;
    const collection = new Collection(
      Object.assign({}, base, definition.rules || {}, {
        name: definition.name,
        fields: definition.fields,
        indexes: definition.indexes,
      }),
    );
    app.save(collection);
    existing[definition.name] = true;
    console.log(`[0011] created ${definition.name}`);
  }
}

/** Restores the 23 legacy columns (idempotent: a present field is left alone). */
function restoreLegacyNodeFields(app) {
  const nodes = app.findCollectionByNameOrId("nodes");
  let added = 0;
  for (const spec of LEGACY_NODE_FIELD_SPECS) {
    if (hasField(nodes, spec.name)) continue;
    if (spec.type === "number") nodes.fields.add(new NumberField({ name: spec.name }));
    else if (spec.type === "json") nodes.fields.add(new JSONField({ name: spec.name }));
    else if (spec.type === "select")
      nodes.fields.add(new SelectField({ name: spec.name, values: spec.values }));
    else nodes.fields.add(new TextField({ name: spec.name }));
    added += 1;
  }
  nodes.indexes = [];
  app.save(nodes);
  return added;
}

/** Expands `content` back into the legacy columns of one record. */
function expandContent(record) {
  const raw = record.getString("content");
  if (raw === "") return false;
  let content;
  try {
    content = JSON.parse(raw);
  } catch (error) {
    return false;
  }
  if (content === null || typeof content !== "object" || Array.isArray(content)) return false;

  const type = record.getString("nodeType");
  if (type === "text") {
    record.set("content", content.docs || {});
    return true;
  }
  if (type === "rich-text") {
    record.set("docs", content.docs === undefined ? {} : content.docs);
    record.set("referencedNodes", content.referencedNodes === undefined ? [] : content.referencedNodes);
    record.set("content", {});
    return true;
  }
  if (type === "database") {
    record.set("fields", content.fields === undefined ? [] : content.fields);
    record.set("rows", content.rows === undefined ? [] : content.rows);
    record.set("views", content.views === undefined ? [] : content.views);
    record.set("content", {});
    return true;
  }
  if (type === "collection") {
    record.set("filterConfig", content.filterConfig === undefined ? null : content.filterConfig);
    record.set("views", content.views === undefined ? [] : content.views);
    record.set("content", {});
    return true;
  }
  if (MEDIA_NODE_TYPES.indexOf(type) < 0) return false;

  record.set("content", typeof content.url === "string" ? content.url : "");
  record.set("width", content.width === undefined ? 0 : content.width);
  record.set("height", content.height === undefined ? 0 : content.height);
  record.set("fileSize", content.fileSize === undefined ? 0 : content.fileSize);
  record.set("location", content.location === undefined ? "" : content.location);
  record.set("shootingTime", content.shootingTime === undefined ? "" : content.shootingTime);
  record.set("coverUrl", content.coverUrl === undefined ? "" : content.coverUrl);
  record.set("pageCount", content.pageCount === undefined ? 0 : content.pageCount);
  record.set("duration", content.duration === undefined ? 0 : content.duration);
  record.set("hlsUrl", content.hlsUrl === undefined ? "" : content.hlsUrl);
  record.set("source", content.source === undefined ? "" : content.source);
  record.set("sourceUrl", content.sourceUrl === undefined ? "" : content.sourceUrl);
  record.set("faviconUrl", content.faviconUrl === undefined ? "" : content.faviconUrl);
  record.set("annotations", content.annotations === undefined ? null : content.annotations);
  record.set("timestamps", content.timestamps === undefined ? null : content.timestamps);
  return true;
}

migrate(
  (app) => {
    // A database born from the current base already has everything; nothing to do.
    const existing = collectionNames(app);
    if (
      hasCollection(app, "nodes") &&
      hasCollection(app, "edges") &&
      ENGINE_TABLES.every((name) => existing[name] === true)
    ) {
      const nodes = app.findCollectionByNameOrId("nodes");
      const edges = app.findCollectionByNameOrId("edges");
      if (
        hasField(nodes, "typeVersion") &&
        !LEGACY_NODE_COLUMNS.some((name) => hasField(nodes, name)) &&
        hasField(edges, "createdBy")
      ) {
        console.log("[0011] schema already current, nothing to migrate");
        return;
      }
    }

    // 1. nodes: the content-version column, the soft-delete column, and the
    //    ceiling that is the compatibility bound of an inline payload.
    let nodes = app.findCollectionByNameOrId("nodes");
    if (!hasField(nodes, "typeVersion")) {
      nodes.fields.add(new NumberField({ name: "typeVersion", min: 1 }));
    }
    if (!hasField(nodes, "deletedAt")) {
      nodes.fields.add(new DateField({ name: "deletedAt" }));
    }
    const contentField = nodes.fields.getByName("content");
    if (contentField) contentField.maxSize = NODE_CONTENT_MAX_BYTES;
    app.save(nodes);

    // 2. Fail before touching data when the unique index cannot be built.
    assertSemanticIdsUnique(app);

    // 3. Fold the type-private columns into `content`, then prove the fold is
    //    complete before the columns disappear.
    nodes = app.findCollectionByNameOrId("nodes");
    const kinds = legacyColumnKinds(nodes);
    const folded = Object.keys(kinds).length === 0 ? 0 : foldNodes(app, kinds);
    const unfolded = app.findRecordsByFilter("nodes", "typeVersion < 1", "", 1, 0);
    if (unfolded.length > 0) {
      throw new Error(
        `0011: ${unfolded.length} node record(s) still have no content after the fold; refusing to drop ${LEGACY_NODE_COLUMNS.length} columns`,
      );
    }
    console.log(`[0011] ${folded} node record(s) folded`);

    // 4. Drop the type-private columns and index the columns a cross-type query
    //    filters and sorts on.
    for (const name of LEGACY_NODE_COLUMNS) {
      if (hasField(nodes, name)) nodes.fields.removeByName(name);
    }
    nodes.indexes = NODE_TYPE_INDEXES;
    app.save(nodes);

    // 5. edges: provenance of the edge and the two graph-query indexes.
    const edges = app.findCollectionByNameOrId("edges");
    if (!hasField(edges, "createdBy")) {
      edges.fields.add(new TextField({ name: "createdBy", max: 100 }));
    }
    if (!hasField(edges, "runId")) {
      edges.fields.add(new TextField({ name: "runId", max: 100 }));
    }
    edges.indexes = EDGE_INDEXES;
    app.save(edges);

    // 6. The append-only event log, its deliveries, the execution records, and
    //    the plugin / automation / scheduling tables.
    createEngineTables(app);
  },
  (app) => {
    // Rollback tolerates a partial up: every collection and column is probed
    // before it is removed, so a run that stopped after step 1 still rolls back.

    // 1. New tables, reverse creation order.
    const existing = collectionNames(app);
    for (let index = ENGINE_TABLES.length - 1; index >= 0; index -= 1) {
      const name = ENGINE_TABLES[index];
      if (existing[name]) app.delete(app.findCollectionByNameOrId(name));
    }

    // 2. edges: drop the provenance columns and the graph-query indexes.
    if (hasCollection(app, "edges")) {
      const edges = app.findCollectionByNameOrId("edges");
      for (const name of ["createdBy", "runId"]) {
        if (hasField(edges, name)) edges.fields.removeByName(name);
      }
      edges.indexes = [];
      app.save(edges);
    }

    if (!hasCollection(app, "nodes")) return;

    // 3. Restore the legacy columns first: the expansion below writes into them.
    restoreLegacyNodeFields(app);

    // 4. Expand `content` back into the columns, page by page.
    let offset = 0;
    let expanded = 0;
    for (;;) {
      const batch = app.findRecordsByFilter(
        "nodes",
        "",
        "id",
        NODE_FOLD_PAGE_SIZE,
        offset,
      );
      if (batch.length === 0) break;
      for (const record of batch) {
        if (expandContent(record)) {
          app.save(record);
          expanded += 1;
        }
      }
      offset += batch.length;
      console.log(`[0011] expanded ${expanded} node record(s) (offset ${offset})`);
    }

    // 5. Drop the columns this migration added.
    let nodes = app.findCollectionByNameOrId("nodes");
    for (const name of ["typeVersion", "deletedAt"]) {
      if (hasField(nodes, name)) nodes.fields.removeByName(name);
    }
    nodes.indexes = [];
    app.save(nodes);
  },
);
