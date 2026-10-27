// SPDX-License-Identifier: AGPL-3.0-only

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@workspace/adapter-front";
import type {
  MediaImportErrorCode,
  MediaImportProgress,
  MediaKind,
} from "@workspace/interfaces";
import { readMediaImportError } from "@workspace/utils/media-import";
import { trpcClient } from "./trpc/client";

/**
 * Server-side file analysis and the shared video/audio site import.
 *
 * Uploading is a direct browser → PocketBase transfer (see `./upload`), so once
 * the blob is stored the client only has to hand its address to the backend.
 * Parsing — and, for PDFs, rasterizing a cover — happens there.
 *
 * The media import goes the other way: the bytes live on a site, the server
 * downloads them with yt-dlp, stores them and post-processes them. It shares one
 * API for video and audio; only `kind` and the resulting node content differ.
 */

/** Parameters the backend reads out of an uploaded PDF. */
export type PdfAnalysis = inferRouterOutputs<AppRouter>["file"]["analyzePdf"];

/**
 * Asks the backend to parse the PDF at `fileUrl` and to store a cover of its
 * first page, resolving to `{ pageCount, fileSize, pageWidth, pageHeight,
 * coverUrl, info }`.
 *
 * Rejects when the document cannot be fetched or parsed (e.g. a
 * password-protected file); callers that can live without the metadata should
 * fall back rather than fail the upload.
 */
export async function analyzePdf(fileUrl: string): Promise<PdfAnalysis> {
  return trpcClient.file.analyzePdf.mutate({ fileUrl });
}

/**
 * The HLS package the backend built from an uploaded video, plus the parameters
 * it read off it: `{ hlsUrl, coverUrl, duration, width, height, videoCodec,
 * audioCodec, reencoded }`.
 */
export type VideoTranscode =
  inferRouterOutputs<AppRouter>["file"]["transcodeVideo"];

/**
 * Asks the backend to package the video at `fileUrl` as HLS.
 *
 * This is what makes an upload playable at all: a phone records HEVC, which
 * desktop browsers cannot decode, and the packaged playlist carries a codec they
 * can. `hlsUrl` is the playlist the node should store; the original `fileUrl`
 * stays the fallback. Rejects when the video cannot be read by the transcoder —
 * callers keep the plain upload in that case.
 */
export async function transcodeVideo(fileUrl: string): Promise<VideoTranscode> {
  return trpcClient.file.transcodeVideo.mutate({ fileUrl });
}

/* ------------------------------------------------------------------------- */
/* Shared video/audio site import                                            */
/* ------------------------------------------------------------------------- */

/** A video or an audio file downloaded from a site and stored by the backend. */
export type ImportedMedia =
  inferRouterOutputs<AppRouter>["file"]["importMedia"];

/** What one address offers: metadata, login state, subtitle tracks, qualities. */
export type MediaProbe =
  inferRouterOutputs<AppRouter>["file"]["probeMediaSource"];

/** The listed sites with the caller's saved login state and method A's browsers. */
export type MediaSites = inferRouterOutputs<AppRouter>["file"]["mediaSites"];

/** One listed site as the capsule row renders it. */
export type MediaSite = MediaSites["sites"][number];

/** The newest import job of one node, or `null` when there is none. */
export type MediaImportJob =
  inferRouterOutputs<AppRouter>["file"]["mediaImportJob"];

/** Outcome of importing one exported `cookies.txt`. */
export type MediaCookieImport =
  inferRouterOutputs<AppRouter>["file"]["importMediaCookies"];

/**
 * A media import / probe request the server classified.
 *
 * The reason travels as a stable code so the UI can act on it (highlight the
 * site capsule for `login_required`, suggest a lower quality for `size_limit`)
 * without matching the sentence. The message has the wire prefix removed.
 */
export class MediaImportRequestError extends Error {
  /** Stable reason the server reported. */
  readonly code: MediaImportErrorCode;

  constructor(code: MediaImportErrorCode, message: string) {
    super(message);
    this.name = "MediaImportRequestError";
    this.code = code;
  }
}

/** Runs one request and rethrows a classified failure as a typed error. */
async function mediaRequest<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const { code, message } = readMediaImportError(error);
    throw new MediaImportRequestError(code, message);
  }
}

