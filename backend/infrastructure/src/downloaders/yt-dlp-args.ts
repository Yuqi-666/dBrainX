// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The yt-dlp argument list, built here so it can be read and tested alone.
 *
 * The arguments are load-bearing security settings as much as download
 * settings, and they differ only slightly between a video and an audio import.
 * Building them in one pure function keeps the differences visible:
 *
 * - `--ignore-config` stops a user's global yt-dlp config from changing what
 *   the server runs, and `--no-exec` stops a site from making yt-dlp run a
 *   post-processor.
 * - `--` ends the option list, so a pasted address can never be read as a
 *   flag.
 * - `--max-filesize` is the early ceiling; the downloader re-checks the real
 *   size because not every site declares one.
 * - `--concurrent-fragments 4` is a fixed server policy, not a user setting.
 * - Subtitles and thumbnails are requested on every run; a site without them
 *   simply writes no file, which is not an error.
 * - A cookie is passed by file path (`--cookies`) or by browser name
 *   (`--cookies-from-browser`), never as text in argv.
 */

import { dirname, join } from "node:path";

import type { MediaKind } from "@workspace/interfaces";

/** Fixed fragment concurrency; the site is asked for at most four at once. */
export const CONCURRENT_FRAGMENTS = 4;

/**
 * Progress template. It prints `download:<downloaded>/<total>/<speed>/<eta>`,
 * one line per update with `--newline`; `NA` marks a value the site omits.
 */
export const PROGRESS_TEMPLATE =
  "download:%(progress.downloaded_bytes)s/%(progress.total_bytes)s/%(progress.speed)s/%(progress.eta)s";

/** Video subtitle selection: every language, minus the chat replay. */
const VIDEO_SUBTITLE_LANGUAGES = "all,-live_chat";

/** Audio subtitle selection: the lyrics track, then every other track. */
const AUDIO_SUBTITLE_LANGUAGES = "lyrics,all";

/** How one download is asked for. */
export interface DownloadArgsOptions {
  /** Validated page address. */
  url: string;
  /** Whether a playable video or an audio file is wanted. */
  kind: MediaKind;
  /** Absolute directory yt-dlp writes into; the caller owns it. */
  workDir: string;
  /** Early byte ceiling passed to `--max-filesize`. */
  maxBytes: number;
  /** Format chosen in the picker; omitted means "best available". */
  formatId?: string;
  /** Path of the `0600` cookie file, when a cookie login is used. */
  cookieFile?: string;
  /** Browser name for `--cookies-from-browser`, when the desktop method is used. */
  cookiesFromBrowser?: string;
  /** Directory of the FFmpeg binary, when `FFMPEG_PATH` names one. */
  ffmpegLocation?: string;
}

/** How one probe is asked for. */
export interface ProbeArgsOptions {
  /** Validated page address. */
  url: string;
  /** Absolute temporary directory; the probe removes it afterwards. */
  workDir: string;
  /** See {@link DownloadArgsOptions.cookieFile}. */
  cookieFile?: string;
  /** See {@link DownloadArgsOptions.cookiesFromBrowser}. */
  cookiesFromBrowser?: string;
  /** See {@link DownloadArgsOptions.ffmpegLocation}. */
  ffmpegLocation?: string;
}

