// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `0000000012_node_timestamps.js` and the base schema it mirrors.
 *
 * The failure this guards is not a missing column in the abstract: both mappers
 * read `record.created` / `record.updated`, a PocketBase base collection declares
 * neither, and `Node.create` / `Edge.create` fell back to `new Date()` — so two
 * reads of one row reported two versions and `VERSION_CONFLICT` could never fire.
 * The tests below therefore compare a fresh database with an upgraded one field
 * by field, then read one row twice and watch a write move `updated` forward.
 *
 * Measured on the pinned binary (0.40.4): an autodate field stamps only on
 * create/update and an explicit value for it is dropped on save, which is why the
 * backfill in the migration writes the columns with SQL instead of `record.set`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const binary = join(repo, "pb", process.platform === "win32" ? "pocketbase.exe" : "pocketbase");
const baseDir = join(repo, "pb/pb_migrations_base");
const changesDir = join(repo, "pb/pb_migrations_changes");
const changeScript = "0000000012_node_timestamps.js";

function migrate(database, args, input) {
  const result = spawnSync(
    binary,
    ["migrate", ...args, `--dir=${database.dataDir}`, `--migrationsDir=${database.runDir}`, "--automigrate=0"],
    { encoding: "utf8", timeout: 120_000, input },
  );
  return { result, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function migrateOk(database, args, input) {
  const { result, output } = migrate(database, args, input);
  assert.equal(result.status, 0, output);
  return output;
}

async function copyBase(runDir, extra = []) {
  await mkdir(runDir, { recursive: true });
  for (const name of await readdir(baseDir)) {
    await copyFile(join(baseDir, name), join(runDir, name));
  }
  for (const name of extra) {
    await copyFile(join(changesDir, name), join(runDir, name));
  }
}

function withDatabase(dataDir, run) {
  const db = new DatabaseSync(join(dataDir, "data.db"), { readOnly: true });
  try {
    return run(db);
  } finally {
    db.close();
  }
}

/** Declared fields, indexes, and physical columns, as the parity test compares them. */
function schemaOf(dataDir, names) {
  return withDatabase(dataDir, (db) => {
    const schema = {};
    for (const name of names) {
      const row = db.prepare("select fields, indexes from _collections where name = ?").get(name);
      assert.ok(row, `${name} exists`);
      schema[name] = {
        fields: JSON.parse(row.fields).map(({ id, ...field }) => field),
        indexes: JSON.parse(row.indexes ?? "[]").slice().sort(),
        columns: db.prepare(`pragma table_info('${name}')`).all().map((column) => column.name).sort(),
      };
    }
    return schema;
  });
}

function timestampFields(schema, name) {
  return schema[name].fields.filter((field) => field.type === "autodate");
}

function rows(dataDir, name) {
  return withDatabase(dataDir, (db) =>
    db.prepare(`select id, created, updated from ${name} order by id`).all(),
  );
}

/** Node and one edge, written in the shape a database without 0012 has. */
const FIXTURE_SCRIPT = `migrate((app) => {
  const nodes = app.findCollectionByNameOrId("nodes");
  for (const title of ["first", "second"]) {
    const record = new Record(nodes);
    record.set("permission", "private");
    record.set("nodeType", "text");
    record.set("workspaceId", "ws1");
    record.set("title", title);
    app.save(record);
  }
  const edges = app.findCollectionByNameOrId("edges");
  const edge = new Record(edges);
  edge.set("from", "first");
  edge.set("to", "second");
  edge.set("direction", "forward");
  app.save(edge);
}, (app) => {});
`;

/**
 * A database that predates 0012 but already holds rows.
 *
 * The run directory carries the base, the fixtures (numbered below 0012), and the
 * change script; `up` applies all three, `down 1` reverts the change script alone,
 * which leaves exactly the pre-0012 shape with the fixture rows still in place.
 */
async function upgradedDatabase(root) {
  const database = { dataDir: join(root, "data"), runDir: join(root, "run") };
  await copyBase(database.runDir, [changeScript]);
  await writeFile(join(database.runDir, "0000000002_fixtures.js"), FIXTURE_SCRIPT);
  migrateOk(database, ["up"]);
  migrateOk(database, ["down", "1"], "y\n");
  return database;
}

test("a fresh database declares created and updated on nodes and edges", async () => {
  const root = await mkdtemp(join(tmpdir(), "dbrainx-pb-timestamps-fresh-"));
  const database = { dataDir: join(root, "data"), runDir: join(root, "run") };
  try {
    await copyBase(database.runDir);
    migrateOk(database, ["up"]);

    const schema = schemaOf(database.dataDir, ["nodes", "edges"]);
    for (const name of ["nodes", "edges"]) {
      assert.deepEqual(timestampFields(schema, name), [
        {
          hidden: false,
          name: "created",
          onCreate: true,
          onUpdate: false,
          presentable: false,
          system: false,
          type: "autodate",
        },
        {
          hidden: false,
          name: "updated",
          onCreate: true,
          onUpdate: true,
          presentable: false,
          system: false,
          type: "autodate",
        },
      ]);
      assert.ok(schema[name].columns.includes("created"), `${name}.created is a column`);
      assert.ok(schema[name].columns.includes("updated"), `${name}.updated is a column`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an upgraded database gains the same columns and backfills its rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "dbrainx-pb-timestamps-upgrade-"));
  const fresh = { dataDir: join(root, "fresh-data"), runDir: join(root, "fresh-run") };
  try {
    const upgraded = await upgradedDatabase(root);
    const legacy = schemaOf(upgraded.dataDir, ["nodes", "edges"]);
    for (const name of ["nodes", "edges"]) {
      assert.deepEqual(timestampFields(legacy, name), [], `${name} starts without timestamps`);
    }
    assert.equal(withDatabase(upgraded.dataDir, (db) => db.prepare("select count(*) c from nodes").get().c), 2);

    const upgradedOutput = migrateOk(upgraded, ["up"]);
    assert.match(upgradedOutput, /\[0012\] nodes: added created, updated; backfilled 2 record\(s\)/);
    assert.match(upgradedOutput, /\[0012\] edges: added created, updated; backfilled 1 record\(s\)/);

    await copyBase(fresh.runDir);
    migrateOk(fresh, ["up"]);
    assert.deepEqual(
      schemaOf(upgraded.dataDir, ["nodes", "edges"]),
      schemaOf(fresh.dataDir, ["nodes", "edges"]),
      "the upgraded and the fresh database agree on every field, index, and column",
    );

    for (const name of ["nodes", "edges"]) {
      const backfilled = rows(upgraded.dataDir, name);
      assert.equal(backfilled.length, name === "nodes" ? 2 : 1);
      for (const row of backfilled) {
        assert.notEqual(row.created, "", `${name} ${row.id} has a created value`);
        assert.notEqual(row.updated, "", `${name} ${row.id} has an updated value`);
        assert.ok(!Number.isNaN(Date.parse(row.created.replace(" ", "T"))), `${name}.created parses`);
        assert.ok(!Number.isNaN(Date.parse(row.updated.replace(" ", "T"))), `${name}.updated parses`);
      }
    }

    migrateOk(upgraded, ["down", "1"], "y\n");
    const reverted = schemaOf(upgraded.dataDir, ["nodes", "edges"]);
    for (const name of ["nodes", "edges"]) {
      assert.deepEqual(timestampFields(reverted, name), [], `${name} loses the timestamps on down`);
      assert.ok(!reverted[name].columns.includes("updated"), `${name}.updated column is dropped`);
    }
    assert.equal(withDatabase(upgraded.dataDir, (db) => db.prepare("select count(*) c from nodes").get().c), 2);

    const restored = migrateOk(upgraded, ["up"]);
    assert.match(restored, /\[0012\] nodes: added created, updated; backfilled 2 record\(s\)/);
    assert.deepEqual(
      schemaOf(upgraded.dataDir, ["nodes", "edges"]),
      schemaOf(fresh.dataDir, ["nodes", "edges"]),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a record reads the same version twice, and a write advances updated", async () => {
  const root = await mkdtemp(join(tmpdir(), "dbrainx-pb-timestamps-reads-"));
  try {
    const database = await upgradedDatabase(root);
    migrateOk(database, ["up"]);

    await writeFile(
      join(database.runDir, "0000000003_read_twice.js"),
      `migrate((app) => {
  const record = app.findAllRecords("nodes")[0];
  const first = app.findRecordById("nodes", record.id);
  const second = app.findRecordById("nodes", record.id);
  console.log("READ_TWICE " + JSON.stringify({
    id: record.id,
    firstCreated: first.get("created"),
    secondCreated: second.get("created"),
    firstUpdated: first.get("updated"),
    secondUpdated: second.get("updated"),
  }));
}, (app) => {});
`,
    );
    const readOutput = migrateOk(database, ["up"]);
    const read = JSON.parse(/READ_TWICE (.+)/.exec(readOutput)[1]);
    assert.notEqual(read.firstUpdated, "");
    assert.equal(read.secondCreated, read.firstCreated, "a second read returns the same created value");
    assert.equal(read.secondUpdated, read.firstUpdated, "a second read returns the same updated value");

    await writeFile(
      join(database.runDir, "0000000004_touch.js"),
      `migrate((app) => {
  const record = app.findAllRecords("nodes")[0];
  const before = { created: record.get("created"), updated: record.get("updated") };
  record.set("title", "touched");
  app.save(record);
  const after = app.findRecordById("nodes", record.id);
  console.log("TOUCH " + JSON.stringify({
    id: record.id,
    beforeCreated: before.created,
    afterCreated: after.get("created"),
    beforeUpdated: before.updated,
    afterUpdated: after.get("updated"),
  }));
}, (app) => {});
`,
    );
    const touchOutput = migrateOk(database, ["up"]);
    const touch = JSON.parse(/TOUCH (.+)/.exec(touchOutput)[1]);
    assert.equal(touch.afterCreated, touch.beforeCreated, "a write keeps created");
    assert.ok(
      Date.parse(touch.afterUpdated.replace(" ", "T")) >
        Date.parse(touch.beforeUpdated.replace(" ", "T")),
      `a write advances updated (${touch.beforeUpdated} -> ${touch.afterUpdated})`,
    );
    assert.equal(touch.afterUpdated, rows(database.dataDir, "nodes").find((row) => row.id === touch.id).updated);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
