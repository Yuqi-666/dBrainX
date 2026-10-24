// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The FFmpeg audio compatibility adapter.
 *
 * A fake ffmpeg stands in for the real binary: it writes the output file named
 * by the last argument, which is exactly where the adapter looks. The cases pin
 * the two paths the import relies on: a playable container is returned without
 * any conversion, and anything else becomes an `.m4a` in a temporary directory
 * whose cleanup is safe to repeat. The failure paths pin the classified error
 * codes.
 *
 * The adapter throws `MediaImportFailure` from `@workspace/utils`, a runtime
 * import that Node resolves through this package's workspace dependency; every
 * other `@workspace/*` import in the adapter is type-only and is erased.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { FfmpegAudioTranscoder } = await import("./ffmpeg-audio-transcoder.ts");
const { MediaImportFailure } = await import("@workspace/utils/media-import");

/** A stand-in ffmpeg that writes the output file named by its last argument. */
const FAKE_FFMPEG = `#!/bin/sh
set -eu
last=""
for argument in "$@"; do last="$argument"; done
printf 'converted audio bytes' > "$last"
`;

/** A stand-in that writes a fixed number of bytes, for the size check. */
const FAKE_FFMPEG_LARGE = `#!/bin/sh
set -eu
last=""
for argument in "$@"; do last="$argument"; done
printf '0123456789' > "$last"
`;

/** A stand-in that refuses the conversion. */
const FAKE_FFMPEG_FAILURE = `#!/bin/sh
echo "Invalid data found when processing input" >&2
exit 1
`;

/** One fake executable in its own directory. */
async function fakeFfmpeg(script: string) {
  const dir = await mkdtemp(join(tmpdir(), "dbrainx-audio-transcoder-test-"));
  const command = join(dir, "fake-ffmpeg");
  await writeFile(command, script, "utf8");
  await chmod(command, 0o755);
  return {
    command,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/** One downloaded file the caller would pass in. */
async function inputFile(name: string): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "dbrainx-audio-input-test-"));
  const path = join(dir, name);
  await writeFile(path, "input audio");
  return {
    path,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test("passes a playable container through untouched", async () => {
  const input = await inputFile("song.mp3");
  try {
    const transcoder = new FfmpegAudioTranscoder("/nonexistent/ffmpeg");
    const result = await transcoder.ensurePlayable({
      fileName: "song.mp3",
      path: input.path,
      maxBytes: 1024,
    });

    assert.equal(result.converted, false);
    assert.equal(result.path, input.path);
    assert.equal(result.fileName, "song.mp3");
    assert.equal(result.contentType, "audio/mpeg");
    // The pass-through path creates no temporary state.
    await result.cleanup();
    await result.cleanup();
  } finally {
    await input.cleanup();
  }
});

test("converts an unplayable container into a named .m4a copy", async () => {
  const fake = await fakeFfmpeg(FAKE_FFMPEG);
  const input = await inputFile("中文歌名.webm");
  try {
    const transcoder = new FfmpegAudioTranscoder(fake.command);
    const result = await transcoder.ensurePlayable({
      fileName: "中文歌名.webm",
      path: input.path,
      maxBytes: 1024,
    });

    assert.equal(result.converted, true);
    assert.equal(result.fileName, "中文歌名.m4a");
    assert.equal(result.contentType, "audio/mp4");
    assert.notEqual(result.path, input.path);
    assert.equal(await readFile(result.path, "utf8"), "converted audio bytes");

    const convertedPath = result.path;
    await result.cleanup();
    await assert.rejects(access(convertedPath));
    // Cleanup is safe to repeat, as the caller may call it from a `finally`.
    await result.cleanup();
    // The caller's source file is never removed.
    await access(input.path);
  } finally {
    await input.cleanup();
    await fake.cleanup();
  }
});

test("rejects when ffmpeg fails", async () => {
  const fake = await fakeFfmpeg(FAKE_FFMPEG_FAILURE);
  const input = await inputFile("song.webm");
  try {
    const transcoder = new FfmpegAudioTranscoder(fake.command);
    await assert.rejects(
      transcoder.ensurePlayable({
        fileName: "song.webm",
        path: input.path,
        maxBytes: 1024,
      }),
      (error: unknown) => {
        assert.ok(error instanceof MediaImportFailure);
        assert.equal(error.code, "conversion_failed");
        return true;
      },
    );
  } finally {
    await input.cleanup();
    await fake.cleanup();
  }
});

test("rejects a converted file above the byte ceiling", async () => {
  const fake = await fakeFfmpeg(FAKE_FFMPEG_LARGE);
  const input = await inputFile("song.webm");
  try {
    const transcoder = new FfmpegAudioTranscoder(fake.command);
    await assert.rejects(
      transcoder.ensurePlayable({
        fileName: "song.webm",
        path: input.path,
        maxBytes: 5,
      }),
      (error: unknown) => {
        assert.ok(error instanceof MediaImportFailure);
        assert.equal(error.code, "conversion_failed");
        return true;
      },
    );
  } finally {
    await input.cleanup();
    await fake.cleanup();
  }
});

test("a missing binary explains how to install it", async () => {
  const input = await inputFile("song.webm");
  try {
    const transcoder = new FfmpegAudioTranscoder("/nonexistent/ffmpeg");
    await assert.rejects(
      transcoder.ensurePlayable({
        fileName: "song.webm",
        path: input.path,
        maxBytes: 1024,
      }),
      (error: unknown) => {
        assert.ok(error instanceof MediaImportFailure);
        assert.equal(error.code, "unknown");
        assert.match(
          error.message,
          /install ffmpeg or point FFMPEG_PATH at it/,
        );
        return true;
      },
    );
  } finally {
    await input.cleanup();
  }
});
