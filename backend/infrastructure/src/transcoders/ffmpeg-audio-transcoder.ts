// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Audio container compatibility adapter (ffmpeg spawned as a child process).
 *
 * A music site can answer with a container the browser does not play. The audio
 * node has no HLS fallback: it feeds the stored file to a plain `<audio>`
 * element, so an unplayable container would leave the node silent. This adapter
 * therefore has one decision to make and one effect to run:
 *
 * - a whitelisted container is already playable, so the file is returned
 *   untouched and no temporary state is created;
 * - anything else is re-encoded to AAC in an `.m4a` container, which every
 *   browser plays. The source is never modified and stays the caller's file; the
 *   encoded copy lives in a private temporary directory that `cleanup` removes.
 *
 * The re-encode is deliberately one fixed quality (192 kbps stereo AAC): the
 * source already had a lossy bitrate chosen by the site, and a per-import
 * quality control would imply a precision the import does not offer.
 *
 * `ffmpeg` comes from `FFMPEG_PATH` when set, otherwise from `PATH`. The
 * constructor takes an explicit path so a test can point at a fake script.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { EventEmitter } from "node:events";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import type {
  AudioConversionRequest,
  AudioConversionResult,
  IAudioTranscoder,
} from "@workspace/domain";
import { MediaImportFailure } from "@workspace/utils/media-import";

/** Command used when neither the constructor nor the environment names one. */
const DEFAULT_FFMPEG = "ffmpeg";

/** A conversion of a large track can take a while, but must not run forever. */
const CONVERSION_TIMEOUT_MS = 10 * 60 * 1000;

/** AAC bitrate of the produced file, in kbps. */
const AUDIO_BITRATE = "192k";

/** Output MIME type of the converted container. */
const CONVERTED_CONTENT_TYPE = "audio/mp4";

/** Output extension of the converted container. */
const CONVERTED_EXTENSION = ".m4a";

/** Containers an `<audio>` element plays everywhere, with their MIME types. */
const PLAYABLE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  weba: "audio/webm",
};

/** Minimal port of `ffmpeg` that makes a downloaded audio file playable. */
export class FfmpegAudioTranscoder implements IAudioTranscoder {
  private readonly ffmpegPath: string;

  /** Every running conversion, so a shutting-down process leaves no child. */
  private readonly active = new Set<ChildProcess>();

  /**
   * `ffmpegPath` exists for tests and for a bundled binary; in production it
   * stays `FFMPEG_PATH || "ffmpeg"`.
   */
  constructor(ffmpegPath: string = process.env.FFMPEG_PATH || DEFAULT_FFMPEG) {
    this.ffmpegPath = ffmpegPath;
    process.once("exit", () => {
      for (const child of this.active) child.kill("SIGKILL");
    });
  }

  async ensurePlayable(
    request: AudioConversionRequest,
  ): Promise<AudioConversionResult> {
    const extension = extname(request.fileName)
      .replace(/^\./, "")
      .toLowerCase();
    const playableType = PLAYABLE_CONTENT_TYPES[extension];

    if (playableType) {
      return {
        path: request.path,
        fileName: request.fileName,
        contentType: playableType,
        converted: false,
        cleanup: async () => undefined,
      };
    }

    const workDir = await mkdtemp(join(tmpdir(), "dbrain-audio-convert-"));
    let removed = false;
    const cleanup = async (): Promise<void> => {
      if (removed) return;
      removed = true;
      await rm(workDir, { recursive: true, force: true });
    };

    try {
      const fileName = convertedFileName(request.fileName);
      const outputPath = join(workDir, fileName);

      await this.run(this.buildArgs(request.path, outputPath));

      const size = (await stat(outputPath)).size;
      if (size <= 0) {
        throw new MediaImportFailure(
          "conversion_failed",
          "FFmpeg produced an empty audio file",
        );
      }
      if (size > request.maxBytes) {
        throw new MediaImportFailure(
          "conversion_failed",
          `The converted audio is ${size} bytes; the limit is ${request.maxBytes} bytes`,
        );
      }

      return {
        path: outputPath,
        fileName,
        contentType: CONVERTED_CONTENT_TYPE,
        converted: true,
        cleanup,
      };
    } catch (error) {
      // The caller never sees a path of a failed conversion, so this is the
      // only chance to remove its temporary directory.
      await cleanup().catch(() => undefined);
      throw error;
    }
  }

  /** ffmpeg command line: drop the picture, encode stereo AAC 192k, fast start. */
  private buildArgs(inputPath: string, outputPath: string): string[] {
    return [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      inputPath,
      // A music site may hand back a file with a picture; the node only needs
      // the audio stream.
      "-vn",
      "-c:a",
      "aac",
      "-b:a",
      AUDIO_BITRATE,
      "-ac",
      "2",
      // Put the index at the front so a seek does not wait for the file to
      // finish downloading in the browser.
      "-movflags",
      "+faststart",
      outputPath,
    ];
  }

  /** Runs one ffmpeg conversion; rejects with a classified failure. */
  private run(args: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let stderrTail = "";

      const child = spawn(this.ffmpegPath, args, {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      this.active.add(child);

      const timers: { kill?: NodeJS.Timeout } = {};

      const finish = (failure?: MediaImportFailure): void => {
        if (settled) return;
        settled = true;
        if (timers.kill) clearTimeout(timers.kill);
        this.active.delete(child);
        if (failure) reject(failure);
        else resolve();
      };

      // Some workspace packages typecheck this file with more than one copy of
      // `@types/node`, and in that view `ChildProcess` loses the members it
      // inherits from `EventEmitter`. The runtime object is an emitter, so this
      // exact cast keeps the listener typed without changing behavior.
      const events = child as unknown as EventEmitter;

      events.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          finish(
            new MediaImportFailure(
              "unknown",
              `${this.ffmpegPath} is not available on the server; install ffmpeg or point FFMPEG_PATH at it`,
            ),
          );
          return;
        }
        finish(
          new MediaImportFailure(
            "conversion_failed",
            `FFmpeg could not be started: ${error.message}`,
          ),
        );
      });

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-8 * 1024);
      });

      events.on("close", (code: number | null) => {
        if (settled) return;
        if (code === 0) {
          finish();
          return;
        }
        const detail = stderrTail
          .replace(/\r\n?/g, "\n")
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "")
          .slice(-6)
          .join("\n");
        finish(
          new MediaImportFailure(
            "conversion_failed",
            detail === ""
              ? "FFmpeg could not convert the audio file"
              : `FFmpeg could not convert the audio file: ${detail}`,
          ),
        );
      });

      timers.kill = setTimeout(() => {
        if (settled) return;
        // Hard kill: a stuck conversion must not hold the import forever.
        child.kill("SIGKILL");
        finish(
          new MediaImportFailure(
            "conversion_failed",
            `Audio conversion timed out after ${Math.round(
              CONVERSION_TIMEOUT_MS / 60_000,
            )} minutes`,
          ),
        );
      }, CONVERSION_TIMEOUT_MS);
      timers.kill.unref();
    });
  }
}

/**
 * Keeps the caller's name stem and replaces only the extension.
 *
 * The caller already sanitized the name, so the stem is used as given. A name
 * without a stem falls back to `audio`, which the audio naming rule would also
 * have produced.
 */
function convertedFileName(fileName: string): string {
  const stem = fileName.slice(0, fileName.length - extname(fileName).length);
  return `${stem || "audio"}${CONVERTED_EXTENSION}`;
}
