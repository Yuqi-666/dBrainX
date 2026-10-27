// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What yt-dlp wrote, and what the import may call it.
 *
 * yt-dlp names its output after the one `-o` template (`source.%(ext)s`) and
 * adds side files beside it: partial files while a download runs, a thumbnail,
 * and one WebVTT file per requested language. The import needs to tell those
 * apart by name and extension alone, because that is the only signal yt-dlp
 * leaves behind.
 *
 * The stored name is built here too, and the two kinds differ on purpose:
 *
 * - A video title is attacker-influenced free text. The video name is therefore
 *   reduced to a conservative ASCII set, exactly like the previous upload path.
 * - An audio title is a song name. Reducing it to ASCII would destroy most
 *   Chinese, Japanese, and Korean titles, so the audio name keeps Unicode and
 *   only removes what a file system cannot store: path separators, control
 *   characters, and leading or trailing dots and spaces.
 *
 * The extension always comes from the file yt-dlp actually produced, never from
 * the title, because the file store and the player pick a handler by it.
 */

import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { promisify } from "node:util";

import type { MediaKind } from "@workspace/interfaces";
import type { DownloadedMediaThumbnail } from "@workspace/domain";

/** Runs FFmpeg without buffering its log into the process heap. */
const runFfmpeg = promisify(execFile);

/** Longest edge of a cover the import dialog receives, in pixels. */
const THUMBNAIL_MAX_EDGE = 640;

/** A cover shrink is a small, local job; cap it well above the time it needs. */
const THUMBNAIL_SHRINK_TIMEOUT_MS = 30_000;

/** Trailing names yt-dlp uses for partial state; never a finished artifact. */
const PARTIAL_SUFFIXES = [".part", ".ytdl", ".temp"];

/** File extensions a thumbnail conversion can produce. */
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

/** Side files that are not the media itself. */
const SIDE_EXTENSIONS = new Set([
  "vtt",
  "srt",
  "ass",
  "lrc",
  "json",
  "txt",
  "description",
  // Bilibili's danmaku track is an XML file yt-dlp writes beside the media.
  // It is excluded from the subtitle request, but a directory left by an
  // earlier failed run can still contain one.
  "xml",
]);

/** MIME type of every container the video merge step can produce. */
const VIDEO_CONTENT_TYPES: Readonly<Record<string, string>> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  ogv: "video/ogg",
  "3gp": "video/3gpp",
  ts: "video/mp2t",
};

/** MIME type of every container the audio download path can store. */
const AUDIO_CONTENT_TYPES: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  weba: "audio/webm",
  webm: "audio/webm",
};

/** MIME type of a converted thumbnail. */
const IMAGE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Extensions that are not the media file even though they start with `source.`. */
const NON_MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...SIDE_EXTENSIONS]);

/** One finished file yt-dlp wrote into a work directory. */
export interface ProducedMediaFile {
  /** Absolute path of the file. */
  path: string;
  /** Lowercase extension including the dot, e.g. `.mp4`. */
  extension: string;
}

/**
 * Finds the finished media file in a work directory.
 *
 * Only a fully written regular file counts: `source.mp4.part` is a download in
 * progress, and `source.en.vtt` or `source.jpg` are side files. The shortest
 * matching name wins, so a leftover fragment (`source.f137.mp4`) cannot shadow
 * the merged `source.mp4`.
 */
export async function findProducedMedia(
  workDir: string,
): Promise<ProducedMediaFile> {
  const names = (await readdir(workDir))
    .filter((name) => name.startsWith("source."))
    .filter((name) => !PARTIAL_SUFFIXES.some((suffix) => name.endsWith(suffix)))
    .filter((name) => !NON_MEDIA_EXTENSIONS.has(extensionOf(name)))
    .sort(
      (left, right) => left.length - right.length || left.localeCompare(right),
    );

  for (const name of names) {
    const path = join(workDir, name);
    if ((await stat(path)).isFile()) {
      return { path, extension: `.${extensionOf(name)}` };
    }
  }

  throw new Error("yt-dlp reported success but produced no media file");
}

