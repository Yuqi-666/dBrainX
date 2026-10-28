// SPDX-License-Identifier: AGPL-3.0-only

import type {
  IFileStore,
  IStorageUsageReader,
  IUploadSessionStore,
  UploadSession,
} from "@workspace/domain";
import type { UploadSessionDTO } from "@workspace/interfaces";
import { maxFileBytesFor, storageCategoryFor } from "@workspace/utils/storage-limits";
import { toUploadSessionDTO } from "../../dto/upload-dto.mapper";
import {
  UploadError,
  type PutUploadPartCommand,
  type StartUploadCommand,
  type UploadLimits,
  type UploadSessionRef,
} from "./command";

/**
 * Upload use cases for the resumable (chunked) path.
 *
 * The client sends the file in chunks; this service owns the state machine and
 * the two outside effects: the chunk spool (an {@link IUploadSessionStore}) and
 * the file store. The ordering matters and is fixed:
 *
 *   open → receive chunks → assemble on disk → store → drop the spool
 *
 * Nothing here ever holds a whole file in memory, because the file may be
 * 2 GiB and the pipeline exists precisely to keep that off the heap.
 *
 * A finished session keeps its record (so a client that was disconnected while
 * the file was being stored can still learn the outcome) but loses its payload.
 * A failed session keeps its payload, so the client can simply retry `complete`
 * instead of sending 2 GiB again.
 */

/** Idle sessions are swept after one day. */
export const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long an `assembling` session may stay that way before a new `complete`
 * call is allowed to assemble it again.
 *
 * The assembly runs in the server process, so a restart in the middle of one
 * leaves the session marked `assembling` with nothing working on it. After this
 * window the marker is treated as abandoned; the chunks are still on disk, so
 * the retry resumes from where it stopped rather than from zero.
 */
export const UPLOAD_ASSEMBLE_STALE_MS = 30 * 60 * 1000;

export class UploadCommandService {
  /**
   * Sessions this process is assembling right now.
   *
   * `complete` is a request the client may repeat (a poll timeout, a retry after
   * a reload), and two concurrent assemblies of one session would store the file
   * twice. The listener is a single process today, so an in-process guard is
   * enough; a second instance would need a store-level lock.
   */
  private readonly assembling = new Set<string>();

