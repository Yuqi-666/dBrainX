// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The yt-dlp media downloader contract.
 *
 * A fake executable stands in for yt-dlp: it reads the `-o` argument, writes
 * the files the real command would write (media, thumbnail, subtitles), prints
 * the progress lines, and prints the metadata JSON. The cases below pin the
 * parts that must not depend on a live site:
 *
 * - metadata, cover, and subtitle mapping onto the port;
 * - the exact argv (cookie, subtitles, thumbnail, fixed fragments, format);
 * - reuse of the caller's work directory, which is the resume base;
 * - cancellation and the classified failure codes;
 * - the refusal of addresses the server must not fetch.
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
import { dirname, join } from "node:path";

const { YtDlpMediaDownloader } = await import("./yt-dlp-media-downloader.ts");
const { MediaImportFailure } = await import("@workspace/utils/media-import");

/** A literal address in TEST-NET-1: public enough, and needs no DNS lookup. */
const PUBLIC_IP_URL = "http://192.0.2.1/watch?v=abc";

/** Writes the `-o` target's directory into `$directory`. */
const OUTPUT_LOOKUP = `
output=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "-o" ]; then output="$argument"; fi
  previous="$argument"
done
directory=$(dirname "$output")
: > "$directory/args.txt"
for argument in "$@"; do
  echo "$argument" >> "$directory/args.txt"
done
`;

/** A stand-in video download: media, thumbnail, two subtitle tracks, JSON. */
const FAKE_VIDEO = `#!/bin/sh
set -eu
${OUTPUT_LOOKUP}
printf 'dbrain fake video' > "$directory/source.mp4"
printf 'fake-jpeg' > "$directory/source.jpg"
cat > "$directory/source.en.vtt" <<VTT
WEBVTT

00:00.000 --> 00:01.500
English cue
VTT
cat > "$directory/source.zh-Hans.vtt" <<VTT
WEBVTT

00:00.000 --> 00:01.500
中文 cue
VTT
echo 'download:500/1000/2048/3'
echo 'download:1000/1000/NA/NA'
printf '%s' '{"title":"A Test Clip","duration":93.5,"webpage_url":"https://video.example/watch?v=abc","extractor_key":"TestExtractor","artist":"An Artist","album":"An Album","language":"zh-Hans","subtitles":{"zh-Hans":[{"name":"中文"}],"en":[{"name":"English"}]},"automatic_captions":{"ja":[{"name":"日本語"}]},"formats":[{"format_id":"137","ext":"mp4","vcodec":"avc1","acodec":"none","height":1080,"width":1920,"fps":30,"tbr":4000,"filesize":50000000},{"format_id":"140","ext":"m4a","vcodec":"none","acodec":"mp4a.40.2","abr":128}]}'
`;

/** A stand-in audio download: media, cover, lyric track, JSON. */
const FAKE_AUDIO = `#!/bin/sh
set -eu
${OUTPUT_LOOKUP}
printf 'dbrain fake audio' > "$directory/source.mp3"
printf 'fake-jpeg' > "$directory/source.jpg"
cat > "$directory/source.lyrics.vtt" <<VTT
WEBVTT

00:00.000 --> 00:04.630
第一行歌词
VTT
echo 'download:10/20/2048/1'
printf '%s' '{"title":"中文歌名 - 测试","track":"中文歌名/测试","duration":200.5,"webpage_url":"https://music.example/song?id=1","extractor_key":"Netease","artist":"歌手","album":"专辑","language":"zh","subtitles":{"lyrics":[{"name":"歌词"}]},"automatic_captions":{},"formats":[{"format_id":"flac","ext":"flac","vcodec":"none","acodec":"flac","abr":900},{"format_id":"standard","ext":"mp3","vcodec":"none","acodec":"mp3","abr":128}]}'
`;

/** A stand-in that writes an empty media file after printing metadata. */
const FAKE_EMPTY = `#!/bin/sh
set -eu
${OUTPUT_LOOKUP}
: > "$directory/source.mp4"
printf '%s' '{"title":"empty","duration":1,"formats":[]}'
`;

/** A stand-in that starts, marks the directory, and then waits. */
const FAKE_SLOW = `#!/bin/sh
set -eu
${OUTPUT_LOOKUP}
printf 'started\\n' > "$directory/started.txt"
# exec replaces the shell, so SIGTERM reaches the sleep instead of waiting
# for a child that still holds the pipes open.
exec sleep 10
`;

/** A stand-in that fails with one stderr line. */
function failureScript(message: string): string {
  return `#!/bin/sh
echo "${message}" >&2
exit 1
`;
}

