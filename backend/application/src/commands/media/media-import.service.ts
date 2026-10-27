// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

import type {
  DownloadedRemoteMedia,
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
  MediaImportJobResult,
  MediaKind,
  MediaProbeResult,
  MediaQualityOption,
  MediaSiteDefinition,
  MediaSiteAuthSecret,
  VideoTranscodeProgressListener,
} from "@workspace/domain";
import type { MediaImportProgress } from "@workspace/interfaces";
// Imported through its source path for the same reason as `file-command.service`:
// the co-located test runs this module through Node's type-stripping loader,
// which does not resolve the workspace tsconfig paths. Both modules import
// nothing at runtime themselves, so the shared implementations stay single.
import { maxFileBytesFor } from "../../../../../packages/utils/src/storage-limits.ts";
import type { StorageLimits } from "../../../../../packages/utils/src/storage-limits.ts";
import { MediaImportFailure } from "../../../../../packages/utils/src/media-import.ts";
import { rewriteSegmentUrls } from "../file/hls-playlist.ts";
import type {
  ImportedMediaDTO,
  ImportMediaCommand,
  MediaImportJobDTO,
  MediaImportProgressListener,
  MediaProbeDTO,
  ProbeMediaCommand,
} from "./command";

/**
 * Shared video/audio import use case.
 *
 * One pipeline serves both kinds because a site import is the same work until
 * the file is stored: match the site, read its offer, download with yt-dlp,
 * check size and quota, store the source. What differs is the post-processing —
 * a video is packaged as HLS and gets a poster, an audio file is checked against
 * the containers `<audio>` can play (and converted when it is not) and gets a
 * cover. Those two strategies live in this class as branches, not as two
 * services.
 *
 * The service also owns the state that makes a long import survivable:
 *
 * - a **probe cache** (10 minutes, LRU 200) keyed by owner, kind, normalized URL
 *   and cookie version, with an unguessable `probeId` handed to the client;
 * - the **job store**, so a closed dialog, a reload, or a server restart can find
 *   the import again;
 * - the in-process **concurrency limit** (2 per owner, 4 globally);
 * - **progress**, published through the listener and persisted into the job so a
 *   reloaded page can show a resumed bar.
 *
 * A client-supplied `jobId` becomes a directory name and a progress channel key,
 * so it is validated here and replaced with a random id when it does not look
 * like one. `formatId` is never trusted from the client either: it must be a
 * format the same owner's probe actually offered.
 */

/** Jobs are kept for a day after they stop running, then swept. */
const MEDIA_IMPORT_JOB_TTL_MS = 24 * 60 * 60 * 1000;

/** A probe result is usable for ten minutes; past that the client re-probes. */
const PROBE_CACHE_TTL_MS = 10 * 60 * 1000;

/** Bound on cached probes; the oldest one is dropped when the cache is full. */
const PROBE_CACHE_LIMIT = 200;

/** Imports one owner may run at once. */
const MAX_IMPORTS_PER_OWNER = 2;

/** Imports the whole process may run at once. */
const MAX_IMPORTS_GLOBAL = 4;

/** Download takes the largest share of the bar; packaging follows it. */
const DOWNLOAD_PERCENT_END_VIDEO = 75;
const DOWNLOAD_PERCENT_END_AUDIO = 88;
const STORING_PERCENT_VIDEO = 78;
const STORING_PERCENT_AUDIO = 92;
const PACKAGING_PERCENT_START = 80;
const PACKAGING_PERCENT_END = 99;
const PREPARING_PERCENT_START = 94;
const PREPARING_PERCENT_COVER = 96;
const PREPARING_PERCENT_END = 99;

/** A job record is written at most this often while progress streams in. */
const PROGRESS_PERSIST_INTERVAL_MS = 1000;

/**
 * Containers an `<audio>` element can play directly. An imported file in one of
 * these is stored as-is; anything else goes through `IAudioTranscoder`.
 */
const PLAYABLE_AUDIO_CONTAINERS = new Set([
  "mp3",
  "m4a",
  "aac",
  "ogg",
  "oga",
  "opus",
  "wav",
  "flac",
  "weba",
]);

/** A job id that is safe to use as a directory name and a channel key. */
const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** One cached probe, reachable by URL key and by `probeId`. */
interface ProbeCacheEntry {
  probeId: string;
  ownerId: string;
  kind: MediaKind;
  /** Normalized URL the probe answered. */
  urlKey: string;
  /** Cookie (or browser) tag the probe ran with; a changed login re-probes. */
  cookieVersion: string;
  result: MediaProbeResult;
  /** Format ids the probe offered, so an import cannot inject its own. */
  formatIds: Set<string>;
  expiresAt: number;
}

