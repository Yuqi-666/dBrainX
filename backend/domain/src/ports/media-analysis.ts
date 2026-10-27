// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Media analysis cache.
 *
 * Parsing a PDF or packaging a video as HLS is expensive and leaves extra
 * stored blobs behind (a cover, a playlist, its segments). The result therefore
 * belongs to the stored **resource**, not to the node that happens to reference
 * it: it is computed once and every node that references that resource reads
 * the same answer.
 *
 * The cache lives on the resource record in the file store — the fields
 * `pageCount`, `width`, `height`, `duration`, `coverUrl` and `hlsUrl` of the
 * `files` collection. This port reads and writes those fields; where the record
 * is stored is an infrastructure concern.
 *
 * A write is best effort. A caller may read a workspace teammate's resource but
 * may not update its record, so the analysis is still returned — it just stays
 * uncached for that caller. Reading someone else's cached analysis works.
 */

/** Measurements one analysis produced, as cached on a resource record. */
export interface ResourceAnalysis {
  /** `/Pages /Count` of a PDF; 0 for any other kind of blob. */
  pageCount: number;
  /** Pixel width of an image or a video; 0 when not measured. */
  width: number;
  /** Pixel height of an image or a video; 0 when not measured. */
  height: number;
  /** Duration of an audio file or a video, in seconds; 0 when unknown. */
  duration: number;
  /** Address of the stored cover, `""` when the analysis stored none. */
  coverUrl: string;
  /** Address of the stored HLS playlist, `""` for anything but a video. */
  hlsUrl: string;
  /**
   * Byte length the file store recorded for the resource, `0` when the row
   * carries none. Read from the record, never written through {@link
   * IMediaAnalysisStore.write}.
   */
  fileSize: number;
}

/** The measurements an analysis may cache; the byte length is server-owned. */
export type ResourceAnalysisPatch = Partial<Omit<ResourceAnalysis, "fileSize">>;

/** Cache of the analysis one stored resource does not have to repeat. */
export interface IMediaAnalysisStore {
  /**
   * Cached analysis of the resource that owns `fileUrl`, or `null` when the
   * record carries none — or when the caller may not read it.
   */
  read(fileUrl: string): Promise<ResourceAnalysis | null>;

  /**
   * Caches `patch` on the resource that owns `fileUrl`, resolving `true` when
   * it was stored. A resource the caller does not own stays uncached; the
   * analysis that requested the write is still valid.
   */
  write(fileUrl: string, patch: ResourceAnalysisPatch): Promise<boolean>;
}