/** One fake executable in its own directory. */
async function fakeYtDlp(script: string) {
  const dir = await mkdtemp(join(tmpdir(), "dbrain-media-downloader-test-"));
  const command = join(dir, "fake-yt-dlp");
  await writeFile(command, script, "utf8");
  await chmod(command, 0o755);
  return {
    command,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/** One empty work directory the caller owns, as the job store would provide. */
async function workDirectory(): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const path = await mkdtemp(join(tmpdir(), "dbrain-media-download-test-"));
  return {
    path,
    cleanup: () => rm(path, { recursive: true, force: true }),
  };
}

/** Reads the argv the fake executable received. */
async function recordedArgs(workDir: string): Promise<string[]> {
  return (await readFile(join(workDir, "args.txt"), "utf8"))
    .split("\n")
    .filter((line) => line !== "");
}

/** True when `args` holds `first` immediately followed by `second`. */
function hasPair(args: string[], first: string, second: string): boolean {
  const index = args.indexOf(first);
  return index !== -1 && args[index + 1] === second;
}

/** Waits until `path` exists, or fails the test after a few seconds. */
async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`timed out waiting for ${path}`);
}

test("downloads a video and maps yt-dlp's files and metadata", async () => {
  const fake = await fakeYtDlp(FAKE_VIDEO);
  const work = await workDirectory();
  try {
    const downloader = new YtDlpMediaDownloader(fake.command);
    const media = await downloader.download({
      url: PUBLIC_IP_URL,
      kind: "video",
      maxBytes: 10 * 1024 * 1024,
      formatId: "137",
      workDir: work.path,
    });

    assert.equal(media.fileName, "A_Test_Clip.mp4");
    assert.equal(media.contentType, "video/mp4");
    assert.equal(media.kind, "video");
    assert.equal(media.extractorKey, "TestExtractor");
    assert.equal(media.title, "A Test Clip");
    assert.equal(media.artist, "An Artist");
    assert.equal(media.album, "An Album");
    assert.equal(media.duration, 93.5);
    assert.equal(media.sourceUrl, "https://video.example/watch?v=abc");
    assert.equal(media.fileSize, "dbrain fake video".length);
    assert.equal(media.path, join(work.path, "source.mp4"));

    assert.equal(media.thumbnail?.path, join(work.path, "source.jpg"));
    assert.equal(media.thumbnail?.contentType, "image/jpeg");

    // The original-language track wins over English.
    assert.equal(media.subtitle?.language, "zh-Hans");
    assert.equal(media.subtitle?.label, "中文");
    assert.equal(media.subtitle?.automatic, false);
    assert.deepEqual(media.subtitle?.cues, [
      { timeMs: 0, endMs: 1500, content: "中文 cue" },
    ]);

    const args = await recordedArgs(work.path);
    assert.ok(args.includes("--ignore-config"));
    assert.ok(args.includes("--no-playlist"));
    assert.ok(args.includes("--no-simulate"));
    assert.ok(args.includes("--dump-single-json"));
    assert.ok(args.includes("--write-auto-subs"));
    assert.ok(args.includes("--write-thumbnail"));
    assert.ok(hasPair(args, "-f", "137+ba/b"));
    assert.ok(hasPair(args, "--concurrent-fragments", "4"));
    assert.ok(hasPair(args, "--merge-output-format", "mp4/mkv"));
    assert.ok(hasPair(args, "--sub-langs", "all,-live_chat"));
    assert.ok(hasPair(args, "--convert-subs", "vtt"));
    assert.ok(!args.includes("--cookies"));
    assert.equal(args.at(-1), PUBLIC_IP_URL);

    // Cleanup keeps the media file and the caller's directory: the caller
    // still has to store the file and owns the directory.
    await media.cleanup();
    await access(media.path);
    await access(work.path);
    await media.cleanup();
  } finally {
    await work.cleanup();
    await fake.cleanup();
  }
});

test("forwards progress printed before the metadata JSON", async () => {
  const fake = await fakeYtDlp(FAKE_VIDEO);
  const work = await workDirectory();
  try {
    const downloader = new YtDlpMediaDownloader(fake.command);
    const updates: { downloadedBytes: number; totalBytes: number }[] = [];

    const media = await downloader.download(
      {
        url: PUBLIC_IP_URL,
        kind: "video",
        maxBytes: 10 * 1024 * 1024,
        workDir: work.path,
      },
      (progress) =>
        updates.push({
          downloadedBytes: progress.downloadedBytes,
          totalBytes: progress.totalBytes,
        }),
    );

    assert.deepEqual(updates[0], { downloadedBytes: 500, totalBytes: 1000 });
    assert.deepEqual(media.subtitle?.cues[0]?.timeMs, 0);
    await media.cleanup();
  } finally {
    await work.cleanup();
    await fake.cleanup();
  }
});

