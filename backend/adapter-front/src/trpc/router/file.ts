// SPDX-License-Identifier: AGPL-3.0-only

import {
  getPocketBaseClient,
  runWithFileWorkspace,
  toFileEndpointPath,
} from "@workspace/infrastructure";
import type { MediaImportProgress } from "@workspace/interfaces";
import { observable } from "@trpc/server/observable";
import { formatMediaImportError } from "@workspace/utils/media-import";
import { MediaImportFailure } from "@workspace/utils/media-import";
import { z } from "zod";
import { router, protectedProcedure } from "../server";
import { container } from "../../di/container";
import {
  clearMediaImportProgress,
  publishMediaImportProgress,
  subscribeMediaImportProgress,
} from "../media-import-progress";

/**
 * File procedures: analysis of an uploaded blob, and the shared video/audio
 * import from a site URL.
 *
 * The client uploads blobs straight to the file store (that is what gives it a
 * progress bar); the analysis procedures then hand the backend the address of
 * the freshly uploaded blob so it can process it server-side. The media
 * procedures are the other direction: the bytes live on a site, so the server
 * downloads them itself.
 */

/** A listed media site kind; the same union the application and UI use. */
const mediaKind = z.enum(["video", "audio"]);

/** A client-supplied id that becomes a directory name / channel key. */
const mediaId = z.string().min(1).max(128);

async function withFileScope<T>(
  url: string,
  work: () => Promise<T>,
): Promise<T> {
  const path = toFileEndpointPath(url);
  const [, , , collection, id] = path.split("/");
  const file = await getPocketBaseClient().collection("files").getOne(id!);
  if (collection !== "files" && collection !== file.collectionId)
    throw new Error("Invalid file collection");
  return runWithFileWorkspace(String(file.workspaceId ?? ""), work);
}

/**
 * Converts a classified media failure into the one wire format the client can
 * parse: tRPC carries only the message, so the reason travels as its prefix.
 */
async function classify<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof MediaImportFailure) {
      throw new Error(formatMediaImportError(error.code, error.message));
    }
    throw error;
  }
}

