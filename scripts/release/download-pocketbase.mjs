// SPDX-License-Identifier: AGPL-3.0-only

import {
  readFile,
  mkdir,
  writeFile,
  chmod,
  mkdtemp,
  rm,
  copyFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const lock = JSON.parse(
  await readFile(new URL("./pocketbase-lock.json", import.meta.url)),
);
const platform = process.platform === "win32" ? "windows" : process.platform;
const arch = process.arch === "x64" ? "amd64" : process.arch;
const name = `pocketbase_${lock.version}_${platform}_${arch}.zip`;
if (!lock.sha256[name])
  throw new Error(`Unsupported PocketBase target: ${name}`);
const response = await fetch(
  `https://github.com/pocketbase/pocketbase/releases/download/v${lock.version}/${name}`,
);
if (!response.ok)
  throw new Error(`PocketBase download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash("sha256").update(bytes).digest("hex") !== lock.sha256[name])
  throw new Error("PocketBase SHA256 mismatch");
const temp = await mkdtemp(join(tmpdir(), "dbrain-pb-"));
try {
  const archive = join(temp, "pb.zip");
  await writeFile(archive, bytes);
  const extracted = join(temp, "extracted");
  await mkdir(extracted);
  // tar on Windows supports zip; other supported build hosts provide unzip.
  if (process.platform === "win32")
    execFileSync("tar", ["-xf", archive, "-C", extracted]);
  else execFileSync("unzip", ["-q", archive, "-d", extracted]);
  const binary = process.platform === "win32" ? "pocketbase.exe" : "pocketbase";
  const directory = resolve(process.argv[2] ?? "pb");
  await mkdir(directory, { recursive: true });
  await copyFile(join(extracted, binary), join(directory, binary));
  await chmod(join(directory, binary), 0o755);
  execFileSync(join(directory, binary), ["--version"], { stdio: "inherit" });
} finally {
  await rm(temp, { recursive: true, force: true });
}