test("downloads audio with a Unicode name and its lyric track", async () => {
  const fake = await fakeYtDlp(FAKE_AUDIO);
  const work = await workDirectory();
  try {
    const downloader = new YtDlpMediaDownloader(fake.command);
    const media = await downloader.download({
      url: PUBLIC_IP_URL,
      kind: "audio",
      maxBytes: 10 * 1024 * 1024,
      workDir: work.path,
    });

    assert.equal(media.fileName, "中文歌名测试.mp3");
    assert.equal(media.contentType, "audio/mpeg");
    assert.equal(media.kind, "audio");
    assert.equal(media.artist, "歌手");
    assert.equal(media.album, "专辑");
    assert.equal(media.subtitle?.language, "lyrics");
    assert.equal(media.subtitle?.label, "歌词");
    assert.equal(media.subtitle?.cues[0]?.content, "第一行歌词");

    const args = await recordedArgs(work.path);
    assert.ok(!args.includes("--merge-output-format"));
    assert.ok(!args.includes("--write-auto-subs"));
    assert.ok(hasPair(args, "-f", "bestaudio/best"));
    assert.ok(hasPair(args, "--sub-langs", "lyrics,all"));
    await media.cleanup();
  } finally {
    await work.cleanup();
    await fake.cleanup();
  }
});

test("writes a 0600 cookie file, passes it, and removes it after the run", async () => {
  const fake = await fakeYtDlp(FAKE_VIDEO);
  const work = await workDirectory();
  try {
    const downloader = new YtDlpMediaDownloader(fake.command);
    const cookieText =
      "Netscape HTTP Cookie File\n.example.test\tTRUE\t/\tFALSE\t0\tSESSION\tabc\n";
    const media = await downloader.download({
      url: PUBLIC_IP_URL,
      kind: "video",
      maxBytes: 1024 * 1024,
      cookies: cookieText,
      workDir: work.path,
    });

    const args = await recordedArgs(work.path);
    assert.ok(hasPair(args, "--cookies", join(work.path, "cookies.txt")));
    // The cookie file is gone once the run ended; the media file is not.
    await assert.rejects(access(join(work.path, "cookies.txt")));
    await media.cleanup();
    await access(media.path);
  } finally {
    await work.cleanup();
    await fake.cleanup();
  }
});

test("passes a browser name instead of writing a cookie file", async () => {
  const fake = await fakeYtDlp(FAKE_VIDEO);
  const work = await workDirectory();
  try {
    const downloader = new YtDlpMediaDownloader(fake.command);
    const media = await downloader.download({
      url: PUBLIC_IP_URL,
      kind: "video",
      maxBytes: 1024 * 1024,
      cookiesFromBrowser: "chrome",
      workDir: work.path,
    });

    const args = await recordedArgs(work.path);
    assert.ok(hasPair(args, "--cookies-from-browser", "chrome"));
    assert.ok(!args.includes("--cookies"));
    await assert.rejects(access(join(work.path, "cookies.txt")));
    await media.cleanup();
  } finally {
    await work.cleanup();
    await fake.cleanup();
  }
});

test("cancel stops the running process and reports cancelled", async () => {
  const fake = await fakeYtDlp(FAKE_SLOW);
  const work = await workDirectory();
  try {
    const downloader = new YtDlpMediaDownloader(fake.command);
    const download = downloader.download({
      url: PUBLIC_IP_URL,
      kind: "video",
      maxBytes: 1024 * 1024,
      workDir: work.path,
    });

    await waitForFile(join(work.path, "started.txt"));
    await downloader.cancel(work.path);

    await assert.rejects(download, (error: unknown) => {
      return error instanceof MediaImportFailure && error.code === "cancelled";
    });
  } finally {
    await work.cleanup();
    await fake.cleanup();
  }
});

test("refuses addresses the server must not fetch", async () => {
  const fake = await fakeYtDlp(FAKE_VIDEO);
  const base = await workDirectory();
  try {
    const downloader = new YtDlpMediaDownloader(fake.command);
    const refused: [string, RegExp][] = [
      ["not a url", /not a valid URL/],
      ["file:///etc/passwd", /http and https/],
      ["http://user:secret@192.0.2.1/watch", /credentials/],
      ["http://127.0.0.1/watch", /private address/],
      ["http://10.0.0.1/watch", /private address/],
      ["http://172.16.0.1/watch", /private address/],
      ["http://192.168.1.1/watch", /private address/],
      ["http://169.254.169.254/latest/meta-data", /private address/],
      ["http://[::1]/watch", /private address/],
      ["http://[fe80::1]/watch", /private address/],
    ];

    for (const [url, message] of refused) {
      await assert.rejects(
        downloader.download({
          url,
          kind: "video",
          maxBytes: 1024,
          workDir: join(base.path, "refused"),
        }),
        (error: unknown) => {
          assert.ok(error instanceof MediaImportFailure);
          assert.equal(error.code, "unsupported_url");
          assert.match(error.message, message, `expected ${url} to be refused`);
          return true;
        },
      );
    }
    // A refused address must not create the work directory.
    await assert.rejects(access(join(base.path, "refused")));
  } finally {
    await base.cleanup();
    await fake.cleanup();
  }
});