/** The login state one import runs with, resolved once per call. */
interface ResolvedSiteLogin {
  site: MediaSiteDefinition | null;
  cookies?: string;
  cookiesFromBrowser?: string;
  cookieVersion: string;
  loggedIn: boolean;
}

/** Maps a thrown error onto a classified failure the router can serialize. */
function toFailure(error: unknown): MediaImportFailure {
  if (error instanceof MediaImportFailure) return error;
  const message =
    error instanceof Error
      ? error.message
      : String(error || "The import failed");
  return new MediaImportFailure("unknown", message);
}

/** Lower-case extension of a file name, without the dot, or `""`. */
function fileExtension(fileName: string): string {
  const extension = extname(fileName);
  return extension.startsWith(".") ? extension.slice(1).toLowerCase() : "";
}

/** Name of the stored file a file-store address points at. */
function fileNameFromUrl(fileUrl: string): string {
  try {
    const pathname = new URL(fileUrl, "http://file.invalid").pathname;
    const last = pathname.split("/").pop() ?? "";
    return decodeURIComponent(last) || "media";
  } catch {
    return "media";
  }
}

/** One safe path segment built from a stored file name. */
function safeSegment(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_");
  return cleaned || "media";
}

/** Suffix of the temporary copy, taken from the stored name. */
function sourceSuffix(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return ".bin";
  const suffix = safeSegment(fileName.slice(dot));
  return suffix.startsWith(".") && suffix.length > 1
    ? suffix.slice(0, 12)
    : ".bin";
}

/** Normalized form of a URL, used as a probe cache key. */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url.trim();
  }
}

