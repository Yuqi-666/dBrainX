// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Resumable upload port.
 *
 * A chunked upload is a small state machine with a durable side effect: chunks
 * arrive one request at a time, the file is assembled once they are all there,
 * and the assembled file is handed to the file store. The application layer
 * owns that machine; this port owns the storage of the chunks and of the
 * session record, which is an outside effect the domain cannot perform.
 *
 * The contract is expressed without Node types on purpose: a part arrives as an
 * async iterable of byte blocks, so an implementation is free to stream a
 * 2 GiB file to disk without ever holding it in memory. See
 * `infrastructure/src/storage/file-upload-sessions.ts`.
 */

/** Bytes of one chunk on their way into the spool. */
export interface UploadPartInput {
  /** Zero-based position of this chunk in the file. */
  index: number;
  /** Exact number of bytes the part must contain; the store rejects any other size. */
  bytes: number;
  /** The part body. Read exactly once and in order. */
  data: AsyncIterable<Uint8Array>;
}

/** Lifecycle of one upload session. */
export type UploadSessionStatus = "open" | "assembling" | "done" | "error";

/** A file that has been assembled and stored by the file store. */
export interface UploadResult {
  /** Record id in the file store. */
  id: string;
  /** Root-relative address, `/api/files/<collection>/<record>/<name>`. */
  url: string;
  /** Name the user picked. */
  fileName: string;
  fileSize: number;
  /** ISO timestamp reported by the store. */
  updatedAt: string;
}

/** Durable state of one upload session. */
export interface UploadSession {
  id: string;
  /** Verified user that opened the session; every read is scoped to it. */
  ownerId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  /** Workspace the stored file is assigned to; `""` when it has none. */
  workspaceId: string;
  /** Client-computed file identity used to resume after a reload. */
  fingerprint: string;
  chunkSize: number;
  chunkCount: number;
  status: UploadSessionStatus;
  /** Chunk indexes already stored, ascending. */
  received: number[];
  /** Set once {@link UploadSession.status} is `done`. */
  result?: UploadResult;
  /** Set once {@link UploadSession.status} is `error`. */
  error?: string;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp after which the session may be swept. */
  expiresAt: string;
}

/** Everything needed to open a session. */
export interface CreateUploadSessionInput {
  ownerId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  workspaceId: string;
  fingerprint: string;
  chunkSize: number;
  chunkCount: number;
  /** Idle sessions older than this are swept. */
  expiresAt: string;
}

/** Where the assembled file went. */
export interface AssembledUpload {
  /** Absolute path of the assembled file, inside the session directory. */
  path: string;
  /** Byte length actually written; the caller compares it to the declared size. */
  bytes: number;
}

/** Chunk spool plus session records for the resumable upload path. */
export interface IUploadSessionStore {
  /** Opens a session. The caller has already resolved it is not a resume. */
  create(input: CreateUploadSessionInput): Promise<UploadSession>;

  /** Reads one session, scoped to its owner. `null` when it does not exist. */
  find(ownerId: string, id: string): Promise<UploadSession | null>;

  /**
   * Finds the newest session of this owner with the same file fingerprint that
   * is not already `done`, so a reloaded page continues instead of starting
   * over.
   *
   * An `assembling` session counts: the file is already fully uploaded, and the
   * caller should poll it rather than send 2 GiB a second time.
   */
  findResumable(ownerId: string, fingerprint: string): Promise<UploadSession | null>;

  /**
   * Stores one chunk, replacing any earlier attempt at the same index.
   * Resolves with the number of chunks now stored.
   */
  writePart(ownerId: string, id: string, part: UploadPartInput): Promise<number>;

  /**
   * Concatenates every stored chunk, in order, into one file in the session
   * directory and resolves with its path. Overwrites a previous attempt.
   */
  assemble(ownerId: string, id: string): Promise<AssembledUpload>;

  /** Deletes the chunks and the assembled file, keeping the session record. */
  discardPayload(ownerId: string, id: string): Promise<void>;

  /** Persists `session` (status, error, result, `updatedAt`). */
  update(session: UploadSession): Promise<void>;

  /** Deletes a session and its payload. */
  remove(ownerId: string, id: string): Promise<void>;

  /**
   * Deletes sessions untouched since `before`, plus payloads left behind by a
   * crash. Resolves with the number of sessions removed.
   */
  sweep(before: Date): Promise<number>;
}
