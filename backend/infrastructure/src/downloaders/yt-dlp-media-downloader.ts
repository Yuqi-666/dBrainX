// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Remote media download adapter (yt-dlp spawned as a child process).
 *
 * This is the one outside effect behind both import kinds. A user pastes a
 * video or music page address; the adapter turns it into a file on disk,
 * together with the metadata, cover image, and subtitle or lyric track the
 * import needs. Video and audio share it because yt-dlp already knows both; the
 * differences are the format request, the subtitle language list, and the
 * naming rule.
 *
 * Four rules shape the implementation:
 *
 * - **The result is a path, never bytes.** A video may be gigabytes, and both
 *   consumers read it from disk: the file store's streamed upload and FFmpeg.
 *   The file is written into the caller's work directory and handed over by
 *   path.
 * - **The work directory belongs to the caller.** It is the resume base: the
 *   caller passes the same directory when a job retries, and yt-dlp continues
 *   its partial file. The adapter therefore creates no new temporary directory
 *   for the media and never removes the caller's directory. `cleanup` removes
 *   only what this adapter created, which is the cookie file.
 * - **The address is validated before anything runs.** The server must not be
 *   usable to reach its own loopback, private, or link-local network.
 * - **A cookie never reaches argv or a log.** It is written to a `0600` file in
 *   the work directory, passed by path, and removed when the run ends.
 *
 * The binary is `YT_DLP_PATH` when set, otherwise `yt-dlp` from `PATH`. The
 * constructor takes an explicit command so a test can point at a fake script;
 * when `FFMPEG_PATH` is set, its directory is handed to yt-dlp with
 * `--ffmpeg-location` so the merge and the thumbnail conversion use the same
 * FFmpeg the rest of the server does.
 */

import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  DownloadedRemoteMedia,
  IMediaDownloader,
  MediaDownloadProgressListener,
  RemoteMediaDownloadRequest,
} from "@workspace/domain";
import { MediaImportFailure } from "@workspace/utils/media-import";

import {
  contentTypeFor,
  findProducedMedia,
  findThumbnail,
  safeAudioFileName,
  safeVideoFileName,
} from "./media-file.ts";
import {
  buildDownloadArgs,
  ffmpegLocationFromEnvironment,
} from "./yt-dlp-args.ts";
import { removeCookieFile, writeCookieFile } from "./yt-dlp-cookie.ts";
import { parseYtDlpMetadata } from "./yt-dlp-metadata.ts";
import {
  DOWNLOAD_TIMEOUT_MS,
  startYtDlp,
  type YtDlpRun,
} from "./yt-dlp-process.ts";
import { selectSubtitleTrack } from "./yt-dlp-subtitles.ts";
import { assertDownloadableUrl } from "./yt-dlp-url.ts";

/** Command used when neither the constructor nor the environment names one. */
const DEFAULT_YT_DLP = "yt-dlp";

/** Message of the timeout failure, worded once so both paths agree. */
const TIMEOUT_MESSAGE = `Downloading the media timed out after ${Math.round(
  DOWNLOAD_TIMEOUT_MS / 60_000,
)} minutes`;

/** Downloads one remote media page into the caller's work directory. */
export class YtDlpMediaDownloader implements IMediaDownloader {
  private readonly command: string;

  /**
   * The running process of each work directory, so `cancel` can find it.
   *
   * Keyed by the resolved directory: this is the same value the application
   * layer stores with the job, which is what it passes to `cancel`.
   */
  private readonly active = new Map<string, YtDlpRun>();

  /**
   * `command` exists for tests and for an operator whose binary lives outside
   * `PATH`; in production it stays `YT_DLP_PATH || "yt-dlp"`.
   */
  constructor(command: string = process.env.YT_DLP_PATH || DEFAULT_YT_DLP) {
    this.command = command;
  }

  async download(
    request: RemoteMediaDownloadRequest,
    onProgress?: MediaDownloadProgressListener,
  ): Promise<DownloadedRemoteMedia> {
    // Validation runs before the work directory is touched: a refused address
    // must not leave anything behind.
    const url = await assertDownloadableUrl(request.url);

    const workDir = resolve(request.workDir);
    await mkdir(workDir, { recursive: true });

    // The browser method is preferred when both are offered: it keeps the
    // plaintext cookie out of a file entirely.
    const useBrowser = Boolean(request.cookiesFromBrowser?.trim());
    const cookieText = request.cookies?.trim();

    let cookieFile: string | undefined;
    let run: YtDlpRun | undefined;
    try {
      if (!useBrowser && cookieText) {
        cookieFile = await writeCookieFile(workDir, request.cookies ?? "");
      }

      run = startYtDlp({
        command: this.command,
        args: buildDownloadArgs({
          url: url.href,
          kind: request.kind,
          workDir,
          maxBytes: request.maxBytes,
          formatId: request.formatId,
          cookieFile,
          cookiesFromBrowser: request.cookiesFromBrowser,
          ffmpegLocation: ffmpegLocationFromEnvironment(),
        }),
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        timeoutMessage: TIMEOUT_MESSAGE,
        action: "download",
        onProgress,
      });
      this.active.set(workDir, run);

      const stdout = await run.done;
      const metadata = parseYtDlpMetadata(stdout);
      const produced = await findProducedMedia(workDir);
      const fileSize = (await stat(produced.path)).size;

      if (fileSize <= 0) {
        throw new MediaImportFailure(
          "no_media",
          "yt-dlp produced an empty media file",
        );
      }
      if (fileSize > request.maxBytes) {
        throw new MediaImportFailure(
          "size_limit",
          `The media file is ${fileSize} bytes; the limit is ${request.maxBytes} bytes`,
        );
      }

      const fileName =
        request.kind === "audio"
          ? safeAudioFileName(
              metadata.track || metadata.title,
              produced.extension,
            )
          : safeVideoFileName(metadata.title, produced.extension);

      const thumbnail = await findThumbnail(workDir);
      const subtitle = await selectSubtitleTrack(
        metadata,
        workDir,
        request.kind,
      );

      let cleaned = false;
      const cleanup = async (): Promise<void> => {
        if (cleaned) return;
        cleaned = true;
        await removeCookieFile(cookieFile);
      };

      return {
        path: produced.path,
        fileName,
        contentType: contentTypeFor(produced.extension, request.kind),
        kind: request.kind,
        extractorKey: metadata.extractorKey,
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        duration: metadata.duration,
        fileSize,
        sourceUrl: metadata.webpageUrl || request.url,
        thumbnail,
        subtitle,
        cleanup,
      };
    } catch (error) {
      // The caller never sees a path of a failed download, so this is the only
      // chance to remove the cookie file.
      await removeCookieFile(cookieFile).catch(() => undefined);
      throw error;
    } finally {
      if (run) this.active.delete(workDir);
      // The process has ended, so the cookie file has served its purpose.
      await removeCookieFile(cookieFile).catch(() => undefined);
    }
  }

  async cancel(workDir: string): Promise<void> {
    this.active.get(resolve(workDir))?.cancel();
  }
}
