import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareMigrations } from "./pocketbase-migrations.mjs";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

test("new databases run the genesis base and later changes; older databases are rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "dbrain-migrations-"));
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
  const root = await mkdtemp(join(tmpdir(), "dbrain-pb-upgrade-"));
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
  const root = await mkdtemp(join(tmpdir(), "dbrain-migrations-next-"));
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
    const state = await readFile(join(database.runDir, ".dbrain-migration-origin"), "utf8");
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
  const marker = '  },\n  (app) => {\n    app.delete(app.findCollectionByNameOrId("media_site_auths"));';
  assert.ok(base.includes(marker), "base schema keeps its rollback marker");
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
