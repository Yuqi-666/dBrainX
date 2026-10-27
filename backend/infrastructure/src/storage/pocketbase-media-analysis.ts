// SPDX-License-Identifier: AGPL-3.0-only

import type {
  IMediaAnalysisStore,
  ResourceAnalysis,
  ResourceAnalysisPatch,
} from "@workspace/domain";
import type { PocketBaseClient } from "../database/pocketbase-client";
import { recordIdFromFileUrl } from "./file-address.ts";

/**
 * The analysis cache on a resource record.
 *
 * A PDF parse and a video HLS package happen once; the result is stored in the
 * `pageCount`, `width`, `height`, `duration`, `coverUrl` and `hlsUrl` fields of
 * the `files` record that owns the blob (see the media-library migrations). A
 * node that references the resource then reads them instead of asking the
 * backend to parse or package the same file again — which is what used to
 * duplicate covers and whole HLS packages on every reference.
 *
 * Reads and writes use the request-scoped PocketBase client, so the collection
 * rules decide: anyone who may read a resource reads its cached analysis, while
 * only the owner may store one. A write that the rules refuse is reported as
 * `false`, not thrown: the analysis itself is still valid, and a teammate's
 * resource simply stays uncached for this caller.
 *
 * A missing record, field or collection is not an error either. The cache is an
 * optimisation; the command that asked about it can always analyse the blob.
 */
export class PocketBaseMediaAnalysis implements IMediaAnalysisStore {
  /**
   * A plain field rather than a constructor parameter property: the co-located
   * test runs this module through Node's type-stripping loader, which rejects
   * TypeScript-only syntax that has a runtime effect.
   */
  private readonly pb: PocketBaseClient;

  constructor(pb: PocketBaseClient) {
    this.pb = pb;
  }

  async read(fileUrl: string): Promise<ResourceAnalysis | null> {
    let id: string;
    try {
      id = recordIdFromFileUrl(fileUrl);
    } catch {
      return null;
    }

    try {
      const record = await this.pb.collection("files").getOne(id, {
        fields: MEDIA_FIELDS,
      });
      const analysis: ResourceAnalysis = {
        pageCount: positiveNumber(record.pageCount),
        width: positiveNumber(record.width),
        height: positiveNumber(record.height),
        duration: positiveNumber(record.duration),
        coverUrl: text(record.coverUrl),
        hlsUrl: text(record.hlsUrl),
        fileSize: positiveNumber(record.size),
      };
      return hasAnalysis(analysis) ? analysis : null;
    } catch (error) {
      // A record the caller may not read (or one that no longer exists) simply
      // has no cached analysis for this request.
      if (!this.pb.isClientResponseError(error) || error.status !== 403) {
        console.warn(
          "[PocketBaseMediaAnalysis] could not read the cache",
          error,
        );
      }
      return null;
    }
  }

  async write(fileUrl: string, patch: ResourceAnalysisPatch): Promise<boolean> {
    let id: string;
    try {
      id = recordIdFromFileUrl(fileUrl);
    } catch {
      return false;
    }

    const body: Record<string, string | number> = {};
    if (patch.pageCount !== undefined) body.pageCount = patch.pageCount;
    if (patch.width !== undefined) body.width = patch.width;
    if (patch.height !== undefined) body.height = patch.height;
    if (patch.duration !== undefined) body.duration = patch.duration;
    if (patch.coverUrl !== undefined) body.coverUrl = patch.coverUrl;
    if (patch.hlsUrl !== undefined) body.hlsUrl = patch.hlsUrl;
    if (Object.keys(body).length === 0) return false;

    try {
      await this.pb.collection("files").update(id, body);
      return true;
    } catch (error) {
      // The owner may cache; a teammate's resource, a record that vanished and
      // a deployment that predates the fields all end here, and none of them
      // should fail the analysis that produced the patch.
      if (!this.pb.isClientResponseError(error) || error.status !== 403) {
        console.warn(
          "[PocketBaseMediaAnalysis] could not cache the analysis",
          error,
        );
      }
      return false;
    }
  }
}

/** Fields the cache lives in, plus the size the resource record reports. */
const MEDIA_FIELDS = "size,pageCount,width,height,duration,coverUrl,hlsUrl";

/** True when the record carries at least one measurement the cache can answer. */
function hasAnalysis(analysis: ResourceAnalysis): boolean {
  return (
    analysis.pageCount > 0 ||
    analysis.width > 0 ||
    analysis.height > 0 ||
    analysis.duration > 0 ||
    analysis.coverUrl !== "" ||
    analysis.hlsUrl !== ""
  );
}

/** A finite, non-negative number from a record field; anything else is 0. */
function positiveNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/** A record text field, or `""` when the store has none. */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
