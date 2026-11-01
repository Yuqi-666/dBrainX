// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The media attach half of the upload path (plan item 41, design §4.3.4).
 *
 * An upload no longer assembles a node patch. The browser stores the bytes,
 * then names **one** operation and the id of the stored upload result
 * (`{ uploadId }`); the server reads that result, writes the file address and
 * backfills size, duration and page count, and answers with the canonical node
 * snapshot. Nothing here writes `content.fileSize` / `duration` / `pageCount`,
 * which is the whole point of the operation existing.
 *
 * The per-type mapping is a table, not a switch: one row per media node type,
 * and a type with no row is refused instead of falling into a catch-all branch.
 * A node type added later attaches through a new row (and a server definition),
 * never through a new `else if` in a drop zone.
 */
import { asOperationInvokeError } from "@workspace/api-client";
import {
  NodeService,
  nodeTarget,
  type GraphInvokeOptions,
  type GraphOperationId,
} from "@workspace/services";

/** The four node types whose content is one attached media file. */
export type MediaType = "image" | "pdf" | "video" | "audio";

/**
 * The attach operation of each media type, declared once.
 *
 * The ids are the ones `plugins/builtin/server/operations.ts` registers. They
 * are named here rather than in `NODE_OPERATIONS` for the same reason the tag
 * pair is (`attribute-operations.ts`): that catalogue holds the operations the
 * service layer already routes through its typed input map, and these four are
 * declared on the server ahead of that fold-in.
 */
export const MEDIA_ATTACH_OPERATIONS = {
  image: "image.attachFile",
  pdf: "pdf.attachFile",
  video: "video.attachFile",
  audio: "audio.attachFile",
} as const satisfies Record<MediaType, string>;

/**
 * The attach operation of one media type.
 *
 * `mediaType` is a string because a node type is runtime data (a plugin can
 * register one), so the lookup answers `undefined` for a type this table does
 * not cover instead of guessing an id.
 */
export function attachOperationFor(mediaType: string): string | undefined {
  return (MEDIA_ATTACH_OPERATIONS as Readonly<Record<string, string>>)[
    mediaType
  ];
}

/** The code an attach gets when its node type declares no attach operation. */
export const MEDIA_TYPE_NOT_ATTACHABLE = "MEDIA_TYPE_NOT_ATTACHABLE";

/** One attach, ready for `NodeService.invoke`. */
export interface MediaAttachRequest {
  nodeId: string;
  /** The media node type the file belongs to; picks the operation. */
  mediaType: string;
  /**
   * Id of the stored upload result (`IAttachment.id`, the same value an upload
   * session reports as `UploadResult.id`). The server reads that result, so the
   * client never sends the file address or any measurement.
   */
  uploadId: string;
}

/** What an attach did, in a shape the caller can show and report. */
export type MediaAttachOutcome =
  | {
      readonly ok: true;
      readonly operationId: string;
    }
  | {
      readonly ok: false;
      readonly operationId?: string;
      readonly code: string;
      readonly message: string;
    };

/**
 * Attaches one stored upload to its node through `*.attachFile`.
 *
 * `options.invoker` is `NodeService.invoke`'s documented transport seam; a real
 * caller leaves it out and the tRPC route is used. A refusal is returned, never
 * thrown: the store takes its copy from a successful reply only, so a failed
 * attach leaves the node exactly as it was — no half-written file address with
 * zeroed measurements.
 */
export async function attachMediaFile(
  request: MediaAttachRequest,
  options?: GraphInvokeOptions,
): Promise<MediaAttachOutcome> {
  const operationId = attachOperationFor(request.mediaType);
  if (operationId === undefined) {
    return {
      ok: false,
      code: MEDIA_TYPE_NOT_ATTACHABLE,
      message: `no media attach operation is declared for node type ${request.mediaType}`,
    };
  }

  try {
    // The four ids are server-side declarations the client catalogue does not
    // list yet, so the cast is this boundary's single assertion — the same one
    // `attribute-operations.ts` makes for a plugin-supplied operation id.
    await NodeService.invoke(
      operationId as GraphOperationId,
      nodeTarget(request.nodeId),
      { uploadId: request.uploadId },
      options,
    );
    return { ok: true, operationId };
  } catch (error) {
    const failure = asOperationInvokeError(error);
    return {
      ok: false,
      operationId,
      code: failure.code,
      message: failure.message,
    };
  }
}