  constructor(
    private readonly sessions: IUploadSessionStore,
    private readonly fileStore: IFileStore,
    private readonly limits: UploadLimits,
    /**
     * Reads the owner's stored byte total for the quota check. Only the
     * `start` call uses it: the final write is guarded again by the PocketBase
     * hook, which is what closes the race between two concurrent uploads that
     * each fit the quota alone.
     */
    private readonly usage: IStorageUsageReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Opens a session, or answers with the one this exact file already has.
   *
   * Resuming is keyed on the client's fingerprint rather than on the upload id:
   * a page reload loses the id but not the file identity, so the same POST
   * continues the previous session and the client only has to send the chunks
   * the response does not list as `received`.
   */
  async start(cmd: StartUploadCommand): Promise<UploadSessionDTO> {
    const fileName = normaliseFileName(cmd.fileName);
    if (!fileName) throw new UploadError("invalid", "A file name is required");
    if (!Number.isSafeInteger(cmd.fileSize) || cmd.fileSize <= 0) {
      throw new UploadError("invalid", "A file must have a whole, positive byte length");
    }
    if (cmd.fileSize > this.limits.maxUploadBytes) {
      throw new UploadError(
        "too_large",
        `The file is ${cmd.fileSize} bytes; the limit is ${this.limits.maxUploadBytes}`,
      );
    }
    await this.assertWithinLimits(cmd, fileName);
    const fingerprint = cmd.fingerprint.trim();
    if (!fingerprint || fingerprint.length > 200) {
      throw new UploadError("invalid", "An upload fingerprint is required");
    }

    const resumable = await this.sessions.findResumable(cmd.ownerId, fingerprint);
    if (
      resumable &&
      resumable.fileSize === cmd.fileSize &&
      resumable.fileName === fileName
    ) {
      return toUploadSessionDTO(resumable);
    }

    const chunkSize = this.limits.chunkSize;
    const session = await this.sessions.create({
      ownerId: cmd.ownerId,
      fileName,
      fileSize: cmd.fileSize,
      contentType: cmd.contentType.trim() || "application/octet-stream",
      workspaceId: cmd.workspaceId ?? "",
      fingerprint,
      chunkSize,
      chunkCount: chunkCount(cmd.fileSize, chunkSize),
      expiresAt: new Date(this.now().getTime() + UPLOAD_SESSION_TTL_MS).toISOString(),
    });
    return toUploadSessionDTO(session);
  }

  /** Reads one session, for resume discovery and for polling the finalize. */
  async status(ref: UploadSessionRef): Promise<UploadSessionDTO> {
    return toUploadSessionDTO(await this.require(ref));
  }

  /** Stores one chunk. Re-sending a chunk is allowed and overwrites it. */
  async writePart(cmd: PutUploadPartCommand): Promise<UploadSessionDTO> {
    const session = await this.require(cmd);
    if (session.status === "done") {
      throw new UploadError("invalid", "This upload has already been stored");
    }
    if (session.status === "assembling") {
      throw new UploadError("busy", "This upload is being assembled");
    }
    if (cmd.index < 0 || cmd.index >= session.chunkCount) {
      throw new UploadError(
        "invalid",
        `Chunk ${cmd.index} is outside 0..${session.chunkCount - 1}`,
      );
    }
    const expected = expectedChunkBytes(session, cmd.index);
    if (cmd.bytes !== expected) {
      throw new UploadError(
        "invalid",
        `Chunk ${cmd.index} must be exactly ${expected} bytes`,
      );
    }

    await this.sessions.writePart(cmd.ownerId, cmd.uploadId, {
      index: cmd.index,
      bytes: expected,
      data: cmd.data,
    });
    // Re-read instead of patching: the store owns what counts as received.
    return toUploadSessionDTO(await this.require(cmd));
  }

  /**
   * Marks the session as assembling and answers immediately.
   *
   * Assembling a 2 GiB file and handing it to the store takes minutes, which is
   * longer than any proxy is willing to wait for a response. The caller
   * therefore detaches {@link finish} and lets the client poll
   * {@link status} — which also means the store write survives a browser that
   * closed the tab mid-upload.
   */
  async complete(ref: UploadSessionRef): Promise<UploadSessionDTO> {
    const session = await this.require(ref);
    if (session.status === "done") return toUploadSessionDTO(session);
    if (session.status === "assembling" && !this.isStaleAssembly(session)) {
      return toUploadSessionDTO(session);
    }

    const missing = missingChunks(session);
    if (missing.length > 0) {
      throw new UploadError(
        "incomplete",
        `${missing.length} of ${session.chunkCount} chunks are still missing`,
        missing,
      );
    }

    session.status = "assembling";
    session.error = undefined;
    await this.sessions.update(session);
    return toUploadSessionDTO(session);
  }

  /**
   * Assembles the chunks and stores the file. Safe to call twice.
   *
   * Not exported through the HTTP layer directly: the route detaches it after
   * answering 202, so this method can stay awaitable and testable.
   */
  async finish(ref: UploadSessionRef): Promise<UploadSessionDTO> {
    const key = `${ref.ownerId}:${ref.uploadId}`;
    if (this.assembling.has(key)) return toUploadSessionDTO(await this.require(ref));

    const session = await this.require(ref);
    if (session.status === "done") return toUploadSessionDTO(session);

    const missing = missingChunks(session);
    if (missing.length > 0) {
      throw new UploadError(
        "incomplete",
        `${missing.length} of ${session.chunkCount} chunks are still missing`,
        missing,
      );
    }

    this.assembling.add(key);
    try {
      if (session.status !== "assembling") {
        session.status = "assembling";
        session.error = undefined;
        await this.sessions.update(session);
      }

      try {
        const assembled = await this.sessions.assemble(ref.ownerId, ref.uploadId);
        if (assembled.bytes !== session.fileSize) {
          throw new Error(
            `Assembled ${assembled.bytes} bytes, but the session declared ${session.fileSize}`,
          );
        }
        const stored = await this.fileStore.uploadFromPath(
          assembled.path,
          session.fileName,
          session.contentType,
          session.workspaceId,
        );

        session.status = "done";
        session.error = undefined;
        session.result = {
          id: stored.id,
          url: stored.url,
          fileName: session.fileName,
          fileSize: session.fileSize,
          updatedAt: this.now().toISOString(),
        };
        await this.sessions.update(session);
        // Keep the record (the client may still be polling) but not the bytes,
        // which the file store now owns.
        await this.sessions.discardPayload(ref.ownerId, ref.uploadId);
        return toUploadSessionDTO(session);
      } catch (error) {
        // The payload stays: a retry of `complete` can reread the chunks.
        session.status = "error";
        session.error = error instanceof Error ? error.message : String(error);
        await this.sessions.update(session);
        throw error;
      }
    } finally {
      this.assembling.delete(key);
    }
  }

  /** Drops a session and everything it spooled. Idempotent. */
  async abort(ref: UploadSessionRef): Promise<void> {
    await this.sessions.remove(ref.ownerId, ref.uploadId);
  }

  /** Deletes sessions nobody touched inside the TTL. Called on a timer. */
  async sweepExpired(): Promise<number> {
    return this.sessions.sweep(new Date(this.now().getTime() - UPLOAD_SESSION_TTL_MS));
  }

  /**
   * Rejects a file before a session is opened when policy forbids storing it.
   *
   * Two rules apply, in this order: the category's single-file ceiling, then the
   * owner's remaining quota. The PocketBase hook enforces both again when the
   * record is written — this call exists so a file that cannot be accepted is
   * refused before 2 GiB of chunks are spooled to disk, and it is also the only
   * place that can explain the quota failure to the browser in transport terms.
   */
  private async assertWithinLimits(
    cmd: StartUploadCommand,
    fileName: string,
  ): Promise<void> {
    const categoryLimit = maxFileBytesFor(this.limits, fileName, cmd.contentType);
    if (cmd.fileSize > categoryLimit) {
      const category = storageCategoryFor(fileName, cmd.contentType);
      throw new UploadError(
        "too_large",
        `The file is ${cmd.fileSize} bytes; the ${category} limit is ${categoryLimit}`,
      );
    }

    if (this.limits.userQuotaBytes <= 0) return;
    const used = await this.usage.usageFor(cmd.ownerId);
    if (used + cmd.fileSize > this.limits.userQuotaBytes) {
      throw new UploadError(
        "quota",
        `The file needs ${cmd.fileSize} bytes but only ${Math.max(
          0,
          this.limits.userQuotaBytes - used,
        )} of the ${this.limits.userQuotaBytes} byte quota remain`,
      );
    }
  }

  private async require(ref: UploadSessionRef): Promise<UploadSession> {
    const session = await this.sessions.find(ref.ownerId, ref.uploadId);
    if (!session) {
      throw new UploadError("not_found", "Unknown or expired upload session");
    }
    return session;
  }

  private isStaleAssembly(session: UploadSession): boolean {
    const updated = Date.parse(session.updatedAt);
    if (!Number.isFinite(updated)) return true;
    return this.now().getTime() - updated > UPLOAD_ASSEMBLE_STALE_MS;
  }
}

/** Chunks one file needs. Kept here so the wire helper and the server agree. */
function chunkCount(fileSize: number, chunkSize: number): number {
  return Math.max(1, Math.ceil(fileSize / chunkSize));
}

/** Expected byte length of one chunk; only the last one may be short. */
function expectedChunkBytes(session: UploadSession, index: number): number {
  return Math.min(session.chunkSize, session.fileSize - index * session.chunkSize);
}

/** Every chunk index the session has not stored yet. */
function missingChunks(session: UploadSession): number[] {
  const received = new Set(session.received);
  const missing: number[] = [];
  for (let index = 0; index < session.chunkCount; index += 1) {
    if (!received.has(index)) missing.push(index);
  }
  return missing;
}

/**
 * Makes a user-supplied name safe for a multipart header and a file store.
 *
 * A name is never a path here: separators and control characters become
 * underscores, so a picked `../../x` cannot influence where anything lands.
 */
function normaliseFileName(raw: string): string {
  const cleaned = (raw ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replace(/[\\/]/g, "_")
    .trim()
    .slice(0, 200);
  return cleaned === "." || cleaned === ".." ? "" : cleaned;
}