/** Builds the full argument list for one download. */
export function buildDownloadArgs(options: DownloadArgsOptions): string[] {
  const isVideo = options.kind === "video";
  const args = [
    // A user's global config must not change what the server runs.
    "--ignore-config",
    "--no-playlist",
    "--no-warnings",
    // Progress is what the importing client draws its bar from.
    // `--dump-single-json` implies quiet mode, where yt-dlp would hide the
    // progress bar, so `--progress` is required to get it back; `--newline`
    // emits one line per update, and the template makes each line readable
    // instead of the human-formatted bar. Both progress and JSON share stdout,
    // and the adapter parses them apart.
    "--progress",
    "--newline",
    "--progress-template",
    PROGRESS_TEMPLATE,
    // Print the metadata *and* download; the default would only simulate.
    "--no-simulate",
    "--dump-single-json",
    // Fixed server policy, not a user setting.
    "--concurrent-fragments",
    String(CONCURRENT_FRAGMENTS),
    "-o",
    join(options.workDir, "source.%(ext)s"),
  ];

  if (isVideo) {
    // Sites serve VP9/Opus streams that an MP4 container cannot hold, so let
    // yt-dlp fall back to Matroska. Both are the video storage category.
    args.push("--merge-output-format", "mp4/mkv");
    // `+ba/b` pairs the chosen picture with the best audio, and `b` is the
    // fallback when the site offers only a combined stream.
    args.push("-f", `${options.formatId ?? "bv*"}+ba/b`);
  } else {
    // A music site normally offers an audio-only format. The fallback keeps an
    // import working when the requested format disappears between probe and
    // download.
    args.push(
      "-f",
      options.formatId
        ? `${options.formatId}/bestaudio/best`
        : "bestaudio/best",
    );
  }

  args.push(
    "--max-filesize",
    String(options.maxBytes),
    "--no-exec",
    "--no-mtime",
  );

  if (isVideo) {
    args.push(
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      VIDEO_SUBTITLE_LANGUAGES,
    );
  } else {
    args.push("--write-subs", "--sub-langs", AUDIO_SUBTITLE_LANGUAGES);
  }
  args.push("--sub-format", "vtt", "--convert-subs", "vtt");

  args.push("--write-thumbnail", "--convert-thumbnails", "jpg");

  if (options.ffmpegLocation) {
    args.push("--ffmpeg-location", options.ffmpegLocation);
  }
  appendCookieArgs(args, options.cookieFile, options.cookiesFromBrowser);

  // `--` ends the option list: a pasted URL can never be read as a flag.
  args.push("--", options.url);
  return args;
}

/**
 * Builds the full argument list for one probe.
 *
 * `-J` prints the metadata and downloads nothing; `--write-thumbnail` is the
 * exception, because the picker needs the cover image and the server must not
 * fetch an arbitrary image address itself.
 *
 * `--no-simulate` is load-bearing here: `-J` implies simulation, and a simulated
 * run writes no thumbnail at all. `--skip-download` keeps the media itself off
 * the network while the thumbnail is still written.
 */
export function buildProbeArgs(options: ProbeArgsOptions): string[] {
  const args = [
    "--ignore-config",
    "--no-playlist",
    "--no-warnings",
    "-J",
    // `-J` is a simulated run, which would silently skip the thumbnail write.
    "--no-simulate",
    "--skip-download",
    "--write-thumbnail",
    "--convert-thumbnails",
    "jpg",
    "--no-exec",
    "--no-mtime",
    "-o",
    join(options.workDir, "source.%(ext)s"),
  ];

  if (options.ffmpegLocation) {
    args.push("--ffmpeg-location", options.ffmpegLocation);
  }
  appendCookieArgs(args, options.cookieFile, options.cookiesFromBrowser);

  args.push("--", options.url);
  return args;
}

/**
 * Reads `FFMPEG_PATH` and returns its directory.
 *
 * yt-dlp is asked to use the same FFmpeg the rest of the server uses, which
 * matters for the merge and the thumbnail conversion. An unset variable leaves
 * the choice to yt-dlp's own lookup.
 */
export function ffmpegLocationFromEnvironment(): string | undefined {
  const ffmpegPath = process.env.FFMPEG_PATH;
  return ffmpegPath ? dirname(ffmpegPath) : undefined;
}

/**
 * Appends the one cookie option in use.
 *
 * The browser method wins when both are present: it keeps the plaintext cookie
 * out of the process, which is the stronger of the two guarantees.
 */
function appendCookieArgs(
  args: string[],
  cookieFile: string | undefined,
  cookiesFromBrowser: string | undefined,
): void {
  if (cookiesFromBrowser) {
    args.push("--cookies-from-browser", cookiesFromBrowser);
    return;
  }
  if (cookieFile) args.push("--cookies", cookieFile);
}
