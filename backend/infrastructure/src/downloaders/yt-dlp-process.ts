// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Spawns yt-dlp and reports its progress.
 *
 * Both the download and the probe run yt-dlp as a child process. The rules they
 * share live here:
 *
 * - **The process is capped in time.** A site that never finishes must not hold
 *   a server slot forever, so the child is killed hard (`SIGKILL`) at the
 *   timeout; a shutdown signal is too polite for a stuck network read.
 * - **Cancellation is two stage.** The caller's cancel asks politely
 *   (`SIGTERM`) and kills after a short grace period, so yt-dlp can flush its
 *   partial file, which is what makes a resumed job resume.
 * - **Progress is line based.** The progress template prints one line per
 *   update, and a network chunk can split a line, so lines are reassembled
 *   before they are parsed. Updates are throttled: the client draws a bar, not
 *   a packet trace, and every update is forwarded over a WebSocket.
 * - **Only metadata is buffered.** `--dump-single-json` can be several
 *   megabytes; that text is held for the one run. The media itself is written
 *   by yt-dlp to disk and never passes through this process.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { EventEmitter } from "node:events";

import type {
  MediaDownloadProgress,
  MediaDownloadProgressListener,
} from "@workspace/domain";
import { MediaImportFailure } from "@workspace/utils/media-import";

import { classifyYtDlpFailure, missingBinaryFailure } from "./yt-dlp-error.ts";

/** A video can take a long time to download; cap it well above that. */
export const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

/** Reading a page's format table is quick; a slow site is a failed probe. */
export const PROBE_TIMEOUT_MS = 45 * 1000;

/** Time between `SIGTERM` and `SIGKILL` when the user cancels. */
const CANCEL_GRACE_MS = 2_000;

/**
 * Room for `--dump-single-json`: a busy site reports every available format,
 * and the JSON can run into several megabytes.
 */
const MAX_STDOUT_BYTES = 64 * 1024 * 1024;

/** Only the tail of stderr is useful, so only the tail is kept. */
const MAX_STDERR_BYTES = 16 * 1024;

/**
 * Prefix of the machine-readable progress line requested with
 * `--progress-template`. The template prints
 * `download:<downloaded>/<total>/<speed>/<eta>`, with `NA` for a value the site
 * does not report, so one pattern reads it.
 */
const PROGRESS_LINE =
  /^download:([\d.]+)\/([\d.]+|NA)\/([\d.]+|NA)\/([\d.]+|NA)/;

/** Minimum gap between two progress callbacks. */
const PROGRESS_INTERVAL_MS = 250;

/** One yt-dlp process, as the caller can control it. */
export interface YtDlpRun {
  /** Resolves with stdout on a zero exit; rejects with a classified failure. */
  readonly done: Promise<string>;
  /** Stops the process: `SIGTERM` now, `SIGKILL` after the grace period. */
  cancel(): void;
}

/** How to start one yt-dlp run. */
export interface YtDlpRunOptions {
  /** Binary to execute; production uses `YT_DLP_PATH || "yt-dlp"`. */
  command: string;
  /** Full argument list, including the final `-- <url>`. */
  args: string[];
  /** Hard time cap for this run. */
  timeoutMs: number;
  /** Message for the `timeout` failure, e.g. "the download timed out …". */
  timeoutMessage: string;
  /** What the run is for; only shapes a failure's message. */
  action?: "download" | "probe";
  /** Receives throttled progress updates while the download advances. */
  onProgress?: MediaDownloadProgressListener;
}

