// SPDX-License-Identifier: AGPL-3.0-only

import type { UploadSession } from "@workspace/domain";
import type { UploadSessionDTO } from "@workspace/interfaces";

/**
 * Maps one upload session onto the wire shape the client polls.
 *
 * The mapper owns the translation, exactly like the other DTO mappers, so the
 * router never builds a response and a session field can never leak by
 * accident: only what {@link UploadSessionDTO} declares is copied.
 */
export function toUploadSessionDTO(session: UploadSession): UploadSessionDTO {
  return {
    uploadId: session.id,
    status: session.status,
    chunkSize: session.chunkSize,
    chunkCount: session.chunkCount,
    fileSize: session.fileSize,
    fileName: session.fileName,
    received: [...session.received],
    attachment: session.result ? { ...session.result } : undefined,
    error: session.error,
    expiresAt: session.expiresAt,
  };
}
