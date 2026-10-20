// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The cache contract of the file command service.
 *
 * Parsing a PDF and packaging a video are the expensive half of a media upload,
 * and both leave extra stored blobs behind. The cases below pin the reason the
 * result is cached on the resource record: a second analysis of the same
 * resource must not parse, transcode or store anything again, because a
 * reference is the common case and every reference used to pay the full cost
 * (and add its own copy of the cover and the HLS package).
 *
 * Importing a file from a site URL is not this service's job anymore; the shared
 * video/audio pipeline lives in `../media/media-import.service.ts`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  HlsTranscodeResult,
  IDocumentAnalyzer,
  IFileStore,
  IMediaAnalysisStore,
  IStorageUsageReader,
  IVideoTranscoder,
  ResourceAnalysis,
  ResourceAnalysisPatch,
} from "@workspace/domain";
import type { StorageLimits } from "@workspace/utils/storage-limits";
import { FileCommandService } from "./file-command.service.ts";

const PDF_URL = "/api/files/files/pdfresource/file.pdf";
const VIDEO_URL = "/api/files/files/videoresource/clip.mp4";

/** Storage policy passed by the composition root; unused by these use cases. */
const STORAGE_LIMITS: StorageLimits = {
  userQuotaBytes: 0,
  maxFileBytes: {
    image: 1024,
    video: 1024,
    audio: 1024,
    pdf: 1024,
    webpage: 1024,
    other: 1024,
  },
};

/** An analysis cache that starts empty (or with one known answer). */
function analysisCache(initial?: ResourceAnalysis) {
  const cache = new Map<string, ResourceAnalysis>();
  if (initial) cache.set(PDF_URL, initial);
  const writes: ResourceAnalysisPatch[] = [];

  const store: IMediaAnalysisStore = {
    async read(fileUrl) {
      return cache.get(fileUrl) ?? null;
    },
    async write(fileUrl, patch) {
      writes.push(patch);
      const base = cache.get(fileUrl) ?? {
        pageCount: 0,
        width: 0,
        height: 0,
        duration: 0,
        coverUrl: "",
        hlsUrl: "",
        fileSize: 0,
      };
      cache.set(fileUrl, { ...base, ...patch });
      return true;
    },
  };

  return { store, writes };
}

/** A store whose derived writes are recorded by source and name. */
function fileStore() {
  const derived: string[] = [];
  const store: IFileStore = {
    async download() {
      return new Uint8Array([1, 2, 3]);
    },
    async stat() {
      return 1000;
    },
    async downloadToTempFile() {
      return {
        path: "/tmp/source",
        bytes: 1000,
        cleanup: async () => undefined,
      };
    },
    async upload() {
      return "/api/files/files/plain/upload";
    },
    async uploadFromPath() {
      return { id: "plain", url: "/api/files/files/plain/upload" };
    },
    async uploadDerived(sourceUrl, blob) {
      derived.push(`${sourceUrl} ← ${blob.fileName}`);
      return `/api/files/files/artifact/${blob.fileName}`;
    },
  };
  return { store, derived };
}

/** A PDF analyzer that counts how often it was actually asked to parse. */
function pdfAnalyzer() {
  let calls = 0;
  const port: IDocumentAnalyzer = {
    async analyzePdf() {
      calls += 1;
      return {
        pageCount: 7,
        fileSize: 1000,
        pageWidth: 612,
        pageHeight: 792,
        info: { isEncrypted: false },
        cover: {
          fileName: "pdf-cover-1.jpg",
          contentType: "image/jpeg",
          bytes: new Uint8Array([1]),
        },
      };
    },
  };
  return { port, calls: () => calls };
}

/** A transcoder that counts runs and returns a one-segment HLS package. */
function videoTranscoder() {
  let calls = 0;
  const result: HlsTranscodeResult = {
    playlist: {
      fileName: "clip.m3u8",
      contentType: "application/vnd.apple.mpegurl",
      bytes: new TextEncoder().encode("#EXTM3U\n#EXTINF:4,\nclip.00000.ts\n"),
    },
    segments: [
      {
        fileName: "clip.00000.ts",
        contentType: "video/mp2t",
        bytes: new Uint8Array([1]),
      },
    ],
    cover: {
      fileName: "clip.cover.jpg",
      contentType: "image/jpeg",
      bytes: new Uint8Array([1]),
    },
    duration: 12,
    width: 640,
    height: 360,
    videoCodec: "h264",
    audioCodec: "aac",
    reencoded: false,
  };
  const port: IVideoTranscoder = {
    async transcodeToHls() {
      calls += 1;
      return result;
    },
  };
  return { port, calls: () => calls };
}

