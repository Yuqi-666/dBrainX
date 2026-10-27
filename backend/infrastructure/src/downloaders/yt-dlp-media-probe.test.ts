// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The yt-dlp media probe contract.
 *
 * A fake executable stands in for yt-dlp: it writes the cover file the real
 * command writes and prints the metadata JSON. The cases pin the parts that
 * must not depend on a live site:
 *
 * - the probe result, including the cover read from the written file as a data
 *   URL of at most 512 KB, never fetched from an image address;
 * - the video and audio quality mapping;
 * - the listed-site key, and `null` for an unlisted address;
 * - a login refusal as a classified `login_required` failure;
 * - removal of the probe's own temporary directory on success and on failure.
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

const { YtDlpMediaProbe } = await import("./yt-dlp-media-probe.ts");
const { MediaImportFailure } = await import("@workspace/utils/media-import");

/** A literal address in TEST-NET-1: public enough, and needs no DNS lookup. */
const PUBLIC_IP_URL = "http://192.0.2.1/watch?v=abc";

/** Environment variable the fake scripts use to report their work directory. */
const PROBE_DIR_VARIABLE = "DBRAINX_TEST_PROBE_DIR";

/** Reads the `-o` argument and reports the probe directory. */
const OUTPUT_LOOKUP = `
output=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "-o" ]; then output="$argument"; fi
  previous="$argument"
done
directory=$(dirname "$output")
echo "$directory" > "$${PROBE_DIR_VARIABLE}"
`;

/** A stand-in video probe: one cover file and a metadata document. */
const FAKE_PROBE_VIDEO = `#!/bin/sh
set -eu
${OUTPUT_LOOKUP}
printf 'fake-jpeg' > "$directory/source.jpg"
printf '%s' '{"title":"A Test Clip","duration":93.5,"webpage_url":"https://video.example/watch?v=abc","extractor_key":"TestExtractor","artist":"An Artist","album":"An Album","language":"zh-Hans","subtitles":{"zh-Hans":[{"name":"中文"}],"danmaku":[{"name":"弹幕","ext":"xml"}],"en":[{"name":"English"}]},"automatic_captions":{"ja":[{"name":"日本語"}]},"formats":[{"format_id":"137","ext":"mp4","vcodec":"avc1","acodec":"none","height":1080,"width":1920,"fps":30,"tbr":4000,"filesize":50000000},{"format_id":"136","ext":"mp4","vcodec":"avc1","acodec":"none","height":720,"width":1280,"fps":30,"tbr":2000,"filesize":20000000},{"format_id":"140","ext":"m4a","vcodec":"none","acodec":"mp4a.40.2","abr":128}]}'
`;

/** A stand-in audio probe: one cover file and a metadata document. */
const FAKE_PROBE_AUDIO = `#!/bin/sh
set -eu
${OUTPUT_LOOKUP}
printf 'fake-jpeg' > "$directory/source.jpg"
printf '%s' '{"title":"一首歌","duration":200,"webpage_url":"https://music.163.com/song?id=1","extractor_key":"Netease","artist":"歌手","album":"专辑","subtitles":{"lyrics":[{"name":"歌词"}]},"automatic_captions":{},"formats":[{"format_id":"flac","ext":"flac","vcodec":"none","acodec":"flac","abr":900},{"format_id":"m4a-256","ext":"m4a","vcodec":"none","acodec":"aac","abr":256},{"format_id":"standard","ext":"mp3","vcodec":"none","acodec":"mp3","abr":128}]}'
`;

/** A stand-in that writes a cover larger than the data URL cap. */
const FAKE_PROBE_BIG_THUMB = `#!/bin/sh
set -eu
${OUTPUT_LOOKUP}
dd if=/dev/zero of="$directory/source.jpg" bs=1024 count=600 2>/dev/null
printf '%s' '{"title":"big cover","formats":[]}'
`;

/** A stand-in that refuses the anonymous request. */
const FAKE_PROBE_LOGIN = `#!/bin/sh
set -eu
${OUTPUT_LOOKUP}
echo "ERROR: This video is only available for registered users" >&2
exit 1
`;

