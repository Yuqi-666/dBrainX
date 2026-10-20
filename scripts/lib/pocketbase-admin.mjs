// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The PocketBase operator account: configuration loading and provisioning.
 *
 * Dev counterpart of `deploy/pocketbase/entrypoint.sh`. Both hand PocketBase its
 * operator account *before* `serve` starts, so PocketBase never falls back to its
 * placeholder superuser (`__pbinstaller@example.com`) and the one-time installer
 * URL it prints (which is unreachable in the container stack anyway).
 *
 * The account is **required configuration**, not an optional nicety: `.env` is
 * the single source of truth, and a missing or incomplete one is a hard error, so
 * neither a developer machine nor a deployment can quietly end up with only the
 * placeholder account. See `.env.example` and `docs/operations.md`.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const root = fileURLToPath(new URL("../..", import.meta.url));

export const envPath = join(root, ".env");
export const envExamplePath = join(root, ".env.example");

export function pocketbaseBinary() {
  return join(
    root,
    "pb",
    process.platform === "win32" ? "pocketbase.exe" : "pocketbase",
  );
}

export function pocketbaseDataDir() {
  return resolve(process.env.DBRAIN_PB_DATA_DIR ?? join(root, "pb/pb_data"));
}

/**
 * Reads and validates `.env`.
 *
 * `process.loadEnvFile` deliberately does not override variables that already
 * exist in the environment (shell exports win), so this validates the *effective*
 * configuration — the same thing the container entrypoint sees. Exits the process
 * with status 1 and a readable message rather than returning a partial config.
 */
export function requireAdminConfig() {
  try {
    process.loadEnvFile(envPath);
  } catch {
    console.error(
      `[pocketbase] ${envPath} is missing. The operator account is required configuration:\n` +
        `  cp .env.example .env    # then set DBRAIN_ADMIN_EMAIL and DBRAIN_ADMIN_PASSWORD`,
    );
    process.exit(1);
  }

  const email = process.env.DBRAIN_ADMIN_EMAIL?.trim();
  let password = process.env.DBRAIN_ADMIN_PASSWORD ?? "";
  const passwordFile = process.env.DBRAIN_ADMIN_PASSWORD_FILE;
  if (passwordFile) {
    // Relative to the repository root, not to the caller's working directory:
    // `pnpm dev` runs this from `apps/server` while `pb:admin` runs it from the
    // root, and `.env` itself lives at the root.
    const path = resolve(root, passwordFile);
    try {
      // Secret files are often written with a trailing newline; a password must not be.
      password = readFileSync(path, "utf8").replace(/[\r\n]/g, "");
    } catch (error) {
      console.error(
        `[pocketbase] DBRAIN_ADMIN_PASSWORD_FILE is not a readable file: ${path} (${error.message})`,
      );
      process.exit(1);
    }
  }

  if (!email || !password) {
    console.error(
      `[pocketbase] ${envPath} must set both DBRAIN_ADMIN_EMAIL and a password ` +
        `(DBRAIN_ADMIN_PASSWORD, or DBRAIN_ADMIN_PASSWORD_FILE pointing at the file).`,
    );
    process.exit(1);
  }
  return { email, password };
}

/**
 * Returns the process exit status. `stdio: "inherit"` so PocketBase's own
 * confirmation is what the caller sees.
 */
export function upsertSuperuser({ email, password, directory }) {
  return spawnSync(
    pocketbaseBinary(),
    ["superuser", "upsert", email, password, `--dir=${directory}`],
    { cwd: root, stdio: "inherit" },
  );
}

/** Validate `.env`, then write the account it names. Returns an exit status. */
export function applyAdminConfig() {
  const { email, password } = requireAdminConfig();
  const directory = pocketbaseDataDir();
  const result = upsertSuperuser({ email, password, directory });
  if (result.error) {
    console.error(
      `[pocketbase] could not run the PocketBase binary (${pocketbaseBinary()}): ${result.error.message}. Run node scripts/release/download-pocketbase.mjs first.`,
    );
    return 1;
  }
  if (result.status === 0)
    console.log(`[pocketbase] operator account ensured in ${directory}`);
  return result.status ?? 1;
}
