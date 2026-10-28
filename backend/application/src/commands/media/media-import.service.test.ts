// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shared video/audio import service.
 *
 * The cases below use fake ports so the pipeline is pinned without a network,
 * yt-dlp, or FFmpeg: what is stored, in which workspace, with which job state,
 * what progress is published, which failures become which stable code, and that
 * cancellation removes the job and reports `cancelled`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AudioConversionRequest,
  DownloadedRemoteMedia,
  HlsTranscodeResult,
  IAudioTranscoder,
  IFileStore,
  IMediaAnalysisStore,
  IMediaDownloader,
  IMediaImportJobStore,
  IMediaProbe,
  IMediaSiteAuthRepository,
  IMediaSiteCatalog,
  IStorageUsageReader,
  IVideoTranscoder,
  MediaImportJob,
  MediaKind,
  MediaProbeRequest,
  MediaProbeResult,
  MediaQualityOption,
  MediaSiteAuth,
  MediaSiteDefinition,
  RemoteMediaDownloadRequest,
  ResourceAnalysisPatch,
} from "@workspace/domain";
import type { MediaImportProgress } from "@workspace/interfaces";
// Source-path imports for the same reason as the service: the co-located test
// runs through Node's type-stripping loader, which does not resolve the
// workspace tsconfig paths.
import type { StorageLimits } from "../../../../../packages/utils/src/storage-limits.ts";
import { MediaImportFailure } from "../../../../../packages/utils/src/media-import.ts";
import { MediaImportService } from "./media-import.service.ts";

const VIDEO_URL = "https://www.bilibili.com/video/BV1GJ411x7h7";
const AUDIO_URL = "https://music.163.com/song?id=1901371647";
const VIDEO_LIMIT = 1024 * 1024;
const AUDIO_LIMIT = 512 * 1024;

const STORAGE_LIMITS: StorageLimits = {
  userQuotaBytes: 0,
  maxFileBytes: {
    image: 4096,
    video: VIDEO_LIMIT,
    audio: AUDIO_LIMIT,
    pdf: 1024,
    webpage: 1024,
    other: 1024,
  },
};

const BILIBILI: MediaSiteDefinition = {
  key: "bilibili",
  name: "B 站",
  kinds: ["video"],
  hosts: ["bilibili.com", "b23.tv"],
  loginHint: "登录后可看高清",
  probeUrl: "https://www.bilibili.com/video/BV1GJ411x7h7",
};

const NETEASE: MediaSiteDefinition = {
  key: "netease",
  name: "网易云音乐",
  kinds: ["audio"],
  hosts: ["music.163.com", "163cn.tv"],
  loginHint: "登录后可听较高音质",
  probeUrl: "https://music.163.com/song?id=1901371647",
};

const QUALITY: MediaQualityOption = {
  id: "1080p",
  formatId: "137+140",
  label: "1080p",
  ext: "mp4",
  codec: "h264",
  height: 1080,
  width: 1920,
  fps: 30,
  abr: 0,
  estimatedBytes: 1000,
};

/* ------------------------------------------------------------------------- */
/* Fake ports                                                                */
/* ------------------------------------------------------------------------- */

function sitesCatalog() {
  const definitions = [BILIBILI, NETEASE];
  const port: IMediaSiteCatalog = {
    list(kind) {
      return kind
        ? definitions.filter((site) => site.kinds.includes(kind))
        : [...definitions];
    },
    match(url) {
      try {
        const host = new URL(url).hostname.toLowerCase();
        return (
          definitions.find((site) =>
            site.hosts.some(
              (siteHost) => host === siteHost || host.endsWith(`.${siteHost}`),
            ),
          ) ?? null
        );
      } catch {
        return null;
      }
    },
    find(key) {
      return definitions.find((site) => site.key === key) ?? null;
    },
  };
  return { port, definitions };
}