/** One fake executable in its own directory. */
async function fakeYtDlp(script: string) {
  const dir = await mkdtemp(join(tmpdir(), "dbrainx-media-probe-test-"));
  const command = join(dir, "fake-yt-dlp");
  await writeFile(command, script, "utf8");
  await chmod(command, 0o755);
  return {
    command,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/**
 * A stand-in FFmpeg that writes a small JPEG to the last argument.
 *
 * The probe downscales a cover above the data URL cap; this is the binary that
 * does it in the test, so the test never needs a real encoder.
 */
async function fakeFfmpeg() {
  const dir = await mkdtemp(join(tmpdir(), "dbrainx-probe-ffmpeg-test-"));
  const command = join(dir, "fake-ffmpeg");
  await writeFile(
    command,
    '#!/bin/sh\nset -eu\nlast=""\nfor argument in "$@"; do last="$argument"; done\nprintf "small-jpeg" > "$last"\n',
    "utf8",
  );
  await chmod(command, 0o755);
  return {
    command,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/** Runs `probe` while the fake script reports its directory to this test. */
async function withProbeDirectory<T>(
  action: () => Promise<T>,
): Promise<{ result: T; directory: string | undefined }> {
  const recordDir = await mkdtemp(join(tmpdir(), "dbrainx-probe-record-"));
  const recordPath = join(recordDir, "directory.txt");
  const previous = process.env[PROBE_DIR_VARIABLE];
  process.env[PROBE_DIR_VARIABLE] = recordPath;
  try {
    const result = await action();
    let directory: string | undefined;
    try {
      directory = (await readFile(recordPath, "utf8")).trim();
    } catch {
      directory = undefined;
    }
    return { result, directory };
  } finally {
    if (previous === undefined) delete process.env[PROBE_DIR_VARIABLE];
    else process.env[PROBE_DIR_VARIABLE] = previous;
    await rm(recordDir, { recursive: true, force: true });
  }
}

test("probes a video and maps metadata, cover, languages, and qualities", async () => {
  const fake = await fakeYtDlp(FAKE_PROBE_VIDEO);
  try {
    const probe = new YtDlpMediaProbe(fake.command);
    const { result } = await withProbeDirectory(() =>
      probe.probe({ url: PUBLIC_IP_URL, kind: "video" }),
    );

    assert.equal(result.kind, "video");
    // 192.0.2.1 is not a listed site.
    assert.equal(result.siteKey, null);
    assert.equal(result.extractorKey, "TestExtractor");
    assert.equal(result.title, "A Test Clip");
    assert.equal(result.artist, "An Artist");
    assert.equal(result.album, "An Album");
    assert.equal(result.duration, 93.5);
    assert.equal(result.requiresLogin, false);

    assert.equal(
      result.thumbnailDataUrl,
      `data:image/jpeg;base64,${Buffer.from("fake-jpeg").toString("base64")}`,
    );

    // Bilibili's danmaku track is in the metadata but is not a caption: the
    // download excludes it, so the probe does not advertise it either.
    assert.deepEqual(
      result.subtitleLanguages.map((track) => track.language),
      ["zh-Hans", "en", "ja"],
    );
    assert.deepEqual(
      result.subtitleLanguages.map((track) => track.automatic),
      [false, false, true],
    );

    assert.deepEqual(
      result.qualities.map((quality) => quality.id),
      ["best", "1080p", "720p"],
    );
  } finally {
    await fake.cleanup();
  }
});

test("probes audio into quality tiers and shows the lyric track", async () => {
  const fake = await fakeYtDlp(FAKE_PROBE_AUDIO);
  try {
    const probe = new YtDlpMediaProbe(fake.command);
    const { result } = await withProbeDirectory(() =>
      probe.probe({ url: PUBLIC_IP_URL, kind: "audio" }),
    );

    assert.equal(result.kind, "audio");
    assert.equal(result.title, "一首歌");
    assert.equal(result.artist, "歌手");
    assert.equal(result.album, "专辑");
    assert.deepEqual(
      result.qualities.map((quality) => quality.id),
      ["lossless", "exhigh", "standard"],
    );
    assert.deepEqual(
      result.subtitleLanguages.map((track) => track.language),
      ["lyrics"],
    );
  } finally {
    await fake.cleanup();
  }
});

test("shrinks an oversized cover through FFmpeg", async () => {
  const fake = await fakeYtDlp(FAKE_PROBE_BIG_THUMB);
  const ffmpeg = await fakeFfmpeg();
  const previousFfmpeg = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = ffmpeg.command;
  try {
    const probe = new YtDlpMediaProbe(fake.command);
    const { result } = await withProbeDirectory(() =>
      probe.probe({ url: PUBLIC_IP_URL, kind: "video" }),
    );

    assert.ok(result.thumbnailDataUrl?.startsWith("data:image/jpeg;base64,"));
  } finally {
    if (previousFfmpeg === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previousFfmpeg;
    await fake.cleanup();
    await ffmpeg.cleanup();
  }
});

test("returns no cover when an oversized cover cannot be shrunk", async () => {
  const fake = await fakeYtDlp(FAKE_PROBE_BIG_THUMB);
  const previousFfmpeg = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = "/nonexistent/dbrainx-test-ffmpeg";
  try {
    const probe = new YtDlpMediaProbe(fake.command);
    const { result } = await withProbeDirectory(() =>
      probe.probe({ url: PUBLIC_IP_URL, kind: "video" }),
    );

    assert.equal(result.thumbnailDataUrl, null);
  } finally {
    if (previousFfmpeg === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previousFfmpeg;
    await fake.cleanup();
  }
});

test("reports a login refusal as a classified failure", async () => {
  const fake = await fakeYtDlp(FAKE_PROBE_LOGIN);
  try {
    const probe = new YtDlpMediaProbe(fake.command);
    const { directory } = await withProbeDirectory(async () => {
      await assert.rejects(
        probe.probe({ url: PUBLIC_IP_URL, kind: "audio" }),
        (error: unknown) => {
          assert.ok(error instanceof MediaImportFailure);
          assert.equal(error.code, "login_required");
          return true;
        },
      );
      return undefined;
    });

    // The probe's own temporary directory is gone on the failure path too.
    assert.ok(directory);
    await assert.rejects(access(directory));
  } finally {
    await fake.cleanup();
  }
});

test("removes its temporary directory after a successful probe", async () => {
  const fake = await fakeYtDlp(FAKE_PROBE_VIDEO);
  try {
    const probe = new YtDlpMediaProbe(fake.command);
    const { directory } = await withProbeDirectory(() =>
      probe.probe({ url: PUBLIC_IP_URL, kind: "video" }),
    );

    assert.ok(directory);
    await assert.rejects(access(directory));
  } finally {
    await fake.cleanup();
  }
});
