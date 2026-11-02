// SPDX-License-Identifier: AGPL-3.0-only

// Measured on this suite's PocketBase binary (0.40.4, the pinned release): a
// migration's `up` runs inside ONE transaction. A script that creates a
// collection, inserts a node, and then throws leaves no collection, no node, and
// no `_migrations` row behind. `down` is wrapped the same way. The
// "a failed migration leaves nothing behind" test below measures this again on
// every run instead of trusting this comment.
//
// Chain of custody of the base migration, also measured here and in
// `pocketbase-migrations.mjs`: the base is copied into the run directory ONCE,
// at genesis, and `.dbrainx-migration-origin` records its sha256. Every later
// start hashes that installed copy — not the repository file — so editing
// `pb/pb_migrations_base/0000000001_base_schema.js` reaches only a database that
// is created afterwards. An installed database keeps its old base and reaches
// the new schema through `pb_migrations_changes/` alone, which is why the 0011
// cases below upgrade a database in the pre-0011 shape through the change
// script and then compare it, field by field, with a database born from the
// edited base.
import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareMigrations } from "./pocketbase-migrations.mjs";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

test("new databases run the genesis base and later changes; older databases are rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "dbrainx-migrations-"));
  const baseDir = join(root, "base"), changesDir = join(root, "changes");
  await mkdir(baseDir); await mkdir(changesDir);
  await writeFile(join(baseDir, "0000000001_base.js"), "base v1");
  const fresh = { dataDir: join(root, "fresh"), baseDir, changesDir, runDir: join(root, "fresh-run") };
  const old = { dataDir: join(root, "old"), baseDir, changesDir, runDir: join(root, "old-run") };
  try {
    await prepareMigrations(fresh);
    assert.deepEqual((await readdir(fresh.runDir)).filter((name) => name.endsWith(".js")), ["0000000001_base.js"]);
    await writeFile(join(baseDir, "0000000001_base.js"), "base v2");
    await writeFile(join(changesDir, "2200000000_next.js"), "next");
    await prepareMigrations(fresh);
    assert.equal(await readFile(join(fresh.runDir, "0000000001_base.js"), "utf8"), "base v1");
    assert.ok((await readdir(fresh.runDir)).includes("2200000000_next.js"));
    await mkdir(old.dataDir);
    await writeFile(join(old.dataDir, "data.db"), "existing database marker");
    await assert.rejects(prepareMigrations(old), /predates the migration baseline/);
    assert.deepEqual(await readdir(old.runDir), []);
    await writeFile(join(changesDir, "2200000000_next.js"), "rewritten history");
    await assert.rejects(prepareMigrations(fresh), /Installed migration changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("PocketBase creates the current schema from the genesis base", async () => {
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const root = await mkdtemp(join(tmpdir(), "dbrainx-pb-upgrade-"));
  const binary = join(repo, "pb", process.platform === "win32" ? "pocketbase.exe" : "pocketbase");
  const baseDir = join(repo, "pb/pb_migrations_base"), changesDir = join(repo, "pb/pb_migrations_changes");
  const migrate = (dataDir, runDir) => {
    const result = spawnSync(binary, ["migrate", "up", `--dir=${dataDir}`, `--migrationsDir=${runDir}`, "--automigrate=0"], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  try {
    const fresh = { dataDir: join(root, "fresh"), runDir: join(root, "fresh-run"), baseDir, changesDir };
    await prepareMigrations(fresh);
    migrate(fresh.dataDir, fresh.runDir);
    const freshDb = new DatabaseSync(join(fresh.dataDir, "data.db"), { readOnly: true });
    const applied = freshDb.prepare("select file from _migrations").all().map((row) => row.file);
    assert.ok(applied.includes("0000000001_base.js") || applied.includes("0000000001_base_schema.js"));
    const names = freshDb.prepare("select name from _collections").all().map((row) => row.name);
    assert.ok(names.includes("dashboard_configs"));
    assert.ok(names.includes("edge_semantics"));
    freshDb.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("later releases continue an existing database", async () => {
  const root = await mkdtemp(join(tmpdir(), "dbrainx-migrations-next-"));
  const baseDir = join(root, "base"), changesDir = join(root, "changes");
  await mkdir(baseDir); await mkdir(changesDir);
  await writeFile(join(baseDir, "0000000001_base.js"), "base v1");
  await writeFile(join(changesDir, "0000000002_first.js"), "change 2");
  const database = { dataDir: join(root, "data"), baseDir, changesDir, runDir: join(root, "run") };
  const installed = async () =>
    (await readdir(database.runDir)).filter((name) => name.endsWith(".js")).sort();
  try {
    await prepareMigrations(database);
    assert.deepEqual(await installed(), ["0000000001_base.js"]);
    // Each later release edits the base for a fresh database and adds one
    // higher-numbered change script for an existing database. The installed base
    // copy must stay as it was: PocketBase already applied it.
    for (const [base, change] of [["base v2", "0000000003_next.js"], ["base v3", "0000000004_later.js"]]) {
      await writeFile(join(baseDir, "0000000001_base.js"), base);
      await writeFile(join(changesDir, change), change);
      await prepareMigrations(database);
    }
    assert.deepEqual(await installed(), [
      "0000000001_base.js",
      "0000000003_next.js",
      "0000000004_later.js",
    ]);
    assert.equal(await readFile(join(database.runDir, "0000000001_base.js"), "utf8"), "base v1");
    const state = await readFile(join(database.runDir, ".dbrainx-migration-origin"), "utf8");
    assert.equal(state.trim().split(" ")[0], "base");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("PocketBase applies a later release's change script to an existing database", async () => {
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const root = await mkdtemp(join(tmpdir(), "dbrain-pb-next-"));
  const binary = join(repo, "pb", process.platform === "win32" ? "pocketbase.exe" : "pocketbase");
  const releasedBase = join(root, "released-base"), nextBase = join(root, "next-base");
  const releasedChanges = join(root, "released-changes"), nextChanges = join(root, "next-changes");
  for (const dir of [releasedBase, nextBase, releasedChanges, nextChanges]) await mkdir(dir);
  // The current genesis is "release N"; "release N+1" adds one column and one
  // change script, exactly as the repository rules require.
  const base = await readFile(join(repo, "pb/pb_migrations_base/0000000001_base_schema.js"), "utf8");
  // The seam between the up body and the rollback: a new release adds its
  // columns just before it.
  const marker = '  },\n  (app) => {\n    for (const name of [';
  assert.equal(base.split(marker).length, 2, "base schema keeps its rollback marker");
  const column = [
    "  {",
    '    const workspaces = app.findCollectionByNameOrId("workspaces");',
    '    workspaces.fields.add(new TextField({ name: "releaseMarker" }));',
    "    app.save(workspaces);",
    "  }",
  ].join("\n");
  await writeFile(join(releasedBase, "0000000001_base_schema.js"), base);
  await writeFile(join(nextBase, "0000000001_base_schema.js"), base.replace(marker, `${column}\n${marker}`));
  const changeScript = `migrate((app) => {
  const workspaces = app.findCollectionByNameOrId("workspaces");
  workspaces.fields.add(new TextField({ name: "releaseMarker" }));
  app.save(workspaces);
}, (app) => {
  const workspaces = app.findCollectionByNameOrId("workspaces");
  workspaces.fields.removeByName("releaseMarker");
  app.save(workspaces);
});
`;
  await writeFile(join(nextChanges, "0000000011_release_marker.js"), changeScript);
  const migrate = (dataDir, runDir) => {
    const result = spawnSync(binary, ["migrate", "up", `--dir=${dataDir}`, `--migrationsDir=${runDir}`, "--automigrate=0"], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  const workspaceFields = (dataDir) => {
    const db = new DatabaseSync(join(dataDir, "data.db"), { readOnly: true });
    try { return db.prepare("pragma table_info('workspaces')").all().map((row) => row.name); }
    finally { db.close(); }
  };
  try {
    // Release N creates a database.
    const database = { dataDir: join(root, "data"), runDir: join(root, "run"), baseDir: releasedBase, changesDir: releasedChanges };
    await prepareMigrations(database);
    migrate(database.dataDir, database.runDir);
    assert.ok(!workspaceFields(database.dataDir).includes("releaseMarker"));
    // Release N+1 continues it.
    await prepareMigrations({ ...database, baseDir: nextBase, changesDir: nextChanges });
    migrate(database.dataDir, database.runDir);
    assert.ok(workspaceFields(database.dataDir).includes("releaseMarker"));
    // A fresh install of release N+1 gets the column from its base and runs no
    // backward change script.
    const fresh = { dataDir: join(root, "fresh"), runDir: join(root, "fresh-run"), baseDir: nextBase, changesDir: nextChanges };
    await prepareMigrations(fresh);
    assert.deepEqual((await readdir(fresh.runDir)).filter((name) => name.endsWith(".js")), ["0000000001_base_schema.js"]);
    migrate(fresh.dataDir, fresh.runDir);
    assert.ok(workspaceFields(fresh.dataDir).includes("releaseMarker"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

const pbRoot = fileURLToPath(new URL("../../", import.meta.url));
const pbBinary = join(pbRoot, "pb", process.platform === "win32" ? "pocketbase.exe" : "pocketbase");
const pbBaseDir = join(pbRoot, "pb/pb_migrations_base");
const pbChangesDir = join(pbRoot, "pb/pb_migrations_changes");
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

/** Runs the pinned binary; never throws, so a test can assert on a failure. */
function pocketbase(dataDir, runDir, args, input) {
  return spawnSync(
    pbBinary,
    ["migrate", ...args, `--dir=${dataDir}`, `--migrationsDir=${runDir}`, "--automigrate=0"],
    { encoding: "utf8", timeout: 120_000, input },
  );
}

function outputOf(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function migrateOk(database, args, input) {
  const result = pocketbase(database.dataDir, database.runDir, args, input);
  assert.equal(result.status, 0, outputOf(result));
  return result;
}

/**
 * A run directory holding the current base and one change script, the way a
 * release that adds a change script continues an installed database. The state
 * file is written by hand because `prepareMigrations` sets the cutoff from the
 * change scripts it can see, which would skip the script under test.
 */
async function installRelease(root, changeScript = "0000000011_dynamic_engine.js") {
  const runDir = join(root, "run");
  await mkdir(runDir, { recursive: true });
  for (const name of await readdir(pbBaseDir)) {
    await copyFile(join(pbBaseDir, name), join(runDir, name));
  }
  const scripts =
    changeScript === null
      ? []
      : Array.isArray(changeScript)
        ? changeScript
        : [changeScript];
  for (const name of scripts) {
    await copyFile(join(pbChangesDir, name), join(runDir, name));
  }
  return { dataDir: join(root, "data"), runDir };
}

function withDatabase(dataDir, run) {
  const db = new DatabaseSync(join(dataDir, "data.db"), { readOnly: true });
  try {
    return run(db);
  } finally {
    db.close();
  }
}

function collectionNames(dataDir) {
  return withDatabase(dataDir, (db) =>
    db.prepare("select name from _collections").all().map((row) => row.name),
  );
}

function nodeFieldNames(dataDir) {
  return withDatabase(dataDir, (db) =>
    db.prepare("pragma table_info('nodes')").all().map((row) => row.name),
  );
}

/** Declared fields, indexes, and physical columns of the named collections. */
function schemaOf(dataDir, names) {
  return withDatabase(dataDir, (db) => {
    const schema = {};
    for (const name of names) {
      const row = db.prepare("select fields, indexes from _collections where name = ?").get(name);
      assert.ok(row, `${name} exists`);
      schema[name] = {
        // PocketBase derives the field id from the field itself and rewrites it
        // when a collection is rebuilt; it is not part of the contract. Nor is
        // the order: a migration that removes and re-adds a field leaves it at
        // the end of the list (0011 does that with `typeVersion` and `deletedAt`
        // on every down/up), so the comparison is by name.
        fields: JSON.parse(row.fields)
          .map(({ id, ...field }) => field)
          .sort((left, right) => left.name.localeCompare(right.name)),
        indexes: JSON.parse(row.indexes ?? "[]").slice().sort(),
        columns: db.prepare(`pragma table_info('${name}')`).all().map((column) => column.name).sort(),
      };
    }
    return schema;
  });
}

/** `{ semanticId: { nodeType, typeVersion, content } }`, content JSON-decoded. */
function nodesBySemanticId(dataDir) {
  return withDatabase(dataDir, (db) => {
    const nodes = {};
    for (const row of db.prepare("select semanticId, nodeType, typeVersion, content from nodes").all()) {
      nodes[row.semanticId] = {
        nodeType: row.nodeType,
        typeVersion: row.typeVersion,
        content: row.content === null ? null : JSON.parse(row.content),
      };
    }
    return nodes;
  });
}

/**
 * The ten builtin node types in the pre-0011 shape: the type-private facts live
 * in their own columns and `content` holds the media address (or the text block
 * map). Written the way `NodeMapper.toRecord` wrote them.
 */
const FIXTURE_NODES = `
  const make = (fields) => {
    const record = new Record(nodes);
    record.set("permission", "private");
    record.set("workspaceId", "ws1");
    record.set("title", fields.semanticId);
    for (const key of Object.keys(fields)) record.set(key, fields[key]);
    app.save(record);
    return record.id;
  };
  make({ nodeType: "text", semanticId: "n-text", content: { b1: { type: "doc" } } });
  make({ nodeType: "rich-text", semanticId: "n-rich", docs: { r1: 1 }, referencedNodes: ["x1"] });
  make({
    nodeType: "database",
    semanticId: "n-db",
    fields: [{ id: "f1", name: "A", type: "text" }],
    rows: [{ id: "r1", cells: {} }],
    views: [{ id: "v1" }],
  });
  make({
    nodeType: "collection",
    semanticId: "n-coll",
    filterConfig: { selectedNodes: [{ value: "a" }, "b"] },
    views: [{ id: "v2" }],
  });
  make({
    nodeType: "image",
    semanticId: "n-image",
    content: "https://cdn/x.png",
    width: 10,
    height: 20,
    fileSize: 30,
    location: "L",
    shootingTime: "2024",
    annotations: { layers: [] },
  });
  make({
    nodeType: "pdf",
    semanticId: "n-pdf",
    content: "https://cdn/x.pdf",
    coverUrl: "c",
    pageCount: 3,
    fileSize: 40,
    annotations: { layers: [] },
  });
  make({
    nodeType: "video",
    semanticId: "n-video",
    content: "https://cdn/x.mp4",
    coverUrl: "c",
    hlsUrl: "h",
    duration: 5,
    source: "online",
    sourceUrl: "https://src",
    fileSize: 50,
    location: "L",
    shootingTime: "2024",
    timestamps: [{ t: 1 }],
  });
  make({
    nodeType: "audio",
    semanticId: "n-audio",
    content: "https://cdn/x.mp3",
    coverUrl: "c",
    duration: 6,
    source: "local",
    fileSize: 60,
    timestamps: [{ t: 2 }],
  });
  make({ nodeType: "webpage", semanticId: "n-page", content: "/api/files/files/r1/a.html", fileSize: 70 });
  make({ nodeType: "website", semanticId: "n-site", content: "https://site", faviconUrl: "f" });
`;

const FIXTURE_SCRIPT = `migrate((app) => {
  const nodes = app.findCollectionByNameOrId("nodes");
${FIXTURE_NODES}
}, (app) => {});
`;

/** Brings a database born from the current base back to the pre-0011 shape. */
async function rewindToLegacyShape(database, steps = 1) {
  migrateOk(database, ["up"]);
  migrateOk(database, ["down", String(steps)], "y\n");
}

const EXPECTED_CONTENT = {
  "n-text": { docs: { b1: { type: "doc" } } },
  "n-rich": { docs: { r1: 1 }, referencedNodes: ["x1"] },
  "n-db": {
    fields: [{ id: "f1", name: "A", type: "text" }],
    rows: [{ id: "r1", cells: {} }],
    views: [{ id: "v1" }],
  },
  "n-coll": { filterConfig: { selectedNodes: ["a", "b"] }, views: [{ id: "v2" }] },
  "n-image": {
    url: "https://cdn/x.png",
    width: 10,
    height: 20,
    fileSize: 30,
    location: "L",
    shootingTime: "2024",
    annotations: { layers: [] },
  },
  "n-pdf": {
    url: "https://cdn/x.pdf",
    coverUrl: "c",
    pageCount: 3,
    fileSize: 40,
    annotations: { layers: [] },
  },
  "n-video": {
    url: "https://cdn/x.mp4",
    coverUrl: "c",
    hlsUrl: "h",
    duration: 5,
    source: "online",
    sourceUrl: "https://src",
    fileSize: 50,
    location: "L",
    shootingTime: "2024",
    timestamps: [{ t: 1 }],
  },
  "n-audio": {
    url: "https://cdn/x.mp3",
    coverUrl: "c",
    duration: 6,
    source: "local",
    fileSize: 60,
    timestamps: [{ t: 2 }],
  },
  "n-page": { url: "/api/files/files/r1/a.html", fileSize: 70 },
  "n-site": { url: "https://site", faviconUrl: "f" },
};

test("a migration's up runs inside one transaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "dbrainx-pb-tx-"));
  const database = await installRelease(root, null);
  try {
    migrateOk(database, ["up"]);
    await writeFile(
      join(database.runDir, "0000000002_failing_probe.js"),
      `migrate((app) => {
  app.save(new Collection({ name: "probe_tx", type: "base", fields: [{ name: "a", type: "text" }] }));
  const nodes = app.findCollectionByNameOrId("nodes");
  const record = new Record(nodes);
  record.set("permission", "private");
  record.set("nodeType", "text");
  app.save(record);
  throw new Error("deliberate failure for the transaction probe");
}, (app) => {});
`,
    );
    const failed = pocketbase(database.dataDir, database.runDir, ["up"]);
    assert.notEqual(failed.status, 0, "the failing migration must abort the run");
    assert.match(outputOf(failed), /deliberate failure for the transaction probe/);
    // Measured: nothing the failed up wrote survives, and the history row is
    // rolled back with it, so `up` runs inside a transaction.
    assert.ok(!collectionNames(database.dataDir).includes("probe_tx"), "the created collection is rolled back");
    assert.equal(withDatabase(database.dataDir, (db) => db.prepare("select count(*) c from nodes").get().c), 0);
    assert.ok(
      !withDatabase(database.dataDir, (db) => db.prepare("select file from _migrations").all().map((row) => row.file))
        .includes("0000000002_failing_probe.js"),
      "the failed migration is not recorded",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("0011 folds every node type into content and its down restores the legacy shape", async () => {
  const root = await mkdtemp(join(tmpdir(), "dbrainx-pb-0011-"));
  const database = await installRelease(root);
  try {
    await rewindToLegacyShape(database);
    const legacyColumns = nodeFieldNames(database.dataDir);
    for (const name of LEGACY_NODE_COLUMNS) {
      assert.ok(legacyColumns.includes(name), `the pre-0011 shape has ${name}`);
    }
    assert.ok(!legacyColumns.includes("typeVersion"));
    assert.ok(!collectionNames(database.dataDir).includes("event_log"));

    await writeFile(join(database.runDir, "0000000010_fixtures.js"), FIXTURE_SCRIPT);
    const applied = migrateOk(database, ["up"]);
    assert.match(outputOf(applied), /\[0011\] folded 10 node record\(s\)/);

    const names = collectionNames(database.dataDir);
    for (const name of ENGINE_TABLES) assert.ok(names.includes(name), `${name} is created`);
    const fieldNames = nodeFieldNames(database.dataDir);
    for (const name of LEGACY_NODE_COLUMNS) {
      assert.ok(!fieldNames.includes(name), `${name} is dropped`);
    }
    assert.ok(fieldNames.includes("typeVersion"));
    assert.ok(fieldNames.includes("deletedAt"));
    assert.ok(withDatabase(database.dataDir, (db) => db.prepare("pragma table_info('edges')").all().map((row) => row.name)).includes("createdBy"));
    const eventLog = schemaOf(database.dataDir, ["event_log"]).event_log;
    assert.ok(eventLog.columns.includes("sequence"));
    assert.ok(eventLog.columns.includes("workspaceSequence"), "event_log keeps the workspace-level sequence");
    assert.ok(
      eventLog.indexes.includes(
        "CREATE UNIQUE INDEX idx_event_log_workspace_sequence ON event_log (workspaceId, workspaceSequence)",
      ),
      "the workspace cursor has its unique index",
    );
    assert.ok(
      schemaOf(database.dataDir, ["nodes"]).nodes.indexes.includes(
        "CREATE UNIQUE INDEX idx_nodes_semantic ON nodes (workspaceId, semanticId) WHERE semanticId <> ''",
      ),
    );

    const nodes = nodesBySemanticId(database.dataDir);
    for (const [semanticId, content] of Object.entries(EXPECTED_CONTENT)) {
      assert.equal(nodes[semanticId].typeVersion, 1, `${semanticId} is marked folded`);
      assert.deepEqual(nodes[semanticId].content, content, `${semanticId} keeps every legacy value in content`);
    }

    const reverted = migrateOk(database, ["down", "1"], "y\n");
    assert.match(outputOf(reverted), /\[0011\] expanded 10 node record\(s\)/);
    const restored = nodeFieldNames(database.dataDir);
    for (const name of LEGACY_NODE_COLUMNS) assert.ok(restored.includes(name), `${name} comes back`);
    assert.ok(!restored.includes("typeVersion"));
    assert.ok(!restored.includes("deletedAt"));
    const afterDown = collectionNames(database.dataDir);
    for (const name of ENGINE_TABLES) assert.ok(!afterDown.includes(name), `${name} is dropped by down`);
    const imageAddress = withDatabase(database.dataDir, (db) =>
      db.prepare("select content from nodes where semanticId = 'n-image'").get().content,
    );
    assert.equal(JSON.parse(imageAddress), "https://cdn/x.png", "the address returns to the content column");
    assert.equal(withDatabase(database.dataDir, (db) => db.prepare("select width from nodes where semanticId = 'n-image'").get().width), 10);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("running 0011 again leaves the schema and the records untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "dbrainx-pb-0011-repeat-"));
  const database = await installRelease(root);
  try {
    await rewindToLegacyShape(database);
    await writeFile(join(database.runDir, "0000000010_fixtures.js"), FIXTURE_SCRIPT);
    migrateOk(database, ["up"]);
    const before = schemaOf(database.dataDir, ["nodes", "edges", ...ENGINE_TABLES]);
    const nodesBefore = nodesBySemanticId(database.dataDir);

    await copyFile(
      join(pbChangesDir, "0000000011_dynamic_engine.js"),
      join(database.runDir, "0000000012_repeat.js"),
    );
    const repeated = migrateOk(database, ["up"]);
    assert.match(outputOf(repeated), /\[0011\] schema already current, nothing to migrate/);
    assert.deepEqual(schemaOf(database.dataDir, ["nodes", "edges", ...ENGINE_TABLES]), before);
    assert.deepEqual(nodesBySemanticId(database.dataDir), nodesBefore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("0011's down tolerates a partially applied up", async () => {
  const root = await mkdtemp(join(tmpdir(), "dbrainx-pb-0011-partial-"));
  const database = await installRelease(root);
  try {
    await rewindToLegacyShape(database);
    await writeFile(join(database.runDir, "0000000010_fixtures.js"), FIXTURE_SCRIPT);
    migrateOk(database, ["up"]);

    // A run that stopped partway: only `event_log` was created, the edge columns
    // and the node indexes were never added, and one legacy column is back.
    await writeFile(
      join(database.runDir, "0000000012_partial_state.js"),
      `migrate((app) => {
  for (const name of ${JSON.stringify(
    ENGINE_TABLES.filter((name) => name !== "event_log"),
  )}) {
    app.delete(app.findCollectionByNameOrId(name));
  }
  const edges = app.findCollectionByNameOrId("edges");
  edges.fields.removeByName("createdBy");
  edges.fields.removeByName("runId");
  edges.indexes = [];
  app.save(edges);
  const nodes = app.findCollectionByNameOrId("nodes");
  if (!nodes.fields.getByName("width")) nodes.fields.add(new NumberField({ name: "width" }));
  nodes.indexes = [];
  app.save(nodes);
}, (app) => {});
`,
    );
    migrateOk(database, ["up"]);
    assert.ok(!collectionNames(database.dataDir).includes("operation_runs"), "the partial state is in place");

    const reverted = migrateOk(database, ["down", "2"], "y\n");
    assert.equal(reverted.status, 0);
    const restored = nodeFieldNames(database.dataDir);
    for (const name of LEGACY_NODE_COLUMNS) assert.ok(restored.includes(name), `${name} comes back`);
    assert.ok(!restored.includes("typeVersion"));
    const names = collectionNames(database.dataDir);
    for (const name of ENGINE_TABLES) assert.ok(!names.includes(name), `${name} is gone`);
    assert.ok(!withDatabase(database.dataDir, (db) => db.prepare("pragma table_info('edges')").all().map((row) => row.name)).includes("createdBy"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("0011 refuses duplicate (workspaceId, semanticId) pairs and names the records", async () => {
  const root = await mkdtemp(join(tmpdir(), "dbrainx-pb-0011-duplicate-"));
  const database = await installRelease(root);
  try {
    await rewindToLegacyShape(database);
    await writeFile(
      join(database.runDir, "0000000010_duplicates.js"),
      `migrate((app) => {
  const nodes = app.findCollectionByNameOrId("nodes");
  const ids = [];
  for (let index = 0; index < 2; index += 1) {
    const record = new Record(nodes);
    record.set("permission", "private");
    record.set("workspaceId", "ws1");
    record.set("semanticId", "dup-1");
    record.set("nodeType", "text");
    record.set("content", {});
    app.save(record);
    ids.push(record.id);
  }
  console.log("DUPLICATE_IDS " + ids.join(","));
}, (app) => {});
`,
    );
    const failed = pocketbase(database.dataDir, database.runDir, ["up"]);
    assert.notEqual(failed.status, 0, "the migration must refuse the duplicates");
    const output = outputOf(failed);
    const ids = /DUPLICATE_IDS ([a-z0-9,]+)/.exec(output)[1].split(",");
    assert.equal(ids.length, 2);
    assert.match(output, /duplicate \(workspaceId, semanticId\) pairs/);
    for (const id of ids) assert.ok(output.includes(id), `the failure names ${id}`);
    assert.match(output, /semanticId "dup-1"/);
    // The transaction rolled the whole up back: no half-built collection, and
    // the legacy columns are still there.
    const names = collectionNames(database.dataDir);
    for (const name of ENGINE_TABLES) assert.ok(!names.includes(name), `${name} is not left behind`);
    assert.ok(nodeFieldNames(database.dataDir).includes("width"), "the legacy columns are untouched");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a fresh database and an upgraded database share the same schema", async () => {
  const root = await mkdtemp(join(tmpdir(), "dbrainx-pb-0011-compare-"));
  const upgraded = await installRelease(root, [
    "0000000011_dynamic_engine.js",
    "0000000014_automation_timestamps.js",
  ]);
  const fresh = { dataDir: join(root, "fresh-data"), runDir: join(root, "fresh-run") };
  try {
    // Fresh: only the base of this release, exactly what a new install runs.
    await mkdir(fresh.runDir, { recursive: true });
    for (const name of await readdir(pbBaseDir)) {
      await copyFile(join(pbBaseDir, name), join(fresh.runDir, name));
    }
    migrateOk(fresh, ["up"]);

    // Upgraded: the pre-0011 shape of an installed database, then the change
    // scripts this test installs (0011 rebuilds the engine tables; 0014 adds
    // the automation timestamps to a table 0011 recreates).
    await rewindToLegacyShape(upgraded, 2);
    await writeFile(join(upgraded.runDir, "0000000010_fixtures.js"), FIXTURE_SCRIPT);
    migrateOk(upgraded, ["up"]);

    const collections = ["nodes", "edges", ...ENGINE_TABLES];
    assert.deepEqual(
      schemaOf(upgraded.dataDir, collections),
      schemaOf(fresh.dataDir, collections),
      "the upgraded and the fresh database agree on every field, index, and column",
    );
    const nodes = schemaOf(fresh.dataDir, ["nodes"]).nodes;
    assert.ok(nodes.fields.some((field) => field.name === "content" && field.maxSize === 24 * 1024 * 1024));
    assert.ok(nodes.fields.some((field) => field.name === "typeVersion" && field.type === "number"));
    const eventLog = schemaOf(fresh.dataDir, ["event_log"]).event_log;
    assert.ok(eventLog.fields.some((field) => field.name === "workspaceSequence"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const SANDBOX_TABLES = ["sandboxes", "sandbox_files", "sandbox_calls"];

test("0013 creates the sandbox tables, matches the base, and tolerates a partial down", async () => {
  const root = await mkdtemp(join(tmpdir(), "dbrainx-pb-0013-"));
  const database = await installRelease(root, "0000000013_sandbox.js");
  try {
    // The current base already carries the three sandbox tables. Drop them in a
    // migration numbered below 0013 so the change script has to create them,
    // exactly as it does for an installed database that predates this release.
    await writeFile(
      join(database.runDir, "0000000010_drop_sandbox.js"),
      `migrate((app) => {
  for (const name of ${JSON.stringify(SANDBOX_TABLES)}) {
    const found = app.findAllCollections().find((row) => row.name === name);
    if (found) app.delete(found);
  }
}, (app) => {});
`,
    );
    migrateOk(database, ["up"]);

    const upgraded = schemaOf(database.dataDir, SANDBOX_TABLES);
    assert.ok(
      upgraded.sandboxes.indexes.includes(
        "CREATE UNIQUE INDEX idx_sandboxes_key ON sandboxes (workspaceId, pluginId)",
      ),
    );
    assert.ok(
      upgraded.sandbox_files.indexes.includes(
        "CREATE UNIQUE INDEX idx_sandbox_files_path ON sandbox_files (sandboxId, path)",
      ),
    );
    assert.ok(
      upgraded.sandbox_files.indexes.includes(
        "CREATE INDEX idx_sandbox_files_owner ON sandbox_files (ownerNodeId)",
      ),
    );
    assert.ok(
      upgraded.sandbox_calls.indexes.includes(
        "CREATE INDEX idx_sandbox_calls_run ON sandbox_calls (runId)",
      ),
    );
    assert.ok(
      upgraded.sandbox_calls.indexes.includes(
        "CREATE INDEX idx_sandbox_calls_sandbox ON sandbox_calls (sandboxId, startedAt)",
      ),
    );
    assert.ok(upgraded.sandboxes.columns.includes("rootPath"));
    assert.ok(upgraded.sandboxes.columns.includes("maxFiles"));
    assert.ok(upgraded.sandbox_files.columns.includes("sha256"));
    assert.ok(upgraded.sandbox_calls.columns.includes("decision"));
    assert.ok(upgraded.sandbox_calls.columns.includes("errorCode"));

    const rules = withDatabase(database.dataDir, (db) =>
      db
        .prepare(
          "select listRule, viewRule, createRule, updateRule, deleteRule from _collections where name = 'sandboxes'",
        )
        .get(),
    );
    assert.deepEqual(
      { ...rules },
      {
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
      },
      "rootPath stays on the server side",
    );

    // A fresh database is born from the base alone; both paths must agree.
    const fresh = {
      dataDir: join(root, "fresh-data"),
      runDir: join(root, "fresh-run"),
    };
    await mkdir(fresh.runDir, { recursive: true });
    for (const name of await readdir(pbBaseDir)) {
      await copyFile(join(pbBaseDir, name), join(fresh.runDir, name));
    }
    migrateOk(fresh, ["up"]);
    assert.deepEqual(
      schemaOf(fresh.dataDir, SANDBOX_TABLES),
      upgraded,
      "the base and the change script create the same sandbox schema",
    );

    // A run that stopped after creating only two tables still rolls back: the
    // down probes every collection instead of failing on a missing name.
    await writeFile(
      join(database.runDir, "0000000014_drop_calls.js"),
      `migrate((app) => {
  const found = app.findAllCollections().find((row) => row.name === "sandbox_calls");
  if (found) app.delete(found);
}, (app) => {});
`,
    );
    migrateOk(database, ["up"]);
    const reverted = migrateOk(database, ["down", "2"], "y\n");
    assert.equal(reverted.status, 0);
    const remaining = collectionNames(database.dataDir);
    for (const name of SANDBOX_TABLES) {
      assert.ok(!remaining.includes(name), `${name} is gone after down`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