/** A usage reader the constructor requires; these use cases never read it. */
function storageUsage(): IStorageUsageReader {
  return {
    async usageFor() {
      return 0;
    },
  };
}

function service() {
  const analyzer = pdfAnalyzer();
  const files = fileStore();
  const transcoder = videoTranscoder();
  const cache = analysisCache();
  const commands = new FileCommandService(
    analyzer.port,
    files.store,
    transcoder.port,
    cache.store,
    10 * 1024 * 1024,
    storageUsage(),
    STORAGE_LIMITS,
  );
  return { commands, analyzer, files, transcoder, cache };
}

test("a second PDF analysis answers from the resource cache", async () => {
  const { commands, analyzer, files, cache } = service();

  const first = await commands.analyzePdf({ fileUrl: PDF_URL });
  assert.equal(first.pageCount, 7);
  assert.match(first.coverUrl, /pdf-cover-1\.jpg$/);
  assert.equal(analyzer.calls(), 1);

  const second = await commands.analyzePdf({ fileUrl: PDF_URL });

  assert.equal(second.pageCount, first.pageCount);
  assert.equal(second.coverUrl, first.coverUrl);
  assert.equal(
    second.fileSize,
    1000,
    "the recorded size answers the cache hit",
  );
  // Page size and Info are not cached: a node stores neither.
  assert.equal(second.pageWidth, 0);
  assert.equal(second.pageHeight, 0);
  assert.deepEqual(second.info, { isEncrypted: false });

  assert.equal(analyzer.calls(), 1, "the cache hit must not parse again");
  assert.equal(files.derived.length, 1, "the cover is stored only once");
  assert.deepEqual(cache.writes, [{ pageCount: 7, coverUrl: first.coverUrl }]);
});

test("a second video package answers from the resource cache", async () => {
  const { commands, transcoder, files, cache } = service();

  const first = await commands.transcodeVideo({ fileUrl: VIDEO_URL });
  assert.equal(first.hlsUrl, "/api/files/files/artifact/clip.m3u8");
  assert.equal(first.videoCodec, "h264");

  const second = await commands.transcodeVideo({ fileUrl: VIDEO_URL });

  assert.equal(
    transcoder.calls(),
    1,
    "the cache hit must not run FFmpeg again",
  );
  assert.equal(second.hlsUrl, first.hlsUrl);
  assert.equal(second.coverUrl, first.coverUrl);
  assert.equal(second.duration, 12);
  assert.equal(second.width, 640);
  assert.equal(second.height, 360);
  // A cached answer does not claim codecs of a transcode it did not run.
  assert.equal(second.videoCodec, "");
  assert.equal(second.reencoded, false);

  // One segment, one playlist, one poster — all marked as derived from the
  // resource, so deleting it frees the whole package.
  assert.deepEqual(files.derived, [
    `${VIDEO_URL} ← clip.00000.ts`,
    `${VIDEO_URL} ← clip.m3u8`,
    `${VIDEO_URL} ← clip.cover.jpg`,
  ]);
  assert.deepEqual(cache.writes, [
    {
      hlsUrl: first.hlsUrl,
      coverUrl: first.coverUrl,
      duration: 12,
      width: 640,
      height: 360,
    },
  ]);
});

test("a failed analysis caches nothing and can be retried", async () => {
  const files = fileStore();
  const cache = analysisCache();
  const commands = new FileCommandService(
    {
      async analyzePdf() {
        throw new Error("password protected");
      },
    },
    files.store,
    videoTranscoder().port,
    cache.store,
    10 * 1024 * 1024,
    storageUsage(),
    STORAGE_LIMITS,
  );

  await assert.rejects(
    commands.analyzePdf({ fileUrl: PDF_URL }),
    /password protected/,
  );
  assert.deepEqual(cache.writes, []);
  assert.deepEqual(files.derived, []);
});