test("a missing binary explains how to install it", async () => {
  const fake = await fakeYtDlp(FAKE_VIDEO);
  const work = await workDirectory();
  try {
    const downloader = new YtDlpMediaDownloader(
      join(dirname(fake.command), "does-not-exist"),
    );

    await assert.rejects(
      downloader.download({
        url: PUBLIC_IP_URL,
        kind: "video",
        maxBytes: 1024,
        workDir: work.path,
      }),
      (error: unknown) => {
        assert.ok(error instanceof MediaImportFailure);
        assert.equal(error.code, "unknown");
        assert.match(
          error.message,
          /install yt-dlp or point YT_DLP_PATH at it/,
        );
        return true;
      },
    );
  } finally {
    await work.cleanup();
    await fake.cleanup();
  }
});

test("classifies the stderr of a failed run", async () => {
  const cases: [string, string][] = [
    [
      "ERROR: This video is only available for registered users",
      "login_required",
    ],
    ["ERROR: Login required, please sign in", "login_required"],
    ["ERROR: This video is private", "private"],
    ["ERROR: This video is members-only", "members_only"],
    ["ERROR: Unsupported URL: https://example.test/x", "unsupported_url"],
    ["ERROR: No video formats found", "no_media"],
    ["ERROR: The file is larger than max-filesize", "size_limit"],
    [
      "ERROR: Unable to download webpage: <urlopen error [Errno -2] Name or service not known>",
      "network",
    ],
    ["ERROR: something unexpected happened", "unknown"],
  ];

  for (const [stderr, code] of cases) {
    const fake = await fakeYtDlp(failureScript(stderr));
    const work = await workDirectory();
    try {
      const downloader = new YtDlpMediaDownloader(fake.command);
      await assert.rejects(
        downloader.download({
          url: PUBLIC_IP_URL,
          kind: "video",
          maxBytes: 1024,
          workDir: work.path,
        }),
        (error: unknown) => {
          assert.ok(error instanceof MediaImportFailure);
          assert.equal(error.code, code, stderr);
          return true;
        },
      );
    } finally {
      await work.cleanup();
      await fake.cleanup();
    }
  }
});

test("rejects a file that is larger than the byte ceiling", async () => {
  const fake = await fakeYtDlp(FAKE_VIDEO);
  const work = await workDirectory();
  try {
    const downloader = new YtDlpMediaDownloader(fake.command);
    await assert.rejects(
      downloader.download({
        url: PUBLIC_IP_URL,
        kind: "video",
        maxBytes: 5,
        workDir: work.path,
      }),
      (error: unknown) => {
        assert.ok(error instanceof MediaImportFailure);
        assert.equal(error.code, "size_limit");
        return true;
      },
    );
  } finally {
    await work.cleanup();
    await fake.cleanup();
  }
});

test("rejects an empty file yt-dlp reported as success", async () => {
  const fake = await fakeYtDlp(FAKE_EMPTY);
  const work = await workDirectory();
  try {
    const downloader = new YtDlpMediaDownloader(fake.command);
    await assert.rejects(
      downloader.download({
        url: PUBLIC_IP_URL,
        kind: "video",
        maxBytes: 1024,
        workDir: work.path,
      }),
      (error: unknown) => {
        assert.ok(error instanceof MediaImportFailure);
        assert.equal(error.code, "no_media");
        return true;
      },
    );
  } finally {
    await work.cleanup();
    await fake.cleanup();
  }
});

test("reuses the caller's existing work directory for a resume", async () => {
  const fake = await fakeYtDlp(FAKE_VIDEO);
  const work = await workDirectory();
  try {
    const marker = join(work.path, "source.mp4.part");
    await writeFile(marker, "partial bytes");

    const downloader = new YtDlpMediaDownloader(fake.command);
    const media = await downloader.download({
      url: PUBLIC_IP_URL,
      kind: "video",
      maxBytes: 1024 * 1024,
      workDir: work.path,
    });

    // The adapter did not replace the directory the caller owns.
    await access(marker);
    assert.equal(media.fileSize, "dbrain fake video".length);
    await media.cleanup();
  } finally {
    await work.cleanup();
    await fake.cleanup();
  }
});