/** Starts one yt-dlp run and returns its handle without waiting. */
export function startYtDlp(options: YtDlpRunOptions): YtDlpRun {
  const { command, args, timeoutMs, timeoutMessage, action, onProgress } =
    options;

  let settled = false;
  let cancelled = false;
  let timedOut = false;
  const stdoutChunks: string[] = [];
  let stdoutBytes = 0;
  let stderrTail = "";
  let progressBuffer = "";
  let lastProgressAt = 0;
  let hardKillTimer: NodeJS.Timeout | undefined;
  let timeoutTimer: NodeJS.Timeout | undefined;

  let resolveDone!: (stdout: string) => void;
  let rejectDone!: (failure: MediaImportFailure) => void;
  const done = new Promise<string>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const finish = (failure?: MediaImportFailure): void => {
    if (settled) return;
    settled = true;
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (hardKillTimer) clearTimeout(hardKillTimer);
    timeoutTimer = undefined;
    hardKillTimer = undefined;
    if (failure) rejectDone(failure);
    else resolveDone(stdoutChunks.join(""));
  };

  const reportProgress = (line: string): void => {
    if (!onProgress) return;
    const match = PROGRESS_LINE.exec(line);
    if (!match) return;

    const now = Date.now();
    if (now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;

    const progress: MediaDownloadProgress = {
      downloadedBytes: countValue(match[1]),
      totalBytes: match[2] === "NA" ? 0 : countValue(match[2]),
      speedBytesPerSecond: match[3] === "NA" ? 0 : countValue(match[3]),
      etaSeconds: match[4] === "NA" ? 0 : countValue(match[4]),
    };
    onProgress(progress);
  };

  let child: ChildProcess;
  try {
    child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finish(
      new MediaImportFailure(
        "unknown",
        `${command} could not be started: ${message}`,
      ),
    );
    return { done, cancel: () => undefined };
  }

  // Some workspace packages typecheck this file with more than one copy of
  // `@types/node`, and in that view `ChildProcess` loses the members it
  // inherits from `EventEmitter`. The runtime object is an emitter, so this
  // exact cast keeps the listener typed without changing behavior.
  const events = child as unknown as EventEmitter;

  events.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      finish(missingBinaryFailure(command));
      return;
    }
    finish(
      new MediaImportFailure(
        "unknown",
        `${command} could not be started: ${error.message}`,
      ),
    );
  });

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdoutChunks.push(chunk);
    stdoutBytes += Buffer.byteLength(chunk, "utf8");
    if (stdoutBytes > MAX_STDOUT_BYTES) {
      child.kill("SIGKILL");
      finish(
        new MediaImportFailure(
          "unknown",
          "yt-dlp returned more metadata than the server accepts",
        ),
      );
      return;
    }

    if (!onProgress) return;
    progressBuffer += chunk;
    const lines = progressBuffer.split("\n");
    // The last piece is an incomplete line, or the start of the JSON payload.
    progressBuffer = lines.pop() ?? "";
    for (const line of lines) reportProgress(line.trim());
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-MAX_STDERR_BYTES);
  });

  events.on("close", (code: number | null) => {
    if (settled) return;
    if (cancelled) {
      finish(new MediaImportFailure("cancelled", "The import was cancelled"));
      return;
    }
    if (timedOut) {
      finish(new MediaImportFailure("timeout", timeoutMessage));
      return;
    }
    if (code === 0) {
      // A final progress line may lack its newline; the caller is done anyway.
      finish();
      return;
    }
    finish(classifyYtDlpFailure(stderrTail, { action }));
  });

  timeoutTimer = setTimeout(() => {
    if (settled) return;
    timedOut = true;
    // Hard kill: a stuck network read may ignore a polite signal.
    child.kill("SIGKILL");
    finish(new MediaImportFailure("timeout", timeoutMessage));
  }, timeoutMs);
  timeoutTimer.unref();

  return {
    done,
    cancel: () => {
      if (settled) return;
      cancelled = true;
      child.kill("SIGTERM");
      if (hardKillTimer) return;
      hardKillTimer = setTimeout(() => {
        hardKillTimer = undefined;
        if (!settled) child.kill("SIGKILL");
      }, CANCEL_GRACE_MS);
      hardKillTimer.unref();
    },
  };
}

/** Reads a byte or speed count, tolerating a decimal and `NA`. */
function countValue(value: string | undefined): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}