function siteAuthFake(
  initial: {
    auth: MediaSiteAuth;
    cookieText?: string;
    version?: string;
  }[] = [],
) {
  const saved = new Map<string, MediaSiteAuth>();
  const secrets = new Map<string, { cookieText: string; version: string }>();
  const statuses: { siteKey: string; status: string; accountLabel?: string }[] =
    [];
  const touched: string[] = [];
  const removed: string[] = [];

  for (const entry of initial) {
    saved.set(entry.auth.siteKey, entry.auth);
    if (entry.cookieText) {
      secrets.set(entry.auth.siteKey, {
        cookieText: entry.cookieText,
        version: entry.version ?? "cookie-v1",
      });
    }
  }

  const port: IMediaSiteAuthRepository = {
    async list() {
      return [...saved.values()];
    },
    async find(_ownerId, siteKey) {
      return saved.get(siteKey) ?? null;
    },
    async readSecret(_ownerId, siteKey) {
      return secrets.get(siteKey) ?? null;
    },
    async save(_ownerId, input) {
      const auth: MediaSiteAuth = {
        siteKey: input.siteKey,
        authMethod: input.authMethod,
        browserName: input.browserName ?? "",
        accountLabel: input.accountLabel ?? "",
        status: input.status,
        lastCheckedAt: "",
        lastUsedAt: "",
      };
      saved.set(input.siteKey, auth);
      if (input.cookieText) {
        secrets.set(input.siteKey, {
          cookieText: input.cookieText,
          version: `cookie-${saved.size}`,
        });
      }
      return auth;
    },
    async setStatus(_ownerId, siteKey, status, accountLabel) {
      statuses.push({ siteKey, status, accountLabel });
      const current = saved.get(siteKey);
      if (current) {
        saved.set(siteKey, {
          ...current,
          status,
          accountLabel: accountLabel ?? current.accountLabel,
          lastCheckedAt: new Date().toISOString(),
        });
      }
    },
    async touch(_ownerId, siteKey) {
      touched.push(siteKey);
    },
    async remove(_ownerId, siteKey) {
      removed.push(siteKey);
      saved.delete(siteKey);
      secrets.delete(siteKey);
    },
  };

  return { port, saved, secrets, statuses, touched, removed };
}

