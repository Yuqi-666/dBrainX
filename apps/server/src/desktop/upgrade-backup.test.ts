// SPDX-License-Identifier: AGPL-3.0-only

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { prepareUpgradeBackup, commitReleaseState, pruneUpgradeBackups } from "./upgrade-backup.ts";
test("upgrade snapshots a WAL database, attachments and identity; repeat launch does not back up again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dbrain-upgrade-test-"));
  let db: DatabaseSync | undefined;
  try {
    assert.equal(await prepareUpgradeBackup(dir, "v1"), undefined);
    await mkdir(join(dir, "pb_data/storage"), { recursive: true });
    db = new DatabaseSync(join(dir, "pb_data/data.db"));
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE fixture (value TEXT); INSERT INTO fixture VALUES ('preserved')");
    await writeFile(join(dir, "pb_data/storage/file.txt"), "attachment");
    await writeFile(join(dir, "local-identity.json"), '{"identity":"same"}');
    await mkdir(join(dir, "pb_migrations"));
    await writeFile(join(dir, "pb_migrations/.dbrain-migration-origin"), "base 2000000000 base.js hash\n");
    await commitReleaseState(dir, "v1");
    const target = await prepareUpgradeBackup(dir, "v2"); assert.ok(target);
    const snapshot = new DatabaseSync(join(target, "pb_data/data.db"), { readOnly: true });
    assert.equal(snapshot.prepare("SELECT value FROM fixture").get()!.value, "preserved"); snapshot.close();
    assert.equal(await readFile(join(target, "pb_data/storage/file.txt"), "utf8"), "attachment");
    assert.equal(await readFile(join(target, "local-identity.json"), "utf8"), '{"identity":"same"}');
    assert.equal(await readFile(join(target, "pb_migrations/.dbrain-migration-origin"), "utf8"), "base 2000000000 base.js hash\n");
    await commitReleaseState(dir, "v2");
    assert.equal(await prepareUpgradeBackup(dir, "v2"), undefined);
  } finally { db?.close(); await rm(dir, { recursive: true, force: true }); }
});

test("upgrade retention keeps the two newest snapshots by timestamp and is idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dbrain-upgrade-retention-"));
  try {
    const backups = join(dir, "backups");
    for (const name of ["before-upgrade-1000", "before-upgrade-3000", "before-upgrade-2000"]) {
      await mkdir(join(backups, name), { recursive: true });
      await writeFile(join(backups, name, "marker"), name);
    }
    await pruneUpgradeBackups(dir);
    assert.deepEqual((await readdir(backups)).sort(), ["before-upgrade-2000", "before-upgrade-3000"]);
    // A repeated cleanup keeps the same two snapshots.
    await pruneUpgradeBackups(dir);
    assert.deepEqual((await readdir(backups)).sort(), ["before-upgrade-2000", "before-upgrade-3000"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("upgrade retention keeps a single snapshot and tolerates an absent backup directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dbrain-upgrade-retention-"));
  try {
    const backups = join(dir, "backups");
    await pruneUpgradeBackups(dir);
    await mkdir(join(backups, "before-upgrade-1000"), { recursive: true });
    await pruneUpgradeBackups(dir);
    assert.deepEqual(await readdir(backups), ["before-upgrade-1000"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("upgrade keeps the newest two snapshots and never deletes the current one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dbrain-upgrade-retention-"));
  let db: DatabaseSync | undefined;
  try {
    await mkdir(join(dir, "pb_data"), { recursive: true });
    db = new DatabaseSync(join(dir, "pb_data/data.db"));
    db.exec("CREATE TABLE fixture (value TEXT)");
    const created: string[] = [];
    const upgrades: [string, string][] = [["v1", "v2"], ["v2", "v3"], ["v3", "v4"]];
    for (const [from, to] of upgrades) {
      await new Promise(resolve => setTimeout(resolve, 2));
      await commitReleaseState(dir, from);
      const target = await prepareUpgradeBackup(dir, to);
      assert.ok(target);
      created.push(basename(target));
    }
    const kept = (await readdir(join(dir, "backups"))).sort();
    assert.equal(kept.length, 2);
    assert.deepEqual(kept, created.slice(1).sort());
    assert.ok(kept.includes(created[created.length - 1]!));
  } finally { db?.close(); await rm(dir, { recursive: true, force: true }); }
});
