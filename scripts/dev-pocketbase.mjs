// SPDX-License-Identifier: AGPL-3.0-only

/** Start the same migrations/hooks used by containers; keep local data in pb/pb_data. */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { requireAdminConfig, upsertSuperuser } from "./lib/pocketbase-admin.mjs";
import { prepareMigrations } from "./lib/pocketbase-migrations.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const binary = join(
  root,
  "pb",
  process.platform === "win32" ? "pocketbase.exe" : "pocketbase",
);

// Hand the developer an operator account before serving, exactly as the container
// entrypoint does, so PocketBase never inserts its placeholder superuser and never
// prints a one-time installer URL.
//
// The account is required configuration and `.env` is its single source of truth,
// so a missing or incomplete `.env` stops the whole stack here (`concurrently -k`
// takes the other processes down with it) instead of leaving the developer on a
// placeholder account they cannot use.
const admin = requireAdminConfig();
const dataDir = resolve(process.env.DBRAIN_PB_DATA_DIR ?? join(root, "pb/pb_data"));
const runDir = join(dataDir, "pb_migrations");
await prepareMigrations({
  dataDir,
  baseDir: join(root, "pb/pb_migrations_base"),
  changesDir: join(root, "pb/pb_migrations_changes"),
  runDir,
});
const adminResult = upsertSuperuser({ ...admin, directory: dataDir });
if (adminResult.error || adminResult.status !== 0) {
  console.error(`[pocketbase] could not ensure the operator account: ${adminResult.error?.message ?? `exit ${adminResult.status}`}`);
  process.exit(1);
}
console.log(`[pocketbase] operator account ensured in ${dataDir}`);

const child = spawn(
  binary,
  [
    "serve",
    `--http=${process.env.DBRAIN_PB_HTTP ?? "127.0.0.1:8090"}`,
    `--dir=${dataDir}`,
    `--migrationsDir=${runDir}`,
    `--hooksDir=${join(root, "pb/pb_hooks")}`,
    "--automigrate=0",
  ],
  { stdio: "inherit", cwd: root },
);
child.on("error", (error) => {
  console.error(
    `PocketBase could not start: ${error.message}. Run node scripts/release/download-pocketbase.mjs first.`,
  );
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 143);
});