/** A client-supplied job id when it is safe, otherwise a server-generated one. */
function resolveJobId(raw: string | undefined): string {
  const candidate = (raw ?? "").trim();
  return JOB_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

export class MediaImportService {
  /**
   * Plain field assignments rather than parameter properties: the co-located
   * test runs this module through Node's type-stripping loader (`node --test`),
   * which rejects TypeScript-only syntax that has a runtime effect.
   */
  private readonly downloader: IMediaDownloader;
  private readonly probePort: IMediaProbe;
  private readonly videoTranscoder: IVideoTranscoder;
  private readonly audioTranscoder: IAudioTranscoder;
  private readonly fileStore: IFileStore;
  private readonly analysis: IMediaAnalysisStore;
  private readonly jobStore: IMediaImportJobStore;
  private readonly sites: IMediaSiteCatalog;
  private readonly siteAuth: IMediaSiteAuthRepository;
  private readonly storageUsage: IStorageUsageReader;
  private readonly storageLimits: StorageLimits;

  /** Probe results by normalized URL + kind + cookie version. Insertion ordered. */
  private readonly probeCache = new Map<string, ProbeCacheEntry>();
  /** Probe results by the id handed to the client, for `formatId` validation. */
  private readonly probesById = new Map<string, ProbeCacheEntry>();
  /** Imports this process is running right now: job id → owner id. */
  private readonly runningImports = new Map<string, string>();

  constructor(
    downloader: IMediaDownloader,
    probe: IMediaProbe,
    videoTranscoder: IVideoTranscoder,
    audioTranscoder: IAudioTranscoder,
    fileStore: IFileStore,
    analysis: IMediaAnalysisStore,
    jobStore: IMediaImportJobStore,
    sites: IMediaSiteCatalog,
    siteAuth: IMediaSiteAuthRepository,
    storageUsage: IStorageUsageReader,
    storageLimits: StorageLimits,
  ) {
    this.downloader = downloader;
    this.probePort = probe;
    this.videoTranscoder = videoTranscoder;
    this.audioTranscoder = audioTranscoder;
    this.fileStore = fileStore;
    this.analysis = analysis;
    this.jobStore = jobStore;
    this.sites = sites;
    this.siteAuth = siteAuth;
    this.storageUsage = storageUsage;
    this.storageLimits = storageLimits;
  }

  /**
   * Reads what one address offers without downloading it.
   *
   * The probe runs with the owner's saved login when there is one, and the
   * answer is cached under the cookie version so logging in invalidates it. When
   * the site refuses the anonymous request the call does not fail: it returns an
   * empty card with `requiresLogin: true`, which is what tells the UI to offer
   * the login panel instead of an error.
   */
  async probe(cmd: ProbeMediaCommand, ownerId: string): Promise<MediaProbeDTO> {
    const urlKey = normalizeUrl(cmd.url);
    const login = await this.resolveSiteLogin(ownerId, cmd.url);
    const cacheKey = [ownerId, cmd.kind, urlKey, login.cookieVersion].join(
      "\u0000",
    );

    const cached = this.probeCache.get(cacheKey);
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        // Touch the entry so the LRU evicts the least recently used probe.
        this.probeCache.delete(cacheKey);
        this.probeCache.set(cacheKey, cached);
        return this.toProbeDTO(cached, login.loggedIn, ownerId);
      }
      this.evictProbe(cacheKey, cached.probeId);
    }

    let result: MediaProbeResult;
    try {
      result = await this.probePort.probe({
        url: cmd.url,
        kind: cmd.kind,
        cookies: login.cookies,
        cookiesFromBrowser: login.cookiesFromBrowser,
      });
    } catch (error) {
      const failure = toFailure(error);
      if (
        login.site &&
        (failure.code === "login_required" || failure.code === "login_expired")
      ) {
        // A saved login that stopped working is a fact worth persisting, so the
        // capsules show it without waiting for the next probe to fail.
        await this.siteAuth
          .setStatus(ownerId, login.site.key, "expired")
          .catch(() => undefined);
      }
      if (login.site && failure.code === "login_required") {
        return {
          probeId: randomUUID(),
          kind: cmd.kind,
          siteKey: login.site.key,
          title: "",
          artist: "",
          album: "",
          duration: 0,
          thumbnailDataUrl: null,
          requiresLogin: true,
          loggedIn: login.loggedIn,
          subtitleLanguages: [],
          qualities: [],
        };
      }
      throw failure;
    }

    const entry: ProbeCacheEntry = {
      probeId: randomUUID(),
      ownerId,
      kind: cmd.kind,
      urlKey,
      cookieVersion: login.cookieVersion,
      result,
      formatIds: new Set(result.qualities.map((quality) => quality.formatId)),
      expiresAt: Date.now() + PROBE_CACHE_TTL_MS,
    };
    this.probeCache.set(cacheKey, entry);
    this.probesById.set(entry.probeId, entry);
    this.evictOverflow();

    return this.toProbeDTO(entry, login.loggedIn, ownerId);
  }

  /**
   * Downloads, stores, and post-processes one address, recording a job so the
   * client can recover the import after a reload.
   *
   * `onProgress` is optional and best effort: it is called for every phase and,
   * while downloading, with the site's own byte counters. The returned job id is
   * the client's when it sent a valid one, so the progress subscription opened
   * before the mutation receives every update.
   */
  async import(
    cmd: ImportMediaCommand,
    onProgress?: MediaImportProgressListener,
  ): Promise<ImportedMediaDTO> {
    const jobId = resolveJobId(cmd.jobId);
    const ownerId = cmd.ownerId;

    // A node runs one import at a time; the check uses the job store so it also
    // sees a job another process (or the previous run) left `running`.
    const existing = await this.jobStore.findForNode(ownerId, cmd.nodeId);
    if (existing && existing.state === "running") {
      throw new MediaImportFailure(
        "busy",
        "This node is already importing; wait for it to finish or cancel it",
      );
    }
    this.assertCapacity(ownerId);

    // Validate the chosen quality against the cached probe *before* any work.
    const formatId = this.resolveFormatId(cmd);
    const login = await this.resolveSiteLogin(ownerId, cmd.url);

    this.runningImports.set(jobId, ownerId);
    try {
      await this.jobStore.create({
        jobId,
        ownerId,
        nodeId: cmd.nodeId,
        kind: cmd.kind,
        url: cmd.url.trim(),
        formatId,
        cookieVersion: login.cookieVersion,
      });
    } catch (error) {
      this.runningImports.delete(jobId);
      throw toFailure(error);
    }

    // Progress state is shared by the download, storing, and post-processing
    // steps, and never moves backwards: each source reports its own fraction.
    let highestPercent = 0;
    let stage: MediaImportProgress["stage"] = "downloading";
    let lastPersistedAt = 0;
    let downloadedBytes = 0;
    let totalBytes = 0;
    let speedBytesPerSecond = 0;
    let etaSeconds = 0;

    const emit = (
      nextStage: MediaImportProgress["stage"],
      percent: number,
      throttle = true,
    ): void => {
      const stageChanged = nextStage !== stage;
      highestPercent = Math.min(99, Math.max(highestPercent, percent));
      stage = nextStage;

      if (onProgress) {
        const progress: MediaImportProgress = {
          jobId,
          nodeId: cmd.nodeId,
          kind: cmd.kind,
          stage,
          percent: Math.round(highestPercent),
          downloadedBytes,
          totalBytes,
          speedBytesPerSecond,
          etaSeconds,
        };
        try {
          onProgress(progress);
        } catch {
          // A subscriber must never fail the import it is watching.
        }
      }

      const now = Date.now();
      if (
        throttle &&
        !stageChanged &&
        now - lastPersistedAt < PROGRESS_PERSIST_INTERVAL_MS
      ) {
        return;
      }
      lastPersistedAt = now;
      void this.jobStore
        .update(ownerId, jobId, { stage, percent: Math.round(highestPercent) })
        .catch(() => undefined);
    };

    const downloadPercentEnd =
      cmd.kind === "video"
        ? DOWNLOAD_PERCENT_END_VIDEO
        : DOWNLOAD_PERCENT_END_AUDIO;

    let downloaded: DownloadedRemoteMedia | undefined;
    let conversionCleanup: (() => Promise<void>) | undefined;

    try {
      emit("downloading", 0, false);
      downloaded = await this.downloader.download(
        {
          url: cmd.url.trim(),
          kind: cmd.kind,
          maxBytes:
            cmd.kind === "video"
              ? this.storageLimits.maxFileBytes.video
              : this.storageLimits.maxFileBytes.audio,
          formatId: formatId || undefined,
          cookies: login.cookies,
          cookiesFromBrowser: login.cookiesFromBrowser,
          workDir: this.jobStore.workDir(ownerId, jobId),
        },
        onProgress
          ? (progress) => {
              downloadedBytes = progress.downloadedBytes;
              totalBytes = progress.totalBytes;
              speedBytesPerSecond = progress.speedBytesPerSecond;
              etaSeconds = progress.etaSeconds;
              // A site that declares no size leaves the bar where it is; only
              // an honest fraction is reported.
              emit(
                "downloading",
                progress.totalBytes > 0
                  ? (progress.downloadedBytes / progress.totalBytes) *
                      downloadPercentEnd
                  : highestPercent,
              );
            }
          : undefined,
      );
      emit("downloading", downloadPercentEnd, false);

      // The ceiling is re-derived from the download's real name and type: the
      // site decides the format, and the client only picked a tier.
      await this.assertWithinStorageLimits(downloaded, ownerId);

      let storePath = downloaded.path;
      let storeFileName = downloaded.fileName;
      let storeContentType = downloaded.contentType;

      if (cmd.kind === "video") {
        emit("storing", STORING_PERCENT_VIDEO, false);
      } else {
        emit("storing", STORING_PERCENT_AUDIO, false);
        if (
          !PLAYABLE_AUDIO_CONTAINERS.has(fileExtension(downloaded.fileName))
        ) {
          emit("preparing", PREPARING_PERCENT_START, false);
          const converted = await this.audioTranscoder.ensurePlayable({
            fileName: downloaded.fileName,
            path: downloaded.path,
            maxBytes: this.storageLimits.maxFileBytes.audio,
          });
          conversionCleanup = converted.cleanup;
          storePath = converted.path;
          storeFileName = converted.fileName;
          storeContentType = converted.contentType;
        }
      }

      const stored = await this.fileStore.uploadFromPath(
        storePath,
        storeFileName,
        storeContentType,
        cmd.workspaceId,
      );
      const fileSize = await this.fileStore.stat(stored.url);
      const coverUrl = await this.storeThumbnail(downloaded, stored.url);

      let hlsUrl = "";
      let width = 0;
      let height = 0;
      let duration = downloaded.duration;

      if (cmd.kind === "video") {
        emit("packaging", PACKAGING_PERCENT_START, false);
        let packagedCoverUrl = "";
        try {
          const packaged = await this.packageVideo(
            stored.url,
            downloaded.path,
            onProgress
              ? (progress: { percent: number }) => {
                  emit(
                    "packaging",
                    PACKAGING_PERCENT_START +
                      (progress.percent / 100) *
                        (PACKAGING_PERCENT_END - PACKAGING_PERCENT_START),
                  );
                }
              : undefined,
          );
          hlsUrl = packaged.hlsUrl;
          packagedCoverUrl = packaged.coverUrl;
          width = packaged.width;
          height = packaged.height;
          if (packaged.duration > 0) duration = packaged.duration;
        } catch (error) {
          // Best effort, like an uploaded video: the stored source still plays
          // for a codec the browser decodes, so a packaging failure must not
          // throw away a successful download.
          console.warn(
            "[MediaImportService] HLS packaging of an imported video failed",
            error,
          );
        }
        emit("packaging", PACKAGING_PERCENT_END, false);
        const finalCoverUrl = coverUrl || packagedCoverUrl;
        return await this.completeJob(
          ownerId,
          jobId,
          {
            jobId,
            fileName: storeFileName,
            url: stored.url,
            coverUrl: finalCoverUrl,
            hlsUrl,
            duration,
            fileSize,
            title: downloaded.title,
            artist: downloaded.artist,
            album: downloaded.album,
            sourceUrl: downloaded.sourceUrl,
            extractorKey: downloaded.extractorKey,
            width,
            height,
            subtitle: downloaded.subtitle,
          },
          login,
        );
      }

      emit("preparing", PREPARING_PERCENT_COVER, false);
      emit("preparing", PREPARING_PERCENT_END, false);
      return await this.completeJob(
        ownerId,
        jobId,
        {
          jobId,
          fileName: storeFileName,
          url: stored.url,
          coverUrl,
          hlsUrl: "",
          duration,
          fileSize,
          title: downloaded.title,
          artist: downloaded.artist,
          album: downloaded.album,
          sourceUrl: downloaded.sourceUrl,
          extractorKey: downloaded.extractorKey,
          width: 0,
          height: 0,
          subtitle: downloaded.subtitle,
        },
        login,
      );
    } catch (error) {
      const failure = toFailure(error);
      // A cancelled job has already lost its directory. That is the signal that
      // distinguishes "the user cancelled" from a genuine download failure.
      let cancelled = false;
      try {
        cancelled = (await this.jobStore.read(ownerId, jobId)) === null;
      } catch {
        cancelled = false;
      }
      await this.jobStore.remove(ownerId, jobId).catch(() => undefined);
      if (cancelled) {
        throw new MediaImportFailure("cancelled", "The import was cancelled");
      }
      throw failure;
    } finally {
      this.runningImports.delete(jobId);
      if (conversionCleanup) await conversionCleanup().catch(() => undefined);
      if (downloaded) await downloaded.cleanup().catch(() => undefined);
    }
  }

  /** The newest import job of one node, for the resume / recovery dialog. */
  async job(
    ownerId: string,
    nodeId: string,
  ): Promise<MediaImportJobDTO | null> {
    const job = await this.jobStore.findForNode(ownerId, nodeId);
    return job ? this.toJobDTO(job) : null;
  }

  /** Removes a completed job once its result is on the client's node. */
  async confirm(ownerId: string, jobId: string): Promise<void> {
    await this.jobStore.remove(ownerId, jobId);
  }

  /** Stops the import of one node and removes its partial files. */
  async cancel(ownerId: string, nodeId: string): Promise<void> {
    const job = await this.jobStore.findForNode(ownerId, nodeId);
    if (!job) return;

    this.runningImports.delete(job.jobId);
    await this.downloader
      .cancel(this.jobStore.workDir(ownerId, job.jobId))
      .catch(() => undefined);
    await this.jobStore.remove(ownerId, job.jobId);
  }

  /**
   * Startup and periodic housekeeping: jobs left `running` by a process that no
   * longer exists become `interrupted` (resumable for a day), and stale
   * `interrupted` / confirmed `completed` directories are removed.
   */
  async sweep(): Promise<void> {
    await this.jobStore.markInterrupted();
    await this.jobStore.sweep(MEDIA_IMPORT_JOB_TTL_MS);
  }

  /** Rejects when this owner or the process already runs the maximum imports. */
  private assertCapacity(ownerId: string): void {
    let ownerRunning = 0;
    for (const runningOwner of this.runningImports.values()) {
      if (runningOwner === ownerId) ownerRunning += 1;
    }
    if (ownerRunning >= MAX_IMPORTS_PER_OWNER) {
      throw new MediaImportFailure(
        "busy",
        `At most ${MAX_IMPORTS_PER_OWNER} imports can run at once; wait for one to finish`,
      );
    }
    if (this.runningImports.size >= MAX_IMPORTS_GLOBAL) {
      throw new MediaImportFailure(
        "busy",
        `The server is busy importing; at most ${MAX_IMPORTS_GLOBAL} imports can run at once`,
      );
    }
  }

  /**
   * Validates the client's chosen `formatId` against the server's probe cache.
   *
   * The client never supplies a raw yt-dlp argument: a format id that no probe
   * for this owner, kind, URL, and cookie version offered is refused, which also
   * makes a stale `probeId` an explicit `probe_expired` instead of a silent
   * "best available" download.
   */
  private resolveFormatId(cmd: ImportMediaCommand): string {
    const formatId = (cmd.formatId ?? "").trim();
    if (!formatId) return "";

    const probeId = (cmd.probeId ?? "").trim();
    if (!probeId) {
      throw new MediaImportFailure(
        "probe_expired",
        "The quality choice expired; parse the address again",
      );
    }

    const entry = this.probesById.get(probeId);
    if (
      !entry ||
      entry.expiresAt <= Date.now() ||
      entry.ownerId !== cmd.ownerId ||
      entry.kind !== cmd.kind ||
      entry.urlKey !== normalizeUrl(cmd.url)
    ) {
      if (entry && entry.expiresAt <= Date.now()) {
        this.probesById.delete(probeId);
      }
      throw new MediaImportFailure(
        "probe_expired",
        "The quality choice expired; parse the address again",
      );
    }

    if (!entry.formatIds.has(formatId)) {
      throw new MediaImportFailure(
        "unsupported_url",
        "That quality is not available for this address; parse it again",
      );
    }

    return formatId;
  }

  /** Resolves the owner's saved login for the matched site, if any. */
  private async resolveSiteLogin(
    ownerId: string,
    url: string,
  ): Promise<ResolvedSiteLogin> {
    const site = this.sites.match(url);
    if (!site) {
      return { site: null, cookieVersion: "", loggedIn: false };
    }

    const saved = await this.siteAuth.find(ownerId, site.key);
    if (!saved) {
      return { site, cookieVersion: "", loggedIn: false };
    }

    if (saved.authMethod === "browser") {
      return {
        site,
        cookiesFromBrowser: saved.browserName,
        cookieVersion: `browser:${saved.browserName}`,
        loggedIn: true,
      };
    }

    const secret: MediaSiteAuthSecret | null = await this.siteAuth.readSecret(
      ownerId,
      site.key,
    );
    if (!secret) {
      return { site, cookieVersion: "", loggedIn: false };
    }
    return {
      site,
      cookies: secret.cookieText,
      cookieVersion: secret.version,
      loggedIn: true,
    };
  }

  /** Enforces the per-category ceiling and the owner's remaining quota. */
  private async assertWithinStorageLimits(
    downloaded: DownloadedRemoteMedia,
    ownerId: string,
  ): Promise<void> {
    const categoryLimit = maxFileBytesFor(
      this.storageLimits,
      downloaded.fileName,
      downloaded.contentType,
    );
    if (downloaded.fileSize > categoryLimit) {
      throw new MediaImportFailure(
        "size_limit",
        `The file is ${downloaded.fileSize} bytes; the limit is ${categoryLimit}`,
      );
    }

    if (this.storageLimits.userQuotaBytes <= 0) return;
    const used = await this.storageUsage.usageFor(ownerId);
    if (used + downloaded.fileSize > this.storageLimits.userQuotaBytes) {
      throw new MediaImportFailure(
        "quota",
        `The file needs ${downloaded.fileSize} bytes but only ${Math.max(
          0,
          this.storageLimits.userQuotaBytes - used,
        )} of the ${this.storageLimits.userQuotaBytes} byte quota remain`,
      );
    }
  }

  /**
   * Stores the site thumbnail as a derived image when it is usable.
   *
   * The adapter already capped the thumbnail and wrote it into the job
   * directory; reading it here is the only way to hand its bytes to
   * `uploadDerived` (which is what marks it as belonging to the source record).
   * A too-large or unreadable thumbnail is skipped, not fatal: the video path
   * still falls back to the FFmpeg poster frame.
   */
  private async storeThumbnail(
    downloaded: DownloadedRemoteMedia,
    sourceUrl: string,
  ): Promise<string> {
    const thumbnail = downloaded.thumbnail;
    if (!thumbnail) return "";

    try {
      const bytes = await readFile(thumbnail.path);
      const extension = extname(thumbnail.path) || ".jpg";
      const fileName = `cover${extension.toLowerCase()}`;
      const limit = maxFileBytesFor(
        this.storageLimits,
        fileName,
        thumbnail.contentType,
      );
      if (bytes.byteLength > limit) return "";

      return await this.fileStore.uploadDerived(sourceUrl, {
        fileName,
        contentType: thumbnail.contentType,
        bytes: new Uint8Array(bytes),
      });
    } catch (error) {
      console.warn("[MediaImportService] cover upload failed", error);
      return "";
    }
  }

  /**
   * Packages a stored video as HLS, reusing the resource analysis cache.
   *
   * This is the same work `FileCommandService` does for an uploaded video, kept
   * private here because the two services have different dependencies and the
   * contract keeps them independent. A package already cached on the resource
   * answers without another download or FFmpeg run.
   *
   * `localPath` is the file the download just wrote. An import has the source on
   * this machine already, so the transcoder reads that file and the store is not
   * asked to hand the same bytes back; only a packaging call without a local
   * file (a cache miss for a resource someone else imported) downloads it.
   */
  private async packageVideo(
    fileUrl: string,
    localPath?: string,
    onProgress?: VideoTranscodeProgressListener,
  ): Promise<{
    hlsUrl: string;
    coverUrl: string;
    duration: number;
    width: number;
    height: number;
  }> {
    const cached = await this.analysis.read(fileUrl);
    if (cached && cached.hlsUrl !== "") {
      return {
        hlsUrl: cached.hlsUrl,
        coverUrl: cached.coverUrl,
        duration: cached.duration,
        width: cached.width,
        height: cached.height,
      };
    }

    const fileName = fileNameFromUrl(fileUrl);
    let source: { path: string; cleanup: () => Promise<void> };
    const local = localPath ? await stat(localPath).catch(() => null) : null;
    if (localPath && local?.isFile() && local.size > 0) {
      // The download owns this file; the work directory is removed with the
      // job, so there is nothing to clean up on this path.
      source = { path: localPath, cleanup: () => Promise.resolve() };
    } else {
      source = await this.fileStore.downloadToTempFile(
        fileUrl,
        sourceSuffix(fileName),
      );
    }

    try {
      const result = await this.videoTranscoder.transcodeToHls(
        { fileName, path: source.path },
        onProgress,
      );

      const storedSegments: { fileName: string; url: string }[] = [];
      for (const segment of result.segments) {
        storedSegments.push({
          fileName: segment.fileName,
          url: await this.fileStore.uploadDerived(fileUrl, segment),
        });
      }

      const playlist = rewriteSegmentUrls(result.playlist, storedSegments);
      const hlsUrl = await this.fileStore.uploadDerived(fileUrl, playlist);
      let coverUrl = "";
      if (result.cover) {
        try {
          coverUrl = await this.fileStore.uploadDerived(fileUrl, result.cover);
        } catch (error) {
          console.warn(
            "[MediaImportService] poster frame upload failed",
            error,
          );
        }
      }

      // Best effort: a resource the caller does not own is packaged but not
      // cached, and the next caller packages it again.
      await this.analysis.write(fileUrl, {
        hlsUrl,
        coverUrl,
        duration: result.duration,
        width: result.width,
        height: result.height,
      });

      return {
        hlsUrl,
        coverUrl,
        duration: result.duration,
        width: result.width,
        height: result.height,
      };
    } finally {
      await source.cleanup();
    }
  }

  /** Marks a job completed, records the login use, and returns the client DTO. */
  private async completeJob(
    ownerId: string,
    jobId: string,
    result: ImportedMediaDTO,
    login: ResolvedSiteLogin,
  ): Promise<ImportedMediaDTO> {
    const jobResult: MediaImportJobResult = {
      fileName: result.fileName,
      url: result.url,
      coverUrl: result.coverUrl,
      hlsUrl: result.hlsUrl,
      duration: result.duration,
      fileSize: result.fileSize,
      title: result.title,
      artist: result.artist,
      album: result.album,
      sourceUrl: result.sourceUrl,
      extractorKey: result.extractorKey,
      width: result.width,
      height: result.height,
      subtitle: result.subtitle,
    };

    await this.jobStore.update(ownerId, jobId, {
      state: "completed",
      percent: 100,
      result: jobResult,
    });

    if (login.site && login.loggedIn) {
      await this.siteAuth.touch(ownerId, login.site.key).catch(() => undefined);
    }

    return result;
  }

  /** Drops the oldest probe once the cache is over its limit. */
  private evictOverflow(): void {
    while (this.probeCache.size > PROBE_CACHE_LIMIT) {
      const oldestKey = this.probeCache.keys().next().value;
      if (oldestKey === undefined) return;
      const oldest = this.probeCache.get(oldestKey);
      if (oldest) this.evictProbe(oldestKey, oldest.probeId);
      else this.probeCache.delete(oldestKey);
    }
  }

  /** Removes one entry from both cache indexes. */
  private evictProbe(cacheKey: string, probeId: string): void {
    this.probeCache.delete(cacheKey);
    this.probesById.delete(probeId);
  }

  /**
   * Maps a cached probe onto the client DTO.
   *
   * The offered qualities are annotated with the reasons *this owner* cannot
   * use them. The cache is owner-scoped by key, but the storage figures can
   * change between two probes, so the annotation runs per response instead of
   * being frozen into the cache entry.
   */
  private async toProbeDTO(
    entry: ProbeCacheEntry,
    loggedIn: boolean,
    ownerId: string,
  ): Promise<MediaProbeDTO> {
    const result = entry.result;
    return {
      probeId: entry.probeId,
      kind: result.kind,
      siteKey: result.siteKey,
      title: result.title,
      artist: result.artist,
      album: result.album,
      duration: result.duration,
      thumbnailDataUrl: result.thumbnailDataUrl,
      requiresLogin: result.requiresLogin,
      loggedIn,
      subtitleLanguages: result.subtitleLanguages,
      qualities: await this.annotateQualities(result, ownerId),
    };
  }

  /**
   * Marks the offered tiers the current user cannot store.
   *
   * `best` is always enabled: it is the fallback the picker preselects, and the
   * server enforces the real ceiling again at import time. A size that cannot be
   * estimated (`estimatedBytes === 0`) is left enabled for the same reason.
   *
   * A tier that "needs a login" is deliberately *not* guessed: the probe is the
   * only source of what the site offers, and it returns the anonymous list when
   * the owner is logged out. Which tiers a login would add is not in that
   * answer, so the tiers are shown as offered instead of greying out one that
   * actually works anonymously. An adapter that marks a tier itself keeps its
   * `unavailable` reason.
   */
  private async annotateQualities(
    result: MediaProbeResult,
    ownerId: string,
  ): Promise<MediaQualityOption[]> {
    const categoryLimit =
      result.kind === "video"
        ? this.storageLimits.maxFileBytes.video
        : this.storageLimits.maxFileBytes.audio;

    let remainingQuota: number | null = null;
    if (this.storageLimits.userQuotaBytes > 0) {
      try {
        const used = await this.storageUsage.usageFor(ownerId);
        remainingQuota = Math.max(0, this.storageLimits.userQuotaBytes - used);
      } catch {
        // The picker is a hint; a failed usage read must not fail the probe.
        remainingQuota = null;
      }
    }

    return result.qualities.map((quality) => {
      // `best` and anything the adapter already disabled stay as they are.
      if (quality.id === "best" || quality.disabledReason) return quality;

      const estimatedBytes = quality.estimatedBytes;
      if (estimatedBytes <= 0) return quality;
      if (estimatedBytes > categoryLimit) {
        return { ...quality, disabledReason: "category-limit" };
      }
      if (remainingQuota !== null && estimatedBytes > remainingQuota) {
        return { ...quality, disabledReason: "quota" };
      }
      return quality;
    });
  }

  /** Maps a stored job onto the client DTO. */
  private toJobDTO(job: MediaImportJob): MediaImportJobDTO {
    return {
      jobId: job.jobId,
      nodeId: job.nodeId,
      kind: job.kind,
      url: job.url,
      formatId: job.formatId,
      state: job.state,
      stage: job.stage,
      percent: job.percent,
      result: job.result
        ? {
            jobId: job.jobId,
            fileSize: job.result.fileSize,
            fileName: job.result.fileName,
            url: job.result.url,
            coverUrl: job.result.coverUrl,
            hlsUrl: job.result.hlsUrl,
            duration: job.result.duration,
            title: job.result.title,
            artist: job.result.artist,
            album: job.result.album,
            sourceUrl: job.result.sourceUrl,
            extractorKey: job.result.extractorKey,
            width: job.result.width,
            height: job.result.height,
            subtitle: job.result.subtitle,
          }
        : null,
      // A failed job is deleted immediately, so a stored job never carries an
      // error; the fields stay in the wire shape for the UI's convenience.
      errorCode: "",
      errorMessage: "",
    };
  }
}