function probeFake(
  options: {
    failWith?: Error;
    siteKey?: string | null;
    qualities?: MediaQualityOption[];
  } = {},
) {
  const requests: MediaProbeRequest[] = [];
  const port: IMediaProbe = {
    async probe(request) {
      requests.push(request);
      if (options.failWith) throw options.failWith;
      const result: MediaProbeResult = {
        kind: request.kind,
        siteKey: options.siteKey === undefined ? "bilibili" : options.siteKey,
        extractorKey: "FakeExtractor",
        title: "Clip",
        artist: "Uploader",
        album: "Album",
        duration: 93,
        thumbnailDataUrl: null,
        requiresLogin: false,
        subtitleLanguages: [],
        qualities: options.qualities ?? [QUALITY],
      };
      return result;
    },
  };
  return { port, requests };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function downloaderFake(
  options: {
    fileName?: string;
    contentType?: string;
    fileSize?: number;
    duration?: number;
    subtitle?: DownloadedRemoteMedia["subtitle"];
    thumbnail?: DownloadedRemoteMedia["thumbnail"];
    /** Absolute path of the file the fake downloaded, when it really exists. */
    path?: string;
    manual?: boolean;
    failWith?: Error;
  } = {},
) {
  const requests: RemoteMediaDownloadRequest[] = [];
  const cancelled: string[] = [];
  const gates: ReturnType<typeof deferred>[] = [];
  let cleanups = 0;

  const port: IMediaDownloader = {
    async download(request, onProgress) {
      requests.push(request);
      if (options.manual) {
        const gate = deferred();
        gates.push(gate);
        await gate.promise;
      }
      if (options.failWith) throw options.failWith;
      onProgress?.({
        downloadedBytes: 50,
        totalBytes: 100,
        speedBytesPerSecond: 10,
        etaSeconds: 5,
      });

      const fileName = options.fileName ?? "clip.mp4";
      return {
        path: options.path ?? `/tmp/media-download/${fileName}`,
        fileName,
        contentType:
          options.contentType ??
          (request.kind === "video" ? "video/mp4" : "audio/mpeg"),
        kind: request.kind,
        extractorKey: "FakeExtractor",
        title: "Clip",
        artist: "Uploader",
        album: "Album",
        duration: options.duration ?? 93,
        fileSize: options.fileSize ?? 1000,
        sourceUrl: request.url,
        thumbnail: options.thumbnail ?? null,
        subtitle: options.subtitle ?? null,
        cleanup: async () => {
          cleanups += 1;
        },
      };
    },
    async cancel(workDir) {
      cancelled.push(workDir);
    },
  };

  return { port, requests, cancelled, gates, cleanups: () => cleanups };
}

function fileStoreFake(statBytes = 1000) {
  const uploads: {
    filePath: string;
    fileName: string;
    contentType: string;
    workspaceId: string;
  }[] = [];
  const derived: { sourceUrl: string; fileName: string }[] = [];
  const tempDownloads: string[] = [];
  let packagingCleanups = 0;

  const store: IFileStore = {
    async download() {
      return new Uint8Array([1]);
    },
    async stat() {
      return statBytes;
    },
    async downloadToTempFile(fileUrl) {
      tempDownloads.push(fileUrl);
      return {
        path: "/tmp/packaging/source.mp4",
        bytes: 1000,
        cleanup: async () => {
          packagingCleanups += 1;
        },
      };
    },
    async upload() {
      return "/api/files/files/plain/upload";
    },
    async uploadFromPath(filePath, fileName, contentType, workspaceId) {
      uploads.push({ filePath, fileName, contentType, workspaceId });
      return { id: "stored", url: "/api/files/files/stored/source" };
    },
    async uploadDerived(sourceUrl, blob) {
      derived.push({ sourceUrl, fileName: blob.fileName });
      return `/api/files/files/derived/${blob.fileName}`;
    },
  };

  return {
    store,
    uploads,
    derived,
    tempDownloads,
    packagingCleanups: () => packagingCleanups,
  };
}

function videoTranscoderFake() {
  const calls: string[] = [];
  const sources: { fileName: string; path?: string }[] = [];
  const result: HlsTranscodeResult = {
    playlist: {
      fileName: "clip.m3u8",
      contentType: "application/vnd.apple.mpegurl",
      bytes: new TextEncoder().encode("#EXTM3U\nclip.00000.ts\n"),
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
    async transcodeToHls(source, onProgress) {
      calls.push(source.fileName);
      sources.push({ fileName: source.fileName, path: source.path });
      if (onProgress) {
        onProgress({ percent: 50 });
        onProgress({ percent: 100 });
      }
      return result;
    },
  };
  return { port, calls, sources };
}

function audioTranscoderFake() {
  const requests: AudioConversionRequest[] = [];
  let cleanups = 0;
  const port: IAudioTranscoder = {
    async ensurePlayable(request) {
      requests.push(request);
      return {
        path: "/tmp/converted/track.m4a",
        fileName: `${request.fileName.replace(/\.[^.]+$/, "")}.m4a`,
        contentType: "audio/mp4",
        converted: true,
        cleanup: async () => {
          cleanups += 1;
        },
      };
    },
  };
  return { port, requests, cleanups: () => cleanups };
}

function analysisFake() {
  const writes: ResourceAnalysisPatch[] = [];
  const store: IMediaAnalysisStore = {
    async read() {
      return null;
    },
    async write(_fileUrl, patch) {
      writes.push(patch);
      return true;
    },
  };
  return { store, writes };
}

function storageUsageFake(usedBytes = 0) {
  const owners: string[] = [];
  const port: IStorageUsageReader = {
    async usageFor(ownerId) {
      owners.push(ownerId);
      return usedBytes;
    },
  };
  return { port, owners };
}

function jobStoreFake() {
  const jobs = new Map<string, MediaImportJob>();
  const removed: string[] = [];
  const updates: { jobId: string; patch: Record<string, unknown> }[] = [];
  let markInterruptedCalls = 0;
  const sweepTtls: number[] = [];

  const port: IMediaImportJobStore = {
    async create(input) {
      const now = new Date().toISOString();
      const job: MediaImportJob = {
        jobId: input.jobId,
        ownerId: input.ownerId,
        nodeId: input.nodeId,
        kind: input.kind,
        url: input.url,
        formatId: input.formatId,
        cookieVersion: input.cookieVersion,
        state: "running",
        stage: "",
        percent: 0,
        createdAt: now,
        updatedAt: now,
        result: null,
      };
      jobs.set(job.jobId, job);
      return job;
    },
    async findForNode(ownerId, nodeId) {
      return (
        [...jobs.values()]
          .filter((job) => job.ownerId === ownerId && job.nodeId === nodeId)
          .sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt),
          )[0] ?? null
      );
    },
    async read(ownerId, jobId) {
      const job = jobs.get(jobId);
      return job && job.ownerId === ownerId ? job : null;
    },
    async update(ownerId, jobId, patch) {
      const job = jobs.get(jobId);
      if (!job || job.ownerId !== ownerId) return null;
      Object.assign(job, patch);
      job.updatedAt = new Date().toISOString();
      updates.push({ jobId, patch: { ...patch } });
      return job;
    },
    async remove(ownerId, jobId) {
      const job = jobs.get(jobId);
      if (job && job.ownerId !== ownerId) return;
      jobs.delete(jobId);
      removed.push(jobId);
    },
    workDir(ownerId, jobId) {
      return `/tmp/media-imports/${ownerId}/${jobId}/download`;
    },
    async markInterrupted() {
      markInterruptedCalls += 1;
      return 0;
    },
    async sweep(ttlMs) {
      sweepTtls.push(ttlMs);
      return 0;
    },
  };

  return {
    port,
    jobs,
    removed,
    updates,
    markInterruptedCalls: () => markInterruptedCalls,
    sweepTtls,
  };
}

