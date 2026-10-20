// SPDX-License-Identifier: AGPL-3.0-only

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