/** Finds the thumbnail yt-dlp converted to JPEG, when it wrote one. */
export async function findThumbnail(
  workDir: string,
): Promise<DownloadedMediaThumbnail | null> {
  const names = (await readdir(workDir))
    .filter((name) => name.startsWith("source."))
    .filter((name) => !PARTIAL_SUFFIXES.some((suffix) => name.endsWith(suffix)))
    .filter((name) => IMAGE_EXTENSIONS.has(extensionOf(name)))
    // JPEG is what the argument list asks for, so it wins over a leftover
    // original in another format.
    .sort(
      (left, right) =>
        imagePreference(left) - imagePreference(right) ||
        left.length - right.length ||
        left.localeCompare(right),
    );

  for (const name of names) {
    const path = join(workDir, name);
    if (!(await stat(path)).isFile()) continue;
    return {
      path,
      contentType: IMAGE_CONTENT_TYPES[extensionOf(name)] ?? "image/jpeg",
    };
  }
  return null;
}

/**
 * Downscales a cover yt-dlp wrote to a size the dialog can carry.
 *
 * Sites often serve a 1920px JPEG that is several hundred kilobytes — larger
 * than the data URL the picker accepts — so the file is re-encoded once through
 * FFmpeg to a 640px-wide JPEG. The picker needs a thumbnail, not the original
 * cover, and the bytes travel over one WebSocket message per probe.
 *
 * Returns `null` when the image cannot be read or FFmpeg is not available: a
 * missing cover is a degraded card, never a failed probe.
 */
export async function shrinkThumbnail(
  thumbnail: DownloadedMediaThumbnail,
  workDir: string,
  options: { ffmpegPath?: string } = {},
): Promise<DownloadedMediaThumbnail | null> {
  const output = join(workDir, "cover.jpg");
  const command = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";

  try {
    await runFfmpeg(
      command,
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        thumbnail.path,
        // Keep the aspect ratio; a 640px-wide card is the largest the dialog
        // draws, so a taller image only needs its width limited.
        "-vf",
        `scale='min(${THUMBNAIL_MAX_EDGE},iw)':-2`,
        "-q:v",
        "4",
        output,
      ],
      { timeout: THUMBNAIL_SHRINK_TIMEOUT_MS, killSignal: "SIGKILL" },
    );

    const info = await stat(output);
    if (!info.isFile() || info.size === 0) return null;
    return { path: output, contentType: "image/jpeg" };
  } catch {
    return null;
  }
}

/** MIME type for a produced extension; the generic type when it is unknown. */
export function contentTypeFor(extension: string, kind: MediaKind): string {
  const key = extension.replace(/^\./, "").toLowerCase();
  const table = kind === "audio" ? AUDIO_CONTENT_TYPES : VIDEO_CONTENT_TYPES;
  return table[key] ?? "application/octet-stream";
}

/** MIME type of a thumbnail file, from its extension. */
export function imageContentType(extension: string): string {
  return (
    IMAGE_CONTENT_TYPES[extension.replace(/^\./, "").toLowerCase()] ??
    "image/jpeg"
  );
}

/**
 * Turns a video title into one safe stored name with the real extension.
 *
 * The title is attacker-influenced (anyone who can publish a page controls it),
 * so anything outside a conservative ASCII set becomes `_` rather than being
 * escaped.
 */
export function safeVideoFileName(title: string, extension: string): string {
  const stem = title
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+/, "")
    .replace(/[._-]+$/, "")
    .slice(0, 100);
  return `${stem || "video"}${extension || ".mp4"}`;
}

/**
 * Turns a song title into one safe stored name, keeping Unicode.
 *
 * File-system separators and control characters are removed rather than
 * replaced: a name is never interpreted as a path. Leading and trailing dots
 * and spaces are removed because some file systems reject them. The stem is
 * cut after cleaning, and the cleaning is repeated on the cut result so a
 * truncation cannot leave a trailing space.
 */
export function safeAudioFileName(title: string, extension: string): string {
  const stem = title
    .replace(/[/\\:*?"<>|]/g, "")
    // Control characters are not storable in a file name.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    .slice(0, 100)
    .trim()
    .replace(/[.\s]+$/, "");
  return `${stem || "audio"}${extension || ".mp3"}`;
}

/** The lowercase extension of a file name, without the dot. */
function extensionOf(name: string): string {
  return extname(name).replace(/^\./, "").toLowerCase();
}

/** Orders thumbnail candidates: jpg first, then the other image formats. */
function imagePreference(name: string): number {
  const extension = extensionOf(name);
  return extension === "jpg" || extension === "jpeg" ? 0 : 1;
}
