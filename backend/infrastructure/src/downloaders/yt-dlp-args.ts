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
 *   simply writes no file, which is not an error. A track that is not a caption
 *   of the media is excluded by name, because converting some of them fails and
 *   would abort the whole download; see {@link captionLanguages}.
 * - A video stream the HLS packager can copy (H.264) is preferred over one it
 *   would have to re-encode; see {@link buildDownloadArgs}.
 * - A cookie is passed by file path (`--cookies`) or by browser name
 *   (`--cookies-from-browser`), never as text in argv.
 */

import { dirname, join } from "node:path";

import type { MediaKind } from "@workspace/interfaces";

import { NON_CAPTION_SUBTITLE_LANGUAGES } from "./yt-dlp-subtitles.ts";

/** Fixed fragment concurrency; the site is asked for at most four at once. */
export const CONCURRENT_FRAGMENTS = 4;

/**
 * Progress template. It prints `download:<downloaded>/<total>/<speed>/<eta>`,
 * one line per update with `--newline`; `NA` marks a value the site omits.
 */
export const PROGRESS_TEMPLATE =
  "download:%(progress.downloaded_bytes)s/%(progress.total_bytes)s/%(progress.speed)s/%(progress.eta)s";

/** Video subtitle selection: every language the site offers as captions. */
const VIDEO_SUBTITLE_LANGUAGES = captionLanguages("all");

/** Audio subtitle selection: the lyrics track, then every caption track. */
const AUDIO_SUBTITLE_LANGUAGES = captionLanguages("lyrics", "all");

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
  /** Whether the address is read as a video or as an audio track. */
  kind: MediaKind;
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
    // The HLS packager copies an H.264 stream into MPEG-TS and must re-encode
    // every other codec, which costs minutes for a full-length video. yt-dlp's
    // default sort prefers AV1, so the codec preference is stated here; the
    // resolution still wins, because `-S` only orders the codecs of one
    // resolution. The picker applies the same rule (`videoQualities`).
    args.push("-S", "vcodec:h264");
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
 *
 * The subtitle flags are load-bearing for the same reason on a different site:
 * yt-dlp's own extractor only asks the site for its subtitle tracks when a
 * download would write them. A Bilibili or TikTok probe without `--write-subs`
 * therefore reports no tracks at all, and the picker can never tell the user a
 * subtitle will come with the media. `--skip-download` still keeps every track
 * off the disk; only the track list appears in the JSON.
 */
export function buildProbeArgs(options: ProbeArgsOptions): string[] {
  const isVideo = options.kind === "video";
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

  // The same selection a download asks for, so the list the picker shows is the
  // list the import would actually fetch.
  args.push("--write-subs");
  if (isVideo) args.push("--write-auto-subs");
  args.push(
    "--sub-langs",
    isVideo ? VIDEO_SUBTITLE_LANGUAGES : AUDIO_SUBTITLE_LANGUAGES,
  );

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
 * Builds the `--sub-langs` value: the requested picks, then one exclusion per
 * track that is not a caption.
 *
 * `danmaku` has to be excluded here, not later: yt-dlp downloads it as an
 * `xml` file and `--convert-subs vtt` then fails, which turns a successful
 * media download into a failed import. `live_chat` is a chat replay, never
 * captions of the media.
 */
function captionLanguages(...wanted: string[]): string {
  const excluded = NON_CAPTION_SUBTITLE_LANGUAGES.map(
    (language) => `-${language}`,
  );
  return [...wanted, ...excluded].join(",");
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