interface ServiceOptions {
  downloader?: Parameters<typeof downloaderFake>[0];
  probe?: Parameters<typeof probeFake>[0];
  auth?: Parameters<typeof siteAuthFake>[0];
  usedBytes?: number;
  limits?: StorageLimits;
  statBytes?: number;
}

function service(options: ServiceOptions = {}) {
  const catalog = sitesCatalog();
  const auth = siteAuthFake(options.auth);
  const probe = probeFake(options.probe);
  const downloader = downloaderFake(options.downloader);
  const files = fileStoreFake(options.statBytes);
  const analysis = analysisFake();
  const jobs = jobStoreFake();
  const video = videoTranscoderFake();
  const audio = audioTranscoderFake();
  const usage = storageUsageFake(options.usedBytes);

  const commands = new MediaImportService(
    downloader.port,
    probe.port,
    video.port,
    audio.port,
    files.store,
    analysis.store,
    jobs.port,
    catalog.port,
    auth.port,
    usage.port,
    options.limits ?? STORAGE_LIMITS,
  );

  return {
    commands,
    catalog,
    auth,
    probe,
    downloader,
    files,
    analysis,
    jobs,
    video,
    audio,
    usage,
  };
}

const VIDEO_COMMAND = {
  ownerId: "owner1",
  workspaceId: "workspace1",
  nodeId: "node1",
  kind: "video" as MediaKind,
  url: VIDEO_URL,
};

const AUDIO_COMMAND = {
  ownerId: "owner1",
  workspaceId: "workspace1",
  nodeId: "node2",
  kind: "audio" as MediaKind,
  url: AUDIO_URL,
};

/* ------------------------------------------------------------------------- */
/* Happy paths                                                               */
/* ------------------------------------------------------------------------- */