export const fileRouter = router({
  /**
   * Parses an uploaded PDF and stores a first-page cover.
   *
   * Returns the document parameters (`pageCount`, `fileSize`, page size, Info
   * dictionary) plus the cover URL; the caller patches them onto its node.
   */
  analyzePdf: protectedProcedure
    .input(z.object({ fileUrl: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return withFileScope(input.fileUrl, () =>
        container().fileCommandService.analyzePdf({
          fileUrl: input.fileUrl,
        }),
      );
    }),

  /**
   * Packages an uploaded video as HLS and stores the playlist, its segments and
   * a poster frame.
   *
   * Returns the playlist and cover URLs plus the video's parameters; the caller
   * patches them onto its node. A stream browsers already decode is copied, so
   * this is quick for H.264 and only slow when the source needs re-encoding —
   * which is exactly the case the browser cannot play on its own.
   */
  transcodeVideo: protectedProcedure
    .input(z.object({ fileUrl: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return withFileScope(input.fileUrl, () =>
        container().fileCommandService.transcodeVideo({
          fileUrl: input.fileUrl,
        }),
      );
    }),

  /**
   * The listed sites for one kind, with the caller's saved login state.
   *
   * The login panel and the dialog's capsules are built from this; the same
   * saved login is shared by the video and audio lists.
   */
  mediaSites: protectedProcedure
    .input(z.object({ kind: mediaKind.optional() }))
    .query(async ({ ctx, input }) => {
      return container().mediaAuthService.list(ctx.userId, input.kind);
    }),

  /**
   * Imports an exported `cookies.txt` and connects every listed site it covers.
   *
   * Each connected site is verified immediately; `ignoredDomains` names the
   * cookies that were dropped because they belong to no listed site.
   */
  importMediaCookies: protectedProcedure
    .input(z.object({ cookieText: z.string().min(1).max(1_048_576) }))
    .mutation(async ({ ctx, input }) => {
      return classify(() =>
        container().mediaAuthService.importCookies(
          ctx.userId,
          input.cookieText,
        ),
      );
    }),

  /**
   * Connects a site by reading the local browser's cookies (method A).
   *
   * Only available when the backend runs on the user's machine; a remote server
   * rejects it with `unsupported_url`.
   */
  connectMediaSiteWithBrowser: protectedProcedure
    .input(
      z.object({
        siteKey: z.string().min(1).max(64),
        browserName: z.string().min(1).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return classify(() =>
        container().mediaAuthService.connectWithBrowser(
          ctx.userId,
          input.siteKey,
          input.browserName,
        ),
      );
    }),

  /** Re-checks a saved login; the resulting status is on the returned site. */
  verifyMediaSite: protectedProcedure
    .input(z.object({ siteKey: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      return classify(() =>
        container().mediaAuthService.verify(ctx.userId, input.siteKey),
      );
    }),

  /** Forgets a saved login. Idempotent. */
  disconnectMediaSite: protectedProcedure
    .input(z.object({ siteKey: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await container().mediaAuthService.disconnect(ctx.userId, input.siteKey);
    }),

  /**
   * Reads what a pasted address offers, without downloading it.
   *
   * The returned `probeId` is the handle an import must send back with a chosen
   * `formatId`: the server only accepts a quality that probe actually offered.
   * A site that wants a login answers with `requiresLogin: true` and no
   * qualities instead of an error.
   */
  probeMediaSource: protectedProcedure
    .input(z.object({ url: z.string().min(1).max(2048), kind: mediaKind }))
    .mutation(async ({ ctx, input }) => {
      return classify(() =>
        container().mediaImportService.probe(
          { url: input.url, kind: input.kind },
          ctx.userId,
        ),
      );
    }),

  /**
   * Downloads, stores, and post-processes one address as a video or an audio
   * node, returning the result the caller writes onto its node.
   *
   * The stored source is charged to the verified caller's quota and assigned to
   * `workspaceId`, so the file scope is set from that input exactly as the
   * upload path does. The job id is the client's when it looks valid, so the
   * progress subscription opened before this mutation receives every update;
   * `jobId` is the same key `mediaImportJob` / `confirmMediaImport` use.
   */
  importMedia: protectedProcedure
    .input(
      z.object({
        kind: mediaKind,
        url: z.string().min(1).max(2048),
        nodeId: mediaId,
        workspaceId: z.string().min(1).max(128),
        probeId: mediaId.optional(),
        formatId: z.string().min(1).max(256).optional(),
        jobId: mediaId.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { jobId } = input;
      try {
        return await runWithFileWorkspace(input.workspaceId, () =>
          classify(() =>
            container().mediaImportService.import(
              {
                ownerId: ctx.userId,
                workspaceId: input.workspaceId,
                nodeId: input.nodeId,
                kind: input.kind,
                url: input.url,
                probeId: input.probeId,
                formatId: input.formatId,
                jobId,
              },
              jobId
                ? (progress) =>
                    publishMediaImportProgress(
                      progress.jobId,
                      ctx.userId,
                      progress,
                    )
                : undefined,
            ),
          ),
        );
      } finally {
        // The import is over (success or failure); a finished id cannot leak.
        if (jobId) clearMediaImportProgress(jobId);
      }
    }),

  /** The newest import job of one node, for resume / recovery after a reload. */
  mediaImportJob: protectedProcedure
    .input(z.object({ nodeId: mediaId }))
    .query(async ({ ctx, input }) => {
      return container().mediaImportService.job(ctx.userId, input.nodeId);
    }),

  /** Removes a completed job once its result is on the client's node. */
  confirmMediaImport: protectedProcedure
    .input(z.object({ nodeId: mediaId, jobId: mediaId }))
    .mutation(async ({ ctx, input }) => {
      await container().mediaImportService.confirm(ctx.userId, input.jobId);
    }),

  /** Stops the running import of one node and removes its partial files. */
  cancelMediaImport: protectedProcedure
    .input(z.object({ nodeId: mediaId }))
    .mutation(async ({ ctx, input }) => {
      await container().mediaImportService.cancel(ctx.userId, input.nodeId);
    }),

  /**
   * Progress of one in-flight {@link importMedia} call.
   *
   * The client opens this subscription with the job id it generated **before**
   * calling the mutation with the same id, so the bar starts from the first
   * phase the server reports. Events are filtered by owner: listening to another
   * user's id yields nothing, and the id itself is unguessable.
   */
  onMediaImportProgress: protectedProcedure
    .input(z.object({ jobId: mediaId }))
    .subscription(({ ctx, input }) => {
      return observable<MediaImportProgress>((emit) => {
        const unsubscribe = subscribeMediaImportProgress(
          input.jobId,
          ({ userId, progress }) => {
            if (userId === ctx.userId) emit.next(progress);
          },
        );
        return unsubscribe;
      });
    }),
});
