/**
 * Reads what a site offers for one address, without storing anything.
 *
 * The import dialog is built from this answer: the title and cover it shows,
 * the subtitle languages it lists, and the quality chips the user picks from.
 * The chosen chip's `formatId` is later copied into the download request, so the
 * client never supplies a raw yt-dlp argument.
 *
 * Three rules shape the implementation:
 *
 * - **A probe writes nothing outside its own temporary directory.** The
 *   directory is created per call and removed on every path, including a
 *   failure. A refused address is rejected before the directory exists.
 * - **The cover image comes from the file yt-dlp wrote, never from its URL.**
 *   Fetching an arbitrary image address would add a second server-side request
 *   surface for the sake of a thumbnail. Only the file is read, and only when
 *   it is at most 512 KB.
 * - **A login refusal is a classified rejection.** yt-dlp reports that the site
 *   wants a login as an error, and this adapter rethrows it as
 *   `login_required`; the application layer decides whether to show it as a
 *   login prompt or as a softer "sign in for more" hint. The `requiresLogin`
 *   field of a successful result is therefore false: a page that answered
 *   anonymously did not refuse.
 */

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  IMediaProbe,
  MediaProbeRequest,
  MediaProbeResult,
} from "@workspace/domain";

import { findThumbnail, shrinkThumbnail } from "./media-file.ts";
import { audioQualities, videoQualities } from "./media-quality.ts";
import { StaticMediaSiteCatalog } from "./media-sites.ts";
import {
  buildProbeArgs,
  ffmpegLocationFromEnvironment,
} from "./yt-dlp-args.ts";
import { removeCookieFile, writeCookieFile } from "./yt-dlp-cookie.ts";
import { parseYtDlpMetadata } from "./yt-dlp-metadata.ts";
import { PROBE_TIMEOUT_MS, startYtDlp } from "./yt-dlp-process.ts";
import { subtitleLanguages } from "./yt-dlp-subtitles.ts";
import { assertDownloadableUrl } from "./yt-dlp-url.ts";

/** Command used when neither the constructor nor the environment names one. */
const DEFAULT_YT_DLP = "yt-dlp";

/** The picker never receives a cover larger than this. */
const MAX_THUMBNAIL_BYTES = 512 * 1024;

/** Timeout failure message, worded once. */
const TIMEOUT_MESSAGE = `Reading the media page timed out after ${Math.round(
  PROBE_TIMEOUT_MS / 1000,
)} seconds`;

/**
 * The catalog is static configuration, so reading it here does not need a
 * constructor argument: the probe only needs to name the site of an address it
 * is already fetching.
 */
const SITES = new StaticMediaSiteCatalog();

/** Reads a site's offer for one address. */
export class YtDlpMediaProbe implements IMediaProbe {
  private readonly command: string;

  /**
   * `command` exists for tests and for an operator whose binary lives outside
   * `PATH`; in production it stays `YT_DLP_PATH || "yt-dlp"`.
   */
  constructor(command: string = process.env.YT_DLP_PATH || DEFAULT_YT_DLP) {
    this.command = command;
  }

  async probe(request: MediaProbeRequest): Promise<MediaProbeResult> {
    // Validation runs before the temporary directory exists: a refused
    // address must not leave anything behind.
    const url = await assertDownloadableUrl(request.url);
    const workDir = await mkdtemp(join(tmpdir(), "dbrain-yt-dlp-probe-"));

    const useBrowser = Boolean(request.cookiesFromBrowser?.trim());
    const cookieText = request.cookies?.trim();
    let cookieFile: string | undefined;

    try {
      if (!useBrowser && cookieText) {
        cookieFile = await writeCookieFile(workDir, request.cookies ?? "");
      }

      const run = startYtDlp({
        command: this.command,
        args: buildProbeArgs({
          url: url.href,
          kind: request.kind,
          workDir,
          cookieFile,
          cookiesFromBrowser: request.cookiesFromBrowser,
          ffmpegLocation: ffmpegLocationFromEnvironment(),
        }),
        timeoutMs: PROBE_TIMEOUT_MS,
        timeoutMessage: TIMEOUT_MESSAGE,
        action: "probe",
      });

      const stdout = await run.done;
      const metadata = parseYtDlpMetadata(stdout);
      const qualityOptions =
        request.kind === "video"
          ? videoQualities(metadata.formats, { duration: metadata.duration })
          : audioQualities(metadata.formats, { duration: metadata.duration });

      return {
        kind: request.kind,
        siteKey: SITES.match(url.href)?.key ?? null,
        extractorKey: metadata.extractorKey,
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        duration: metadata.duration,
        thumbnailDataUrl: await readThumbnailDataUrl(workDir),
        // See the class comment: a refusal is a `login_required` rejection, so
        // a result that exists was never refused.
        requiresLogin: false,
        subtitleLanguages: subtitleLanguages(metadata, request.kind),
        qualities: qualityOptions,
      };
    } finally {
      await removeCookieFile(cookieFile).catch(() => undefined);
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

/**
 * Reads the thumbnail yt-dlp wrote as a data URL, or `null` when there is none
 * or it cannot be made small enough. The image address is never fetched.
 *
 * A site cover is frequently a 1920px JPEG above the cap; that file is shrunk
 * once through FFmpeg instead of dropping the cover, because the dialog shows a
 * small card and a missing cover makes the parse result look broken.
 */
async function readThumbnailDataUrl(workDir: string): Promise<string | null> {
  const written = await findThumbnail(workDir);
  if (!written) return null;

  try {
    const info = await stat(written.path);
    if (!info.isFile() || info.size === 0) return null;

    let thumbnail = written;
    if (info.size > MAX_THUMBNAIL_BYTES) {
      const shrunk = await shrinkThumbnail(written, workDir);
      if (!shrunk) return null;
      thumbnail = shrunk;
    }

    const bytes = await readFile(thumbnail.path);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_THUMBNAIL_BYTES) {
      return null;
    }
    return `data:${thumbnail.contentType};base64,${bytes.toString("base64")}`;
  } catch {
    // A cover is a bonus; a failed read must not fail the probe.
    return null;
  }
}
