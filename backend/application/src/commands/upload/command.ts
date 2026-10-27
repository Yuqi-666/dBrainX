// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Commands of the resumable upload path.
 *
 * The client opens a session, sends the chunks it is missing, and asks the
 * server to assemble them. Identity never travels in a command: `ownerId` comes
 * from a verified token, and every read is scoped to it, so one user can never
 * see or continue another user's upload.
 */
import type { StorageCategory } from "@workspace/utils/storage-limits";

/**
 * Limits the composition root injects.
 *
 * The transport ceiling and the chunk size come from the shared upload
 * contract; the category ceilings and the quota come from the shared storage
 * contract (`@workspace/utils/storage-limits`), which the client and the
 * PocketBase hook read as well.
 */
export interface UploadLimits {
  /** Largest file the pipeline accepts. */
  maxUploadBytes: number;
  /** Bytes per chunk; the client is told this value and must honour it. */
  chunkSize: number;
  /** Largest single file per media category. */
  maxFileBytes: Record<StorageCategory, number>;
  /** Total bytes one user may store; `0` disables the quota. */
  userQuotaBytes: number;
}

/** Body of `POST /upload/sessions`. */
export interface StartUploadCommand {
  ownerId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  workspaceId: string;
  fingerprint: string;
}

/** One session addressed by its owner. */
export interface UploadSessionRef {
  ownerId: string;
  uploadId: string;
}

/** One chunk on its way into the spool. */
export interface PutUploadPartCommand extends UploadSessionRef {
  index: number;
  /** Declared byte length; must match the position's expected length exactly. */
  bytes: number;
  data: AsyncIterable<Uint8Array>;
}

/** Why an upload call failed, in transport-neutral terms. */
export type UploadErrorCode =
  /** The request itself is malformed. */
  | "invalid"
  /** No such session for this owner (also used for an expired one). */
  | "not_found"
  /** The file exceeds {@link UploadLimits.maxUploadBytes} or its category ceiling. */
  | "too_large"
  /** The file would take the owner past {@link UploadLimits.userQuotaBytes}. */
  | "quota"
  /** `complete` was asked for while chunks are still missing. */
  | "incomplete"
  /** The file is already being assembled; the caller should keep polling. */
  | "busy"
  /** The file could not be assembled or stored. */
  | "failed";

/**
 * A failed upload call.
 *
 * The HTTP layer maps {@link code} onto a status, so the transport stays in the
 * transport layer and the application can be tested without it.
 */
export class UploadError extends Error {
  constructor(
    readonly code: UploadErrorCode,
    message: string,
    /** Chunk indexes still missing, when the code is `incomplete`. */
    readonly missing: number[] = [],
  ) {
    super(message);
    this.name = "UploadError";
  }
}
