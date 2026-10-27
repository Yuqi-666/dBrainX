// SPDX-License-Identifier: AGPL-3.0-only

import { execFile, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import type {
  DocumentCover,
  HlsTranscodeResult,
  HlsTranscodeSource,
  IVideoTranscoder,
  TranscodedArtifact,
  VideoTranscodeProgressListener,
} from "@workspace/domain";

/**
 * HLS packaging adapter (ffmpeg + ffprobe, spawned as child processes).
 *
 * Runs on the server for the same reason the PDF analyzer does: the browser
 * cannot decode the codec it is being handed (an HEVC upload plays its audio
 * track and nothing else), so the re-encode has to happen somewhere that has a
 * real decoder — and a phone-sized upload must not stall the UI thread either.
 *
 * Two streams are handled differently on purpose:
 *
 * - a stream browsers already decode (H.264 video, AAC/MP3 audio) is **copied**,
 *   so re-packaging an H.264 upload costs a second and no quality;
 * - anything else (HEVC/H.265, MPEG-4 part 2, …) is **re-encoded** with
 *   `libx264`, which every browser decodes.
 *
 * Output is segmented MPEG-TS HLS (`-hls_segment_type mpegts`), the one HLS
 * flavour hls.js transmuxes everywhere. The playlist refers to its segments by
 * bare file name; the application layer rewrites those to stored paths once the
 * segments have been uploaded.
 *
 * `ffmpeg`/`ffprobe` are taken from `PATH` and can be overridden with
 * `FFMPEG_PATH` / `FFPROBE_PATH` (a bundled binary, a different install).
 */

/** Binaries, resolved per call so a test can point them elsewhere. */
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

/** Segment length. 4s keeps seeking responsive without flooding the store. */
const HLS_SEGMENT_SECONDS = 4;
/** Cap on the produced width; never upscales a smaller source. */
const MAX_OUTPUT_WIDTH = 1920;
/** x264 quality/speed. `veryfast` is the usual trade-off for on-demand work. */
const X264_PRESET = "veryfast";
const X264_CRF = 23;
const AUDIO_BITRATE = "128k";
/** Longest cover edge, matching the PDF analyzer's cover. */
const COVER_WIDTH = 1280;

/**
 * Video codecs that can go into an MPEG-TS segment *and* be decoded by every
 * browser. HEVC is deliberately absent: it is the codec this adapter exists to
 * transcode away from.
 */
const COPYABLE_VIDEO_CODECS = new Set(["h264"]);
/** Audio codecs every browser decodes inside HLS. */
const COPYABLE_AUDIO_CODECS = new Set(["aac", "mp3"]);

const PLAYLIST_CONTENT_TYPE = "application/vnd.apple.mpegurl";
const SEGMENT_CONTENT_TYPE = "video/mp2t";
const COVER_CONTENT_TYPE = "image/jpeg";

/** One stream from `ffprobe -show_streams`. */
interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  side_data_list?: { side_data_type?: string; rotation?: number }[];
}

interface ProbeResult {
  streams?: ProbeStream[];
  format?: { duration?: string };
}

/**
 * Runs a child process and resolves with its stdout.
 *
 * Spawns without a shell (arguments are passed through verbatim, so a file name
 * cannot become part of a command line) and surfaces the tail of stderr, which
 * is where ffmpeg explains why it refused a file.
 */
const activeProcesses = new Set<ChildProcess>();
process.once("exit", () => {
  for (const child of activeProcesses) child.kill("SIGKILL");
});

function runProcess(
  file: string,
  args: string[],
  label: string,
  onStdoutLine?: (line: string) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        activeProcesses.delete(child);
        if (!error) {
          resolve(stdout);
          return;
        }

        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          reject(
            new Error(
              `${file} is not available on the server; install ffmpeg or point FFMPEG_PATH/FFPROBE_PATH at it`,
            ),
          );
          return;
        }

        const detail = (stderr || error.message)
          .trim()
          .split("\n")
          .slice(-8)
          .join("\n");
        reject(new Error(`${label} failed: ${detail}`));
      },
    );
    activeProcesses.add(child);

    if (!onStdoutLine) return;
    // `-progress pipe:1` writes key=value blocks to stdout. The stream is
    // tapped while `execFile` keeps collecting the same output for its callback,
    // and lines are reassembled because a chunk boundary can split one.
    let buffered = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) onStdoutLine(line.trim());
    });
  });
}

