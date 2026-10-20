// SPDX-License-Identifier: AGPL-3.0-only

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const script = fileURLToPath(
  new URL("../../deploy/update.sh", import.meta.url),
);
const mountLine = (root, mountPoint) =>
  `42 1 0:52 ${root} ${mountPoint} rw,relatime - ext4 /dev/sda1 rw\n`;

async function deployment(env = "DBRAIN_AUTO_UPDATE=true\n") {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "dbrain-")));
  await writeFile(join(directory, "docker-compose.yml"), "services: {}\n");
  await writeFile(join(directory, ".env"), env);
  return directory;
}

async function mounts(directory, lines) {
  const file = join(directory, "mountinfo");
  await writeFile(file, lines.join(""));
  return file;
}

function projectDirectory(directory, mountinfo) {
  return execFileAsync(
    "sh",
    [script, "--print-project-directory"],
    { cwd: directory, env: { ...process.env, DBRAIN_MOUNTINFO: mountinfo } },
  ).then(({ stdout }) => stdout.trim());
}

test("a host run keeps the deployment directory", async (t) => {
  const directory = await deployment();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mountinfo = await mounts(directory, [mountLine("/", "/")]);
  assert.equal(await projectDirectory(directory, mountinfo), directory);
});

test("the updater container resolves the host path of its mount", async (t) => {
  const directory = await deployment();
  t.after(() => rm(directory, { recursive: true, force: true }));
  // The updater mounts the deployment directory at another path in the
  // container. The project directory must be the host path of that mount.
  const mountinfo = await mounts(directory, [
    mountLine("/opt/dbrain", directory),
  ]);
  assert.equal(await projectDirectory(directory, mountinfo), "/opt/dbrain");
});

test("a filesystem mounted at the deployment directory keeps it", async (t) => {
  const directory = await deployment();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mountinfo = await mounts(directory, [mountLine("/", directory)]);
  assert.equal(await projectDirectory(directory, mountinfo), directory);
});

test("the mount table decodes an escaped space in a host path", async (t) => {
  const directory = await deployment();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mountinfo = await mounts(directory, [
    mountLine("/srv/my\\040dbrain", directory),
  ]);
  assert.equal(await projectDirectory(directory, mountinfo), "/srv/my dbrain");
});

test("DBRAIN_DEPLOYMENT_DIR overrides the mount table", async (t) => {
  const directory = await deployment(
    "DBRAIN_AUTO_UPDATE=true\nDBRAIN_DEPLOYMENT_DIR=/srv/dbrain\n",
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mountinfo = await mounts(directory, [
    mountLine("/opt/dbrain", directory),
  ]);
  assert.equal(await projectDirectory(directory, mountinfo), "/srv/dbrain");
});

test("a relative DBRAIN_DEPLOYMENT_DIR is refused", async (t) => {
  const directory = await deployment("DBRAIN_DEPLOYMENT_DIR=deployment\n");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mountinfo = await mounts(directory, [
    mountLine("/opt/dbrain", directory),
  ]);
  await assert.rejects(
    projectDirectory(directory, mountinfo),
    (error) =>
      error.code === 2 && /must be an absolute path/.test(error.stderr),
  );
});

test("one Compose call passes the project directory and the environment", async () => {
  const text = await readFile(script, "utf8");
  assert.equal(text.match(/docker compose/g)?.length, 1);
  assert.match(text, /--project-directory "\$project"/);
  assert.match(text, /--env-file "\$here\/\.env"/);
});
