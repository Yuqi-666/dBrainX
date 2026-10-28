// SPDX-License-Identifier: AGPL-3.0-only

import { backup, DatabaseSync } from "node:sqlite";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";

/** Number of pre-upgrade snapshots to keep in the `backups` directory. */
export const UPGRADE_BACKUP_RETENTION = 2;

/** Keeps the newest `keep` snapshots and removes the older ones.
 * The `before-upgrade-<timestamp>` suffix carries the order, so the rule does
 * not depend on directory enumeration order and a repeated call is a no-op.
 * `protect` names the snapshot that the current run just created; it survives
 * even if an earlier clock value sorts above it. */
export async function pruneUpgradeBackups(
  dataDir: string,
  keep = UPGRADE_BACKUP_RETENTION,
  protect?: string,
): Promise<void> {
  const backupsDir = join(dataDir, "backups");
  let entries: Dirent[];
  try {
    entries = await readdir(backupsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const prefix = "before-upgrade-";
  const backups = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => ({ name: entry.name, timestamp: Number(entry.name.slice(prefix.length)) }))
    .filter((backup) => Number.isFinite(backup.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp);
  const retained = new Set<string>();
  if (protect) retained.add(protect);
  for (const backup of backups) {
    if (retained.size >= keep) break;
    retained.add(backup.name);
  }
  for (const backup of backups) {
    if (!retained.has(backup.name)) await rm(join(backupsDir, backup.name), { recursive: true, force: true });
  }
}

/** Runs after acquiring the device lock and before starting PocketBase/migrations.
 * SQLite's backup API creates coherent DB snapshots even when an old WAL exists. */
export async function prepareUpgradeBackup(
  dataDir: string,
  fingerprint: string,
): Promise<string | undefined> {
  const statePath = join(dataDir, "release-state.json");
  let previous: { fingerprint: string } | undefined;
  try {
    previous = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (previous?.fingerprint === fingerprint) return;
  const databaseDir = join(dataDir, "pb_data");
  try {
    await stat(join(databaseDir, "data.db"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const targetName = `before-upgrade-${Date.now()}`;
  const target = join(dataDir, "backups", targetName);
  const staging = `${target}.partial`;
  await mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    await cp(databaseDir, join(staging, "pb_data"), {
      recursive: true,
      filter: (path) => !/\.db(?:-wal|-shm)?$/.test(path),
    });
    for (const entry of await readdir(databaseDir)) {
      if (!entry.endsWith(".db")) continue;
      const db = new DatabaseSync(join(databaseDir, entry), { readOnly: true });
      try {
        await backup(db, join(staging, "pb_data", entry));
      } finally {
        db.close();
      }
    }
    for (const entry of ["local-identity.json", "release-state.json"]) {
      try {
        await cp(join(dataDir, entry), join(staging, entry));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    try { await cp(join(dataDir, "pb_migrations"), join(staging, "pb_migrations"), { recursive: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await writeFile(
      join(staging, "backup.json"),
      JSON.stringify({
        from: previous?.fingerprint ?? "legacy",
        to: fingerprint,
        createdAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw new Error(
      "Upgrade backup failed; database migration has not started",
      { cause: error },
    );
  }
  // Drop the snapshots beyond the retention window once the new one is durable.
  await pruneUpgradeBackups(dataDir, UPGRADE_BACKUP_RETENTION, targetName);
  return target;
}
export async function commitReleaseState(
  dataDir: string,
  fingerprint: string,
): Promise<void> {
  const target = join(dataDir, "release-state.json");
  await writeFile(`${target}.tmp`, JSON.stringify({ fingerprint }), {
    mode: 0o600,
  });
  await rename(`${target}.tmp`, target);
}
