// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The cookie file a download or probe hands to yt-dlp.
 *
 * A saved login is a Netscape `cookies.txt` export. yt-dlp can only read it from
 * a file, so it has to exist on disk for the length of one run. Two rules keep
 * that file from becoming a leak:
 *
 * - it is created with mode `0600`, and the mode is set again after writing,
 *   because rewriting an existing file keeps the old mode;
 * - it is removed as soon as the run ends, success or failure, and the
 *   downloader's `cleanup` removes it again for safety.
 *
 * The text itself is never logged and never part of an argument list; only the
 * path is passed with `--cookies`.
 */

import { chmod, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Name of the cookie file inside a work directory. */
export const COOKIE_FILE_NAME = "cookies.txt";

/**
 * Writes the cookie text into `workDir` and returns the file path.
 *
 * The caller owns the directory; this function only adds the one file, which it
 * also removes.
 */
export async function writeCookieFile(
  workDir: string,
  cookieText: string,
): Promise<string> {
  const path = join(workDir, COOKIE_FILE_NAME);
  await writeFile(path, cookieText, { encoding: "utf8", mode: 0o600 });
  // `writeFile` keeps the mode of an existing file, so a resumed job could
  // otherwise reuse a file created with a wider mode.
  await chmod(path, 0o600);
  return path;
}

/** Removes one cookie file; a missing path or a missing file is not an error. */
export async function removeCookieFile(
  path: string | undefined,
): Promise<void> {
  if (!path) return;
  await rm(path, { force: true });
}
