// SPDX-License-Identifier: AGPL-3.0-only

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const script = fileURLToPath(new URL("../../deploy/updater/watch.sh", import.meta.url));

// The updater image has no test harness. This stub replaces curl and records
// the response that the test wants.
const curlStub = `#!/bin/sh
printf '%s\\n' "$*" >> "$DBRAIN_STUB_CURL_LOG"
body=''
headers=''
etag_save=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) body="$2"; shift 2 ;;
    -D) headers="$2"; shift 2 ;;
    --etag-save) etag_save="$2"; shift 2 ;;
    --etag-compare) shift 2 ;;
    -w) shift 2 ;;
    *) shift ;;
  esac
done
[ -z "$body" ] || printf '%s' "$DBRAIN_STUB_BODY" > "$body"
[ -z "$headers" ] || printf '%s' "$DBRAIN_STUB_HEADERS" > "$headers"
[ -z "$etag_save" ] || printf '%s\\n' 'W/"stub"' > "$etag_save"
printf '%s' "$DBRAIN_STUB_STATUS"
exit 0
`;

const runs = (id, attempt) =>
  JSON.stringify({
    workflow_runs: [
      { id, run_attempt: attempt, conclusion: "success", head_branch: "v0.1.6", event: "push" },
    ],
  });

async function scenario(t, options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "dbrain-watch-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const state = join(root, "state");
  await mkdir(bin, { recursive: true });
  await mkdir(state, { recursive: true });
  await writeFile(join(bin, "curl"), curlStub);
  await chmod(join(bin, "curl"), 0o755);
  await writeFile(join(root, ".env"), options.env ?? "DBRAIN_AUTO_UPDATE=true\n");
  await writeFile(
    join(root, "update.sh"),
    '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$DBRAIN_STUB_UPDATE_LOG"\n',
  );
  await writeFile(join(root, ".current-version"), `${options.current ?? "candidate-100-1"}\n`);
  if (options.lastRun) await writeFile(join(root, ".auto-update-last-run"), `${options.lastRun}\n`);
  if (options.failed) await writeFile(join(root, ".auto-update-failed"), "candidate-100-1\n");
  return {
    root,
    state,
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      TMPDIR: state,
      DBRAIN_DEPLOYMENT_PATH: root,
      DBRAIN_STUB_CURL_LOG: join(root, "curl.log"),
      DBRAIN_STUB_UPDATE_LOG: join(root, "update.log"),
      DBRAIN_STUB_BODY: options.body ?? runs(200, 1),
      DBRAIN_STUB_HEADERS: options.headers ?? "",
      DBRAIN_STUB_STATUS: options.status ?? "200",
    },
  };
}

async function once({ root, env }, extra = {}) {
  return execFileAsync("sh", [script, "--once"], {
    cwd: root,
    env: { ...process.env, ...env, ...extra },
  });
}

async function entries(root) {
  return (await readdir(root)).sort();
}

test("the updater polls every 15 seconds", async () => {
  const text = await readFile(script, "utf8");
  assert.match(text, /^interval=15$/m);
  assert.doesNotMatch(text, /interval=300/);
});

test("a newer candidate runs update.sh and records it", async (t) => {
  const deployment = await scenario(t, { current: "candidate-100-1" });
  await once(deployment);
  assert.match(
    await readFile(join(deployment.root, "curl.log"), "utf8"),
    /release-candidate\.yml\/runs\?event=push/,
  );
  assert.equal((await readFile(join(deployment.root, "update.log"), "utf8")).trim(), "candidate-200-1");
  assert.equal(
    (await readFile(join(deployment.root, ".auto-update-last-run"), "utf8")).trim(),
    "candidate-200-1",
  );
});

test("an unchanged result (304) stops before update.sh", async (t) => {
  const deployment = await scenario(t, { status: "304", body: "" });
  await once(deployment);
  assert.ok(!(await entries(deployment.root)).includes("update.log"));
});

test("an older candidate does not replace the current one", async (t) => {
  const deployment = await scenario(t, { current: "candidate-300-1", body: runs(200, 1) });
  await once(deployment);
  assert.ok(!(await entries(deployment.root)).includes("update.log"));
});

test("a recorded failure pauses the checks without a request", async (t) => {
  const deployment = await scenario(t, { failed: true });
  await once(deployment);
  assert.ok(!(await entries(deployment.root)).includes("curl.log"));
});

test("a token from .env becomes an authenticated request", async (t) => {
  const deployment = await scenario(t, {
    env: "DBRAIN_AUTO_UPDATE=true\nDBRAIN_GITHUB_TOKEN=stub-token\n",
  });
  await once(deployment);
  assert.equal(
    await readFile(join(deployment.state, "dbrain-watch", "auth.conf"), "utf8"),
    'header = "Authorization: Bearer stub-token"\n',
  );
  assert.match(await readFile(join(deployment.root, "curl.log"), "utf8"), /-K /);
});

test("an exhausted API limit makes the loop wait", async (t) => {
  const reset = Math.floor(Date.now() / 1000) + 2;
  const deployment = await scenario(t, {
    status: "403",
    headers: `x-ratelimit-remaining: 0\r\nx-ratelimit-reset: ${reset}\r\n`,
  });
  const { stderr } = await execFileAsync("sh", [script], {
    cwd: deployment.root,
    env: { ...process.env, ...deployment.env },
    timeout: 4000,
  }).catch((error) => error);
  assert.match(stderr, /GitHub API limit reached/);
});