test("a video is downloaded, stored, packaged and recorded as a job", async () => {
  const { commands, files, downloader, video, analysis, jobs } = service();
  const updates: MediaImportProgress[] = [];

  const result = await commands.import(VIDEO_COMMAND, (progress) =>
    updates.push(progress),
  );

  assert.deepEqual(result, {
    jobId: result.jobId,
    fileName: "clip.mp4",
    url: "/api/files/files/stored/source",
    coverUrl: "/api/files/files/derived/clip.cover.jpg",
    hlsUrl: "/api/files/files/derived/clip.m3u8",
    duration: 12,
    fileSize: 1000,
    title: "Clip",
    artist: "Uploader",
    album: "Album",
    sourceUrl: VIDEO_URL,
    extractorKey: "FakeExtractor",
    width: 640,
    height: 360,
    subtitle: null,
  });
  assert.match(result.jobId, /^[A-Za-z0-9_-]+$/);

  // The download used the video ceiling and the job's own work directory, and
  // the source was stored in the workspace the caller named.
  assert.equal(downloader.requests[0]?.maxBytes, VIDEO_LIMIT);
  assert.equal(
    downloader.requests[0]?.workDir,
    `/tmp/media-imports/owner1/${result.jobId}/download`,
  );
  assert.deepEqual(files.uploads, [
    {
      filePath: "/tmp/media-download/clip.mp4",
      fileName: "clip.mp4",
      contentType: "video/mp4",
      workspaceId: "workspace1",
    },
  ]);
  assert.equal(video.calls.length, 1);
  assert.equal(files.packagingCleanups(), 1);
  assert.equal(downloader.cleanups(), 1, "the download temp dir is removed");

  // The package is cached on the resource, as for an uploaded video.
  assert.equal(analysis.writes.length, 1);
  assert.equal(analysis.writes[0]?.hlsUrl, result.hlsUrl);

  // The job is completed and its directory is kept until `confirm`.
  const job = jobs.jobs.get(result.jobId);
  assert.equal(job?.state, "completed");
  assert.equal(job?.result?.url, result.url);
  assert.ok(!jobs.removed.includes(result.jobId));

  // Progress covers the phases in order and never retreats.
  const stages = new Set(updates.map((update) => update.stage));
  assert.ok(stages.has("downloading"));
  assert.ok(stages.has("storing"));
  assert.ok(stages.has("packaging"));
  for (let index = 1; index < updates.length; index += 1) {
    assert.ok(
      updates[index]!.percent >= updates[index - 1]!.percent,
      `progress went backwards: ${JSON.stringify(updates)}`,
    );
  }
  assert.equal(updates[0]?.jobId, result.jobId);
  assert.ok(updates.at(-1)!.percent < 100);
});

