// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Stable failure codes for a yt-dlp run.
 *
 * yt-dlp reports every failure as one line on stderr, in wording that changes
 * between versions and sites. The UI cannot act on that wording: a login error
 * has to highlight a site capsule, a size error has to suggest a lower
 * quality. This module maps the known wording to a {@link MediaImportFailure}
 * code, so the reason survives to the client as a stable value.
 *
 * The full stderr is never shown. The last lines are kept as the message, with
 * ANSI escapes removed, because they carry the site's own explanation (for
 * example the account name or the missing permission) while the first lines are
 * usually noise. A command line or a cookie is never part of the message.
 */

import type { MediaImportErrorCode } from "@workspace/interfaces";
import { MediaImportFailure } from "@workspace/utils/media-import";

/** What the failed command was trying to do; only shapes the message. */
export interface YtDlpFailureContext {
  /** `download` keeps the message about fetching a file. */
  action?: "download" | "probe";
}

/** Maps one failed run's stderr to a classified failure. */
export function classifyYtDlpFailure(
  stderr: string,
  context: YtDlpFailureContext = {},
): MediaImportFailure {
  const detail = lastLines(stderr);
  const action =
    context.action === "probe" ? "Reading the media page" : "Media download";

  for (const [pattern, code] of PATTERNS) {
    if (pattern.test(detail)) {
      return new MediaImportFailure(code, `${action} failed: ${detail}`);
    }
  }

  return new MediaImportFailure(
    "unknown",
    detail === "" ? `${action} failed` : `${action} failed: ${detail}`,
  );
}

/** The failure a missing `yt-dlp` binary produces. */
export function missingBinaryFailure(command: string): MediaImportFailure {
  return new MediaImportFailure(
    "unknown",
    `${command} is not available on the server; install yt-dlp or point YT_DLP_PATH at it`,
  );
}

/** Order matters: the first match wins; a login error can mention "private". */
const PATTERNS: ReadonlyArray<[RegExp, MediaImportErrorCode]> = [
  [
    /login required|only available for registered|sign in|log ?in to|请登录|需登录|登录后/i,
    "login_required",
  ],
  [/private video|this video is private|仅自己可见|私有/i, "private"],
  [
    /members[- ]only|available to .{0,40}members|join this channel|vip|会员|大会员/i,
    "members_only",
  ],
  [/larger than max-filesize|max-filesize|file is larger/i, "size_limit"],
  [
    /no video formats found|no formats found|requested format is not available|no media found/i,
    "no_media",
  ],
  [/unsupported url|not a valid url|invalid url/i, "unsupported_url"],
  [/timed out|timeout/i, "timeout"],
  [
    /unable to download|getaddrinfo|econnrefused|econnreset|etimedout|temporary failure in name resolution|urlopen error|proxy|network|http error [45]\d\d|connection (?:reset|refused|closed|aborted)|ssl/i,
    "network",
  ],
];

/** The last useful lines of stderr, without ANSI escapes, at most 600 chars. */
function lastLines(stderr: string): string {
  // The ANSI escape byte is the point of this pattern.
  // eslint-disable-next-line no-control-regex
  const plain = stderr.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r\n?/g, "\n");
  const lines = plain
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  const tail = lines.slice(-6).join("\n");
  return tail.length > 600 ? tail.slice(-600) : tail;
}
