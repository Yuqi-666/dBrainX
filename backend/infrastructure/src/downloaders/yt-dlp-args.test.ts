/** The exact argv a download or probe hands to yt-dlp. */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONCURRENT_FRAGMENTS,
  PROGRESS_TEMPLATE,
  buildDownloadArgs,
  buildProbeArgs,
  ffmpegLocationFromEnvironment,
} from "./yt-dlp-args.ts";

/** Asserts that `args` contains the two adjacent entries `first`, `second`. */
function assertPair(args: string[], first: string, second: string): void {
  const index = args.indexOf(first);
  assert.notEqual(index, -1, `missing ${first}`);
  assert.equal(
    args[index + 1],
    second,
    `${first} should be followed by ${second}`,
  );
}

test("builds the video download arguments", () => {
  const args = buildDownloadArgs({
    url: "https://www.bilibili.com/video/BV1",
    kind: "video",
    workDir: "/tmp/job/download",
    maxBytes: 1024,
    formatId: "137",
  });

  assert.ok(args.includes("--ignore-config"));
  assert.ok(args.includes("--no-playlist"));
  assert.ok(args.includes("--no-warnings"));
  assert.ok(args.includes("--no-simulate"));
  assert.ok(args.includes("--dump-single-json"));
  assert.ok(args.includes("--write-auto-subs"));
  assertPair(args, "--progress-template", PROGRESS_TEMPLATE);
  assertPair(args, "--concurrent-fragments", String(CONCURRENT_FRAGMENTS));
  assertPair(args, "--merge-output-format", "mp4/mkv");
  assertPair(args, "-f", "137+ba/b");
  // H.264 is the one codec the HLS packager can copy instead of re-encoding.
  assertPair(args, "-S", "vcodec:h264");
  assertPair(args, "--max-filesize", "1024");
  assertPair(args, "-o", "/tmp/job/download/source.%(ext)s");
  assertPair(args, "--sub-langs", "all,-live_chat,-danmaku");
  assertPair(args, "--convert-subs", "vtt");
  assertPair(args, "--convert-thumbnails", "jpg");
  assertPair(args, "--", "https://www.bilibili.com/video/BV1");
  assert.equal(args.at(-1), "https://www.bilibili.com/video/BV1");
});

test("asks for the best video and audio when no format was chosen", () => {
  const args = buildDownloadArgs({
    url: "https://youtu.be/abc",
    kind: "video",
    workDir: "/tmp/work",
    maxBytes: 1024,
  });

  assertPair(args, "-f", "bv*+ba/b");
  assertPair(args, "-S", "vcodec:h264");
});

test("builds the audio download arguments", () => {
  const args = buildDownloadArgs({
    url: "https://music.163.com/song?id=1",
    kind: "audio",
    workDir: "/tmp/work",
    maxBytes: 2048,
    formatId: "standard",
  });

  assert.ok(!args.includes("--merge-output-format"));
  assert.ok(!args.includes("--write-auto-subs"));
  assert.ok(!args.includes("-S"));
  assertPair(args, "-f", "standard/bestaudio/best");
  assertPair(args, "--sub-langs", "lyrics,all,-live_chat,-danmaku");
  assertPair(args, "--max-filesize", "2048");
});

test("falls back to the best audio when no format was chosen", () => {
  const args = buildDownloadArgs({
    url: "https://y.qq.com/n/ryqq/songDetail/1",
    kind: "audio",
    workDir: "/tmp/work",
    maxBytes: 1024,
  });

  assertPair(args, "-f", "bestaudio/best");
});

test("passes a cookie file by path, never by text", () => {
  const args = buildDownloadArgs({
    url: "https://youtu.be/abc",
    kind: "video",
    workDir: "/tmp/work",
    maxBytes: 1024,
    cookieFile: "/tmp/work/cookies.txt",
  });

  assertPair(args, "--cookies", "/tmp/work/cookies.txt");
});

test("passes a browser name instead of a cookie file", () => {
  const args = buildDownloadArgs({
    url: "https://youtu.be/abc",
    kind: "video",
    workDir: "/tmp/work",
    maxBytes: 1024,
    cookiesFromBrowser: "chrome",
  });

  assertPair(args, "--cookies-from-browser", "chrome");
  assert.ok(!args.includes("--cookies"));
});

test("prefers the browser method when both cookie sources exist", () => {
  const args = buildDownloadArgs({
    url: "https://youtu.be/abc",
    kind: "video",
    workDir: "/tmp/work",
    maxBytes: 1024,
    cookieFile: "/tmp/work/cookies.txt",
    cookiesFromBrowser: "firefox",
  });

  assertPair(args, "--cookies-from-browser", "firefox");
  assert.ok(!args.includes("--cookies"));
});

test("passes the FFmpeg location when one was configured", () => {
  const args = buildDownloadArgs({
    url: "https://youtu.be/abc",
    kind: "video",
    workDir: "/tmp/work",
    maxBytes: 1024,
    ffmpegLocation: "/opt/ffmpeg/bin",
  });

  assertPair(args, "--ffmpeg-location", "/opt/ffmpeg/bin");
});

test("builds the probe arguments without downloading the media", () => {
  const args = buildProbeArgs({
    url: "https://youtu.be/abc",
    kind: "video",
    workDir: "/tmp/probe",
    cookieFile: "/tmp/probe/cookies.txt",
  });

  assert.ok(args.includes("-J"));
  // `-J` implies simulation; without this the thumbnail would never be written.
  assert.ok(args.includes("--no-simulate"));
  assert.ok(args.includes("--skip-download"));
  assert.ok(args.includes("--write-thumbnail"));
  // yt-dlp only asks the site for its subtitle tracks when a download would
  // write them, so the probe asks for them explicitly; nothing is written
  // because `--skip-download` is passed.
  assert.ok(args.includes("--write-subs"));
  assert.ok(args.includes("--write-auto-subs"));
  assertPair(args, "--sub-langs", "all,-live_chat,-danmaku");
  assertPair(args, "--convert-thumbnails", "jpg");
  assertPair(args, "--cookies", "/tmp/probe/cookies.txt");
  assertPair(args, "-o", "/tmp/probe/source.%(ext)s");
  assertPair(args, "--", "https://youtu.be/abc");
});

test("asks an audio probe for the lyric track", () => {
  const args = buildProbeArgs({
    url: "https://music.163.com/song?id=1",
    kind: "audio",
    workDir: "/tmp/probe",
  });

  assert.ok(args.includes("--write-subs"));
  assert.ok(!args.includes("--write-auto-subs"));
  assertPair(args, "--sub-langs", "lyrics,all,-live_chat,-danmaku");
});

test("reads the FFmpeg directory from the environment", () => {
  const previous = process.env.FFMPEG_PATH;
  try {
    process.env.FFMPEG_PATH = "/opt/ffmpeg/bin/ffmpeg";
    assert.equal(ffmpegLocationFromEnvironment(), "/opt/ffmpeg/bin");

    delete process.env.FFMPEG_PATH;
    assert.equal(ffmpegLocationFromEnvironment(), undefined);
  } finally {
    if (previous === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previous;
  }
});