/** Machine-readable ffmpeg progress fields this adapter reads. */
const OUT_TIME_MICROSECONDS = /^out_time_(?:us|ms)=(\d+)$/;
/** ffmpeg reports progress about twice a second; forward at most that often. */
const PROGRESS_INTERVAL_MS = 250;

/** Rounds up to an even number; x264 requires even dimensions. */
function toEven(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * Builds the artifact name prefix from the stored (already sanitized-on-upload)
 * file name.
 *
 * The name is used both for the files ffmpeg writes and for the names uploaded
 * to the store, and it ends up inside a playlist — so anything outside a
 * conservative ASCII set is replaced rather than escaped.
 */
function artifactBaseName(fileName: string): string {
  const stem = fileName.replace(/\.[^./\\]+$/, "") || "video";
  const safe = stem.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^[.]+/, "");
  // Keep the tail: PocketBase appends its own random suffix there.
  return (safe || "video").slice(-80);
}

/**
 * Extension of the uploaded file, when it is one ffmpeg can be trusted with.
 *
 * Only a short alphanumeric extension is carried over; anything else (or none)
 * leaves ffmpeg to probe the content on its own.
 */
function sourceExtension(fileName: string): string {
  const extension = extname(fileName);
  return /^\.[A-Za-z0-9]{1,5}$/.test(extension) ? extension : "";
}

/** Reads a stream's rotation in degrees, `0` when the file declares none. */
function readRotation(stream: ProbeStream): number {
  const rotation = stream.side_data_list?.find(
    (data) => typeof data.rotation === "number" && data.rotation !== 0,
  )?.rotation;

  return typeof rotation === "number" ? rotation : 0;
}

/**
 * Dimensions of the source video as it is meant to be displayed.
 *
 * Autorotation is applied by ffmpeg before any `-vf` filter, so the numbers are
 * taken in display orientation: a portrait phone clip is 1080×1920, not
 * 1920×1080.
 */
function displayDimensions(
  video: ProbeStream,
  rotation: number,
): { width: number; height: number } {
  const sourceWidth = video.width ?? 0;
  const sourceHeight = video.height ?? 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: 0, height: 0 };
  }

  const quarterTurn = Math.abs(rotation) % 180 === 90;

  return {
    width: quarterTurn ? sourceHeight : sourceWidth,
    height: quarterTurn ? sourceWidth : sourceHeight,
  };
}

/** Shrinks a size toward {@link MAX_OUTPUT_WIDTH}; never scales a small one up. */
function capWidth(size: { width: number; height: number }): {
  width: number;
  height: number;
} {
  if (size.width <= MAX_OUTPUT_WIDTH) {
    return { width: toEven(size.width), height: toEven(size.height) };
  }

  const scale = MAX_OUTPUT_WIDTH / size.width;
  return {
    width: toEven(size.width * scale),
    height: toEven(size.height * scale),
  };
}

