// SPDX-License-Identifier: AGPL-3.0-only

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const version = process.argv[2];
if (
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version ?? "")
)
  throw new Error("Usage: pnpm release:version 0.2.0[-beta.1]");
for (const file of [
  "scripts/release/release.json",
  "apps/desktop/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
]) {
  const path = resolve(root, file),
    value = JSON.parse(await readFile(path));
  value.version = version;
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
const cargo = resolve(root, "apps/desktop/src-tauri/Cargo.toml");
await writeFile(
  cargo,
  (await readFile(cargo, "utf8")).replace(
    /^(version = ")[^"]+("$)/m,
    `$1${version}$2`,
  ),
);
const lock = resolve(root, "apps/desktop/src-tauri/Cargo.lock");
await writeFile(
  lock,
  (await readFile(lock, "utf8")).replace(
    /(\[\[package\]\]\r?\nname = "app"\r?\nversion = ")[^"]+"/,
    `$1${version}"`,
  ),
);
for (const file of ["docker-compose.yml", "deploy/.env.example"]) {
  const path = resolve(root, file),
    value = await readFile(path, "utf8");
  await writeFile(
    path,
    value
      .replace(/DBRAINX_VERSION:-[^}]+/g, `DBRAINX_VERSION:-${version}`)
      .replace(/^DBRAINX_VERSION=.+$/m, `DBRAINX_VERSION=${version}`),
  );
}
console.log(`Product version synchronized: ${version}`);