test("packages the downloaded file instead of fetching it back from the store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dbrain-media-source-"));
  const sourcePath = join(dir, "source.mp4");
  await writeFile(sourcePath, new Uint8Array([1, 2, 3]));

  try {
    const { commands, files, video } = service({
      downloader: { path: sourcePath },
    });

    await commands.import(VIDEO_COMMAND);

    // The download already wrote the bytes to disk; reading them back from the
    // file store would stream the whole video a second time.
    assert.deepEqual(files.tempDownloads, []);
    assert.equal(files.packagingCleanups(), 0, "no second copy to remove");
    assert.deepEqual(video.sources, [{ fileName: "source", path: sourcePath }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a site thumbnail is preferred over the FFmpeg poster frame", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dbrainx-media-test-"));
  const thumbnailPath = join(dir, "thumb.jpg");
  await writeFile(thumbnailPath, new Uint8Array([1, 2, 3, 4]));

  try {
    const { commands, files } = service({
      downloader: {
        thumbnail: { path: thumbnailPath, contentType: "image/jpeg" },
      },
    });

    const result = await commands.import(VIDEO_COMMAND);

    assert.equal(result.coverUrl, "/api/files/files/derived/cover.jpg");
    assert.deepEqual(files.derived[0], {
      sourceUrl: "/api/files/files/stored/source",
      fileName: "cover.jpg",
    });
    // The package still stores its own poster, but the site cover wins.
    assert.ok(
      files.derived.some((entry) => entry.fileName === "clip.cover.jpg"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a playable audio container is stored as downloaded", async () => {
  const { commands, files, audio, video } = service({
    downloader: {
      fileName: "track.mp3",
      contentType: "audio/mpeg",
      duration: 200,
    },
  });

  const result = await commands.import(AUDIO_COMMAND);

  assert.equal(result.url, "/api/files/files/stored/source");
  assert.equal(result.hlsUrl, "");
  assert.equal(result.coverUrl, "");
  assert.equal(result.width, 0);
  assert.equal(result.height, 0);
  assert.equal(result.duration, 200);
  assert.deepEqual(files.uploads[0], {
    filePath: "/tmp/media-download/track.mp3",
    fileName: "track.mp3",
    contentType: "audio/mpeg",
    workspaceId: "workspace1",
  });
  assert.equal(audio.requests.length, 0, "mp3 needs no conversion");
  assert.equal(video.calls.length, 0, "audio is never packaged as HLS");
  assert.equal(result.subtitle, null);
});

test("an unplayable audio container is converted before it is stored", async () => {
  const { commands, files, audio } = service({
    downloader: {
      fileName: "track.webm",
      contentType: "audio/webm",
      duration: 200,
    },
  });

  const result = await commands.import(AUDIO_COMMAND);

  assert.equal(audio.requests.length, 1);
  assert.equal(audio.requests[0]?.maxBytes, AUDIO_LIMIT);
  assert.equal(audio.requests[0]?.fileName, "track.webm");
  assert.equal(audio.cleanups(), 1, "the converted temp file is removed");
  assert.deepEqual(files.uploads[0], {
    filePath: "/tmp/converted/track.m4a",
    fileName: "track.m4a",
    contentType: "audio/mp4",
    workspaceId: "workspace1",
  });
  assert.equal(result.fileName, "track.m4a");
});

test("subtitle / lyric cues are returned with the result", async () => {
  const { commands } = service({
    downloader: {
      subtitle: {
        language: "zh-Hans",
        label: "中文",
        automatic: false,
        truncated: false,
        cues: [
          { timeMs: 0, endMs: 1000, content: "第一句" },
          { timeMs: 1000, content: "第二句" },
        ],
      },
    },
  });

  const result = await commands.import(VIDEO_COMMAND);

  assert.deepEqual(result.subtitle?.cues, [
    { timeMs: 0, endMs: 1000, content: "第一句" },
    { timeMs: 1000, content: "第二句" },
  ]);
  assert.equal(result.subtitle?.language, "zh-Hans");
});

/* ------------------------------------------------------------------------- */
/* Probe and format validation                                               */
/* ------------------------------------------------------------------------- */

test("a probe result is cached and an import must use its format id", async () => {
  const { commands, downloader, probe } = service();

  const first = await commands.probe(
    { url: VIDEO_URL, kind: "video" },
    "owner1",
  );
  const second = await commands.probe(
    { url: VIDEO_URL, kind: "video" },
    "owner1",
  );

  assert.equal(probe.requests.length, 1, "the second probe answers from cache");
  assert.equal(first.probeId, second.probeId);
  assert.equal(first.siteKey, "bilibili");
  assert.equal(first.qualities.length, 1);

  await commands.import({
    ...VIDEO_COMMAND,
    probeId: first.probeId,
    formatId: QUALITY.formatId,
  });
  assert.equal(downloader.requests[0]?.formatId, QUALITY.formatId);
});

test("an unknown format id is refused, and a stale probe is explicit", async () => {
  const { commands, jobs } = service();

  const probe = await commands.probe(
    { url: VIDEO_URL, kind: "video" },
    "owner1",
  );

  await assert.rejects(
    commands.import({
      ...VIDEO_COMMAND,
      probeId: probe.probeId,
      formatId: "not-offered",
    }),
    (error: unknown) =>
      error instanceof MediaImportFailure && error.code === "unsupported_url",
  );

  await assert.rejects(
    commands.import({ ...VIDEO_COMMAND, formatId: "137+140" }),
    (error: unknown) =>
      error instanceof MediaImportFailure && error.code === "probe_expired",
  );

  assert.equal(jobs.jobs.size, 0, "no job is created for a refused quality");
});

test("a login-required probe returns a login card instead of failing", async () => {
  const { commands } = service({
    probe: {
      failWith: new MediaImportFailure("login_required", "Sign in first"),
    },
    auth: [
      {
        auth: {
          siteKey: "bilibili",
          authMethod: "cookies-file",
          browserName: "",
          accountLabel: "",
          status: "verified",
          lastCheckedAt: "",
          lastUsedAt: "",
        },
        cookieText: "cookie",
      },
    ],
  });

  const result = await commands.probe(
    { url: VIDEO_URL, kind: "video" },
    "owner1",
  );

  assert.equal(result.requiresLogin, true);
  assert.equal(result.loggedIn, true);
  assert.equal(result.siteKey, "bilibili");
  assert.deepEqual(result.qualities, []);
});

test("qualities the owner cannot store are annotated with the reason", async () => {
  const categoryLimit = AUDIO_LIMIT + 1;
  const oversized: MediaQualityOption = {
    ...QUALITY,
    id: "lossless",
    formatId: "lossless",
    label: "无损",
    ext: "flac",
    estimatedBytes: categoryLimit,
  };
  const overQuota: MediaQualityOption = {
    ...QUALITY,
    id: "exhigh",
    formatId: "exhigh",
    label: "极高",
    estimatedBytes: 1000,
  };
  const best: MediaQualityOption = {
    ...QUALITY,
    id: "best",
    formatId: "best",
    label: "最佳",
    estimatedBytes: AUDIO_LIMIT * 4,
  };

  const { commands } = service({
    probe: { qualities: [best, oversized, overQuota] },
    usedBytes: 500,
    limits: { ...STORAGE_LIMITS, userQuotaBytes: 1200 },
  });

  const result = await commands.probe(
    { url: AUDIO_URL, kind: "audio" },
    "owner1",
  );

  const byId = new Map(
    result.qualities.map((quality) => [quality.id, quality]),
  );
  assert.equal(byId.get("best")?.disabledReason, undefined);
  assert.equal(byId.get("lossless")?.disabledReason, "category-limit");
  // 1000 bytes fits the category, but only 700 bytes of the 1200-byte quota remain.
  assert.equal(byId.get("exhigh")?.disabledReason, "quota");
  assert.equal(
    result.qualities.length,
    3,
    "no offered tier is removed by the annotation",
  );
});

test("a tier the adapter already disabled keeps its own reason", async () => {
  const unavailable: MediaQualityOption = {
    ...QUALITY,
    id: "2160p",
    formatId: "2160p",
    label: "2160p",
    estimatedBytes: 10,
    disabledReason: "unavailable",
  };

  const { commands } = service({ probe: { qualities: [unavailable] } });

  const result = await commands.probe(
    { url: VIDEO_URL, kind: "video" },
    "owner1",
  );

  assert.equal(result.qualities[0]?.disabledReason, "unavailable");
});

/* ------------------------------------------------------------------------- */
/* Failures                                                                  */
/* ------------------------------------------------------------------------- */

test("a download over the category limit removes its job", async () => {
  const { commands, files, downloader, jobs } = service({
    downloader: { fileSize: VIDEO_LIMIT + 1 },
  });

  await assert.rejects(commands.import(VIDEO_COMMAND), (error: unknown) => {
    assert.ok(error instanceof MediaImportFailure);
    assert.equal(error.code, "size_limit");
    return true;
  });

  assert.equal(files.uploads.length, 0);
  assert.equal(downloader.cleanups(), 1);
  assert.equal(jobs.jobs.size, 0, "a failed job is deleted immediately");
});

test("an import that would exceed the quota is refused", async () => {
  const { commands, files, usage, jobs } = service({
    usedBytes: 100,
    limits: { ...STORAGE_LIMITS, userQuotaBytes: 1050 },
  });

  await assert.rejects(commands.import(VIDEO_COMMAND), (error: unknown) => {
    assert.ok(error instanceof MediaImportFailure);
    assert.equal(error.code, "quota");
    assert.match(error.message, /50 of the 1050 byte quota remain/);
    return true;
  });

  assert.deepEqual(usage.owners, ["owner1"]);
  assert.equal(files.uploads.length, 0);
  assert.equal(jobs.jobs.size, 0);
});

test("a node that is already importing is refused with busy", async () => {
  const { commands, jobs, downloader } = service();
  await jobs.port.create({
    jobId: "existing-job",
    ownerId: "owner1",
    nodeId: "node1",
    kind: "video",
    url: VIDEO_URL,
    formatId: "",
    cookieVersion: "",
  });

  await assert.rejects(commands.import(VIDEO_COMMAND), (error: unknown) => {
    assert.ok(error instanceof MediaImportFailure);
    assert.equal(error.code, "busy");
    return true;
  });
  assert.equal(downloader.requests.length, 0);
});

test("one owner can run at most two imports at once", async () => {
  const { commands, downloader } = service({ downloader: { manual: true } });

  const first = commands.import({ ...VIDEO_COMMAND, nodeId: "node-a" });
  const second = commands.import({ ...VIDEO_COMMAND, nodeId: "node-b" });

  await waitFor(() => downloader.requests.length === 2);

  await assert.rejects(
    commands.import({ ...VIDEO_COMMAND, nodeId: "node-c" }),
    (error: unknown) =>
      error instanceof MediaImportFailure && error.code === "busy",
  );

  downloader.gates[0]?.resolve();
  downloader.gates[1]?.resolve();
  await Promise.allSettled([first, second]);
});

/* ------------------------------------------------------------------------- */
/* Progress, cancellation, recovery                                          */
/* ------------------------------------------------------------------------- */

test("an import honours the client job id so progress can be subscribed first", async () => {
  const { commands, jobs } = service();
  const updates: MediaImportProgress[] = [];

  const result = await commands.import(
    { ...VIDEO_COMMAND, jobId: "client-job-1" },
    (progress) => updates.push(progress),
  );

  assert.equal(result.jobId, "client-job-1");
  assert.ok(jobs.jobs.has("client-job-1"));
  assert.ok(updates.every((update) => update.jobId === "client-job-1"));
});

test("an unsafe client job id is replaced so it cannot become a path", async () => {
  const { commands } = service();

  const result = await commands.import({
    ...VIDEO_COMMAND,
    jobId: "../../escape",
  });

  assert.notEqual(result.jobId, "../../escape");
  assert.match(result.jobId, /^[A-Za-z0-9_-]{1,128}$/);
});

test("cancelling stops the downloader and removes the job", async () => {
  const { commands, downloader, jobs } = service({
    downloader: { manual: true },
  });

  const importing = commands.import(VIDEO_COMMAND);
  await waitFor(() => downloader.requests.length === 1);

  await commands.cancel("owner1", "node1");

  assert.deepEqual(downloader.cancelled, [
    `/tmp/media-imports/owner1/${jobs.removed[0]}/download`,
  ]);
  assert.equal(jobs.jobs.size, 0);

  downloader.gates[0]?.reject(new Error("killed"));
  await assert.rejects(importing, (error: unknown) => {
    assert.ok(error instanceof MediaImportFailure);
    assert.equal(error.code, "cancelled");
    return true;
  });
});

test("a finished job can be read back and confirmed", async () => {
  const { commands, jobs } = service();
  const result = await commands.import(VIDEO_COMMAND);

  const job = await commands.job("owner1", "node1");
  assert.equal(job?.jobId, result.jobId);
  assert.equal(job?.state, "completed");
  assert.equal(job?.result?.url, result.url);
  assert.equal(job?.errorCode, "");

  await commands.confirm("owner1", result.jobId);
  assert.equal(jobs.jobs.size, 0);
  assert.equal(await commands.job("owner1", "node1"), null);
});

test("sweep marks leftover running jobs interrupted and prunes old ones", async () => {
  const { commands, jobs } = service();

  await commands.sweep();

  assert.equal(jobs.markInterruptedCalls(), 1);
  assert.deepEqual(jobs.sweepTtls, [24 * 60 * 60 * 1000]);
});

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

/** Polls until `predicate` holds, yielding to the event loop between checks. */
async function waitFor(
  predicate: () => boolean,
  attempts = 200,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for the condition");
}