export class FfmpegVideoTranscoder implements IVideoTranscoder {
  async transcodeToHls(
    source: HlsTranscodeSource,
    onProgress?: VideoTranscodeProgressListener,
  ): Promise<HlsTranscodeResult> {
    const workDir = await mkdtemp(join(tmpdir(), "dbrainx-hls-"));
    const baseName = artifactBaseName(source.fileName);

    try {
      // Kept under its own extension: ffprobe probes by content, but some
      // demuxers are only picked by extension, and the temporary directory is
      // private to this call.
      //
      // A `source.path` is already a file on this machine (the upload path
      // downloads it there so a 2 GiB video never enters the heap), so it is
      // read in place. Copying it into the working directory would double the
      // disk traffic and the required free space for no benefit; the file
      // belongs to the caller and is deleted by the caller, never here.
      const input = source.path
        ? source.path
        : join(workDir, `input${sourceExtension(source.fileName)}`);
      if (!source.path) {
        if (!source.bytes) {
          throw new Error(
            `The source video ${source.fileName} carried no bytes`,
          );
        }
        await writeFile(input, source.bytes);
      }

      const probe = await this.probe(input);
      const video = probe.streams?.find(
        (stream) => stream.codec_type === "video",
      );
      if (!video?.codec_name) {
        throw new Error(
          `No decodable video stream in ${source.fileName} (ffprobe found none)`,
        );
      }

      const audio = probe.streams?.find(
        (stream) => stream.codec_type === "audio",
      );
      const videoCodec = video.codec_name;
      const audioCodec = audio?.codec_name;
      const rotation = readRotation(video);

      // A rotated source must be re-encoded: an MPEG-TS stream cannot carry the
      // display matrix, so copying it would store a sideways video.
      const copyVideo = COPYABLE_VIDEO_CODECS.has(videoCodec) && rotation === 0;
      const copyAudio =
        audioCodec !== undefined && COPYABLE_AUDIO_CODECS.has(audioCodec);

      const display = displayDimensions(video, rotation);
      // A copied stream keeps the source resolution; only a re-encode is
      // allowed to shrink it, so the reported size always matches the output.
      const dimensions = copyVideo ? display : capWidth(display);

      const playlistPath = join(workDir, `${baseName}.m3u8`);
      // Read before the transcode: the progress handler maps the output
      // position onto it. `readDuration` only reads the probe result.
      const duration = this.readDuration(probe, video);

      /**
       * `-progress pipe:1` reports the output position as `out_time_us`. The
       * percentage is clamped below 100: the run is not finished while ffmpeg is
       * still flushing its last segments and extracting the cover afterwards.
       * A listener that throws must not kill a working transcode, so it is
       * called through a guard.
       */
      let lastReportedAt = 0;
      const reportProgress =
        onProgress && duration > 0
          ? (line: string) => {
              const match = OUT_TIME_MICROSECONDS.exec(line);
              if (!match) return;
              const now = Date.now();
              if (now - lastReportedAt < PROGRESS_INTERVAL_MS) return;
              lastReportedAt = now;
              const percent = Math.min(
                99,
                (Number(match[1]) / 1_000_000 / duration) * 100,
              );
              try {
                onProgress({ percent });
              } catch {
                /* a progress listener must never fail the transcode */
              }
            }
          : undefined;

      await runProcess(
        FFMPEG,
        this.buildArgs({
          input,
          workDir,
          baseName,
          playlistPath,
          copyVideo,
          copyAudio,
          hasAudio: audio !== undefined,
          dimensions,
        }),
        "HLS transcode",
        reportProgress,
      );

      const segments = await this.readSegments(workDir, baseName);
      if (segments.length === 0) {
        throw new Error("HLS transcode produced no segments");
      }

      const cover = await this.createCover(input, workDir, baseName, duration);

      return {
        playlist: {
          fileName: `${baseName}.m3u8`,
          contentType: PLAYLIST_CONTENT_TYPE,
          bytes: new Uint8Array(await readFile(playlistPath)),
        },
        segments,
        cover,
        duration,
        width: dimensions.width,
        height: dimensions.height,
        videoCodec,
        audioCodec,
        reencoded: !copyVideo,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async probe(input: string): Promise<ProbeResult> {
    const stdout = await runProcess(
      FFPROBE,
      [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        input,
      ],
      "ffprobe",
    );

    try {
      return JSON.parse(stdout) as ProbeResult;
    } catch {
      throw new Error("ffprobe returned an unreadable response");
    }
  }

  /** Assembles the ffmpeg command line for one HLS packaging run. */
  private buildArgs(input: {
    input: string;
    workDir: string;
    baseName: string;
    playlistPath: string;
    copyVideo: boolean;
    copyAudio: boolean;
    hasAudio: boolean;
    dimensions: { width: number; height: number };
  }): string[] {
    const args = [
      "-hide_banner",
      "-nostdin",
      "-y",
      // Machine-readable progress on stdout, one `key=value` block per update;
      // `-nostats` suppresses the human-formatted bar on stderr, which nothing
      // reads because a failure only quotes its last lines.
      "-progress",
      "pipe:1",
      "-nostats",
      "-i",
      input.input,
      // Only the first video track and, when present, the first audio track:
      // MPEG-TS cannot carry the subtitle/data streams an MP4 may also hold.
      "-map",
      "0:v:0",
    ];

    if (input.hasAudio) args.push("-map", "0:a:0?");

    if (input.copyVideo) {
      args.push("-c:v", "copy");
    } else {
      args.push(
        "-c:v",
        "libx264",
        "-preset",
        X264_PRESET,
        "-crf",
        String(X264_CRF),
        "-pix_fmt",
        "yuv420p",
      );
      if (input.dimensions.width > 0 && input.dimensions.height > 0) {
        args.push(
          "-vf",
          `scale=${input.dimensions.width}:${input.dimensions.height}`,
        );
      }
    }

    if (input.hasAudio) {
      if (input.copyAudio) {
        args.push("-c:a", "copy");
      } else {
        args.push("-c:a", "aac", "-b:a", AUDIO_BITRATE, "-ac", "2");
      }
    }

    args.push(
      "-f",
      "hls",
      // The MPEG-TS muxer otherwise front-loads every stream with its default
      // `muxdelay`/`muxpreload` (1.2s) and shifts the first segment by the
      // codec's reorder delay on top of that. A playlist whose first segment
      // starts at 1.4s is a hole as far as a player seeking to 0 is concerned
      // (hls.js reports `bufferSeekOverHole` and sits there), so the timeline is
      // normalised to start where the playlist says it does.
      "-muxdelay",
      "0",
      "-muxpreload",
      "0",
      "-hls_time",
      String(HLS_SEGMENT_SECONDS),
      "-hls_playlist_type",
      "vod",
      "-hls_list_size",
      "0",
      "-hls_flags",
      "independent_segments",
      "-hls_segment_filename",
      join(input.workDir, `${input.baseName}.%05d.ts`),
      input.playlistPath,
    );

    return args;
  }

  private async readSegments(
    workDir: string,
    baseName: string,
  ): Promise<TranscodedArtifact[]> {
    const prefix = `${baseName}.`;
    const names = (await readdir(workDir))
      .filter((name) => name.startsWith(prefix) && name.endsWith(".ts"))
      .sort();

    const segments: TranscodedArtifact[] = [];
    for (const name of names) {
      segments.push({
        fileName: name,
        contentType: SEGMENT_CONTENT_TYPE,
        bytes: new Uint8Array(await readFile(join(workDir, name))),
      });
    }
    return segments;
  }

  private readDuration(probe: ProbeResult, video: ProbeStream): number {
    const fromFormat = Number(probe.format?.duration);
    if (Number.isFinite(fromFormat) && fromFormat > 0) return fromFormat;

    const fromStream = Number(video.duration);
    return Number.isFinite(fromStream) && fromStream > 0 ? fromStream : 0;
  }

  /**
   * Grabs a poster frame for the node's cover.
   *
   * Best-effort by contract: a video whose first frames cannot be rasterized
   * still gets a playlist, it just falls back to the placeholder tile.
   */
  private async createCover(
    input: string,
    workDir: string,
    baseName: string,
    duration: number,
  ): Promise<DocumentCover | undefined> {
    // Frame 0 is often black; mirror the client-side rule that used to do this.
    const seek = duration > 0 ? Math.min(0.1, duration / 2) : 0;
    const target = join(workDir, `${baseName}.cover.jpg`);

    try {
      await runProcess(
        FFMPEG,
        [
          "-hide_banner",
          "-nostdin",
          "-y",
          "-ss",
          seek.toFixed(3),
          "-i",
          input,
          "-map",
          "0:v:0",
          "-frames:v",
          "1",
          "-vf",
          // `min()` keeps a small source from being blown up to cover width.
          `scale='min(${COVER_WIDTH},iw)':-2`,
          "-q:v",
          "3",
          "-f",
          "image2",
          target,
        ],
        "cover extraction",
      );

      const bytes = await readFile(target);
      if (bytes.byteLength === 0) return undefined;

      return {
        fileName: `${baseName}.cover.jpg`,
        contentType: COVER_CONTENT_TYPE,
        bytes: new Uint8Array(bytes),
      };
    } catch (error) {
      console.warn("[FfmpegVideoTranscoder] cover extraction failed", error);
      return undefined;
    }
  }
}
