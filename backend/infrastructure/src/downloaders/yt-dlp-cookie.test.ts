// SPDX-License-Identifier: AGPL-3.0-only

/** The temporary cookie file a run hands to yt-dlp. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  COOKIE_FILE_NAME,
  removeCookieFile,
  writeCookieFile,
} from "./yt-dlp-cookie.ts";

test("writes the cookie text with mode 0600 and removes it again", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "dbrainx-cookie-test-"));
  try {
    const cookieText =
      "Netscape HTTP Cookie File\n.example.test\tTRUE\t/\tFALSE\t0\tSESSION\tabc\n";
    const path = await writeCookieFile(workDir, cookieText);

    assert.equal(path, join(workDir, COOKIE_FILE_NAME));
    assert.equal(await readFile(path, "utf8"), cookieText);
    assert.equal((await stat(path)).mode & 0o777, 0o600);

    await removeCookieFile(path);
    await assert.rejects(stat(path));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("rewrites a wider mode to 0600", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "dbrainx-cookie-test-"));
  try {
    const path = join(workDir, COOKIE_FILE_NAME);
    await writeFile(path, "old");
    await chmod(path, 0o644);

    await writeCookieFile(workDir, "new");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("removing a missing cookie file is not an error", async () => {
  await removeCookieFile(
    join(tmpdir(), "dbrainx-does-not-exist", "cookies.txt"),
  );
  await removeCookieFile(undefined);
});
