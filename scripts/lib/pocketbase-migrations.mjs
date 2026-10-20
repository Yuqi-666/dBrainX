// SPDX-License-Identifier: AGPL-3.0-only

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const stateName = ".dbrain-migration-origin";
const migrationName = /^([0-9]+)_[a-z0-9_]+\.js$/;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function files(dir) {
  return (await readdir(dir)).filter((name) => migrationName.test(name)).sort();
}

/** Prepare a durable PocketBase run directory before starting PocketBase. */
export async function prepareMigrations({ dataDir, baseDir, changesDir, runDir }) {
  await mkdir(runDir, { recursive: true, mode: 0o700 });
  const statePath = join(runDir, stateName);
  let state;
  try {
    const [origin, cutoff, baseFile, baseSha256] = (await readFile(statePath, "utf8")).trim().split(" ");
    state = { origin, cutoff: Number(cutoff), baseFile, baseSha256 };
  }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const changes = await files(changesDir);
  const bases = await files(baseDir);
  if (bases.length !== 1) throw new Error("Exactly one PocketBase base migration is required");
  if (!state) {
    let existing = false;
    try { existing = (await stat(join(dataDir, "data.db"))).isFile(); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing || (await files(runDir)).length) {
      throw new Error("Existing PocketBase data predates the migration baseline; restore or migrate it explicitly");
    }
    state = { origin: "base", cutoff: Math.max(0, ...changes.map((name) => Number(migrationName.exec(name)[1]))) };
    const name = bases[0];
    const bytes = await readFile(join(baseDir, name));
    state.baseFile = name;
    state.baseSha256 = digest(bytes);
    try { await copyFile(join(baseDir, name), join(runDir, name), 1); }
    catch (error) {
      if (error.code !== "EEXIST" || digest(await readFile(join(runDir, name))) !== state.baseSha256) throw error;
    }
    await writeFile(`${statePath}.tmp`, `${state.origin} ${state.cutoff} ${state.baseFile ?? "-"} ${state.baseSha256 ?? "-"}\n`, { mode: 0o600 });
    await rename(`${statePath}.tmp`, statePath);
  }
  if (state.origin !== "base" || state.baseFile !== bases[0] || !Number.isSafeInteger(state.cutoff)) {
    throw new Error("PocketBase data predates the migration baseline; restore or migrate it explicitly");
  }
  const bytes = await readFile(join(runDir, state.baseFile));
  if (digest(bytes) !== state.baseSha256) throw new Error("Installed base migration changed");
  let copied = 0;
  for (const name of changes) {
    if (Number(migrationName.exec(name)[1]) <= state.cutoff) continue;
    const source = await readFile(join(changesDir, name));
    const target = join(runDir, name);
    try {
      if (digest(await readFile(target)) !== digest(source)) throw new Error(`Installed migration changed: ${name}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await copyFile(join(changesDir, name), target, 1);
      copied++;
    }
  }
  console.log(`[migrations] ${state.origin} database; ${copied} change script(s) added`);
  return state;
}
