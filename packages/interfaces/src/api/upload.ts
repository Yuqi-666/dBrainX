// SPDX-License-Identifier: AGPL-3.0-only

import type { IAttachment } from "./attachment";

/**
 * Wire shapes of the resumable upload protocol.
 *
 * The routes, the size limits and the chunk arithmetic live in
 * `@workspace/utils/upload`; this module only describes what travels on the
 * wire. A session is addressed by its `uploadId` and owned by the verified
 * user, so a client can only ever see and continue its own upload.
 */

/** Lifecycle of one upload session. */
export type UploadSessionStatus = "open" | "assembling" | "done" | "error";

/** Body of `POST /upload/sessions`. */
export interface CreateUploadSessionRequest {
  /** Name the user picked; becomes the stored file name. */
  fileName: string;
  /** Exact byte length of the file; the server rejects anything above its cap. */
  fileSize: number;
  /** MIME type as the browser reported it; may be empty. */
  contentType: string;
  /** Workspace the stored file belongs to; `""` for a file outside a workspace. */
  workspaceId: string;
  /**
   * Stable client-computed identity of the picked file (name, size, last
   * modification and workspace). Re-sending the same fingerprint resumes the
   * open session instead of starting a second one, which is what makes an
   * upload survive a page reload or a server restart.
   */
  fingerprint: string;
}

/** State of one upload session, as the client sees it. */
export interface UploadSessionDTO {
  uploadId: string;
  status: UploadSessionStatus;
  /** Server-chosen chunk size; the client must honour it. */
  chunkSize: number;
  chunkCount: number;
  fileSize: number;
  fileName: string;
  /** Chunk indexes already stored, ascending. Missing ones still have to be sent. */
  received: number[];
  /** Set once `status` is `done`. */
  attachment?: IAttachment;
  /** Set once `status` is `error`; the chunks are kept so a retry can resume. */
  error?: string;
  /** ISO timestamp after which the server may sweep the session. */
  expiresAt: string;
}

/**
 * Body of every failed upload call.
 *
 * `missing` is present only for an incomplete `complete` (HTTP 409), so a client
 * that lost track of its chunks can send exactly those indexes instead of
 * starting over.
 */
export interface UploadErrorResponse {
  message: string;
  missing?: number[];
}