/** A random id that names one import between the subscription and the mutation. */
function newMediaImportJobId(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `media-import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Asks the backend what the address at `url` offers, without downloading it.
 *
 * The answer's `probeId` is the handle the following {@link importMedia} call
 * must send back with the chosen `formatId`. A site that wants a login answers
 * with `requiresLogin: true`; other failures reject with a
 * {@link MediaImportRequestError}.
 */
export async function probeMediaSource(input: {
  url: string;
  kind: MediaKind;
}): Promise<MediaProbe> {
  return mediaRequest(() => trpcClient.file.probeMediaSource.mutate(input));
}

/**
 * Asks the backend to download the page at `url`, store it, and post-process it
 * for the node: HLS packaging for a video, container compatibility for audio.
 *
 * `workspaceId` names the workspace that will own the stored resource — the
 * download happens server-side, so the request token alone does not say which
 * workspace the caller means. `probeId` + `formatId` pick one of the qualities
 * the matching {@link probeMediaSource} offered; without them the site's best
 * stream is imported.
 *
 * The progress subscription is opened **before** the mutation, under a job id
 * this function generates (or the caller passes when resuming an interrupted
 * job), because the server's first update arrives while the mutation is still
 * running. A failed subscription never fails the import: without it the call
 * behaves exactly as before, it just resolves without updates.
 */
export async function importMedia(
  input: {
    url: string;
    kind: MediaKind;
    nodeId: string;
    workspaceId: string;
    probeId?: string;
    formatId?: string;
    /** Reuse an interrupted job's id so yt-dlp continues its partial file. */
    jobId?: string;
  },
  onProgress?: (progress: MediaImportProgress) => void,
): Promise<ImportedMedia> {
  const jobId = input.jobId ?? newMediaImportJobId();

  let unsubscribe: (() => void) | undefined;
  if (onProgress) {
    try {
      const subscription = trpcClient.file.onMediaImportProgress.subscribe(
        { jobId },
        {
          onData: (progress) => onProgress(progress),
          onError: () => {
            // The bar is a nicety; a broken subscription must not abort the
            // import that is already running on the server.
          },
        },
      );
      unsubscribe = () => subscription.unsubscribe();
    } catch {
      // A transport without subscriptions still imports, just without updates.
    }
  }

  try {
    return await mediaRequest(() =>
      trpcClient.file.importMedia.mutate({ ...input, jobId }),
    );
  } finally {
    unsubscribe?.();
  }
}

/**
 * Reads the newest import job of one node.
 *
 * The dialog calls this when it opens: a `running` job is resubscribed to, a
 * `completed` job's result is written onto the node and confirmed, and an
 * `interrupted` job offers 「继续」.
 */
export async function mediaImportJob(nodeId: string): Promise<MediaImportJob> {
  return mediaRequest(() => trpcClient.file.mediaImportJob.query({ nodeId }));
}

/** Removes a completed job once its result is on the node. */
export async function confirmMediaImport(
  nodeId: string,
  jobId: string,
): Promise<void> {
  await mediaRequest(() =>
    trpcClient.file.confirmMediaImport.mutate({ nodeId, jobId }),
  );
}

/** Stops the running import of one node and removes its partial files. */
export async function cancelMediaImport(nodeId: string): Promise<void> {
  await mediaRequest(() =>
    trpcClient.file.cancelMediaImport.mutate({ nodeId }),
  );
}

/** The listed sites for one kind, with the caller's saved login state. */
export async function mediaSites(kind?: MediaKind): Promise<MediaSites> {
  return mediaRequest(() =>
    trpcClient.file.mediaSites.query(kind ? { kind } : {}),
  );
}

/**
 * Imports an exported `cookies.txt` and connects every listed site it covers.
 *
 * The file is filtered server-side: only cookies of the listed sites are stored,
 * and `ignoredDomains` reports the rest.
 */
export async function importMediaCookies(
  cookieText: string,
): Promise<MediaCookieImport> {
  return mediaRequest(() =>
    trpcClient.file.importMediaCookies.mutate({ cookieText }),
  );
}

/**
 * Connects a site by reading the local browser's cookies (method A).
 *
 * Only offered by a local backend; a remote deployment rejects it with
 * `unsupported_url`.
 */
export async function connectMediaSiteWithBrowser(
  siteKey: string,
  browserName: string,
): Promise<MediaSite> {
  return mediaRequest(() =>
    trpcClient.file.connectMediaSiteWithBrowser.mutate({
      siteKey,
      browserName,
    }),
  );
}

/** Re-checks a saved login and resolves with the resulting capsule state. */
export async function verifyMediaSite(siteKey: string): Promise<MediaSite> {
  return mediaRequest(() =>
    trpcClient.file.verifyMediaSite.mutate({ siteKey }),
  );
}

/** Forgets the saved login of one site. Idempotent. */
export async function disconnectMediaSite(siteKey: string): Promise<void> {
  await mediaRequest(() =>
    trpcClient.file.disconnectMediaSite.mutate({ siteKey }),
  );
}
