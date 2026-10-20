// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The media-import failure wire format.
 *
 * A server-side import or probe can fail for a reason the UI has to act on, not
 * only print: a login error highlights the matching site capsule, a size error
 * suggests a lower quality. tRPC carries a thrown `Error` as its message, so the
 * reason travels as a prefix inside that message:
 *
 * ```text
 * MEDIA_ERROR:<code>:<message shown to the user>
 * ```
 *
 * The server formats it, the client's API layer parses the code out again and
 * strips the prefix before anything is shown. A failure the server did not
 * classify arrives without the prefix and reads as `unknown`, so a message is
 * never lost just because it was not typed.
 */

import type {
  MediaImportErrorCode,
  MediaImportStage,
} from "@workspace/interfaces";

/** Carries a {@link MediaImportErrorCode} through a serialized error message. */
export const MEDIA_IMPORT_ERROR_PREFIX = "MEDIA_ERROR:";

/** Formats one classified failure as the wire message described above. */
export function formatMediaImportError(
  code: MediaImportErrorCode,
  message: string,
): string {
  return `${MEDIA_IMPORT_ERROR_PREFIX}${code}:${message}`;
}

/**
 * An error the server classified, thrown by a download / probe / import layer.
 *
 * The adapters and the application layer throw this; the tRPC router turns it
 * into a {@link formatMediaImportError} message so the reason survives
 * serialization. Anything thrown without a code reaches the client as
 * `unknown`, which is why every failure a user can act on should carry one.
 */
export class MediaImportFailure extends Error {
  /** Reason the caller should act on. */
  readonly code: MediaImportErrorCode;

  constructor(code: MediaImportErrorCode, message: string) {
    super(message);
    this.name = "MediaImportFailure";
    this.code = code;
  }
}

/** Reads the code of a thrown failure, or `unknown`. */
export function mediaImportFailureCode(error: unknown): MediaImportErrorCode {
  return error instanceof MediaImportFailure ? error.code : "unknown";
}

/** A failure with the reason the server classified. */
export interface ClassifiedMediaImportError {
  /** Reason the server reported, or `unknown` when it reported none. */
  code: MediaImportErrorCode;
  /** Sentence to show the user, prefix already removed. */
  message: string;
}

/**
 * Reads a serialized failure, whether or not it carries a code.
 *
 * A message without the prefix keeps its full text: it may be a transport
 * failure or a router-level rejection, and hiding it would leave the user with
 * nothing to correct.
 */
export function readMediaImportError(
  error: unknown,
): ClassifiedMediaImportError {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const text = raw.trim();

  if (text.startsWith(MEDIA_IMPORT_ERROR_PREFIX)) {
    const rest = text.slice(MEDIA_IMPORT_ERROR_PREFIX.length);
    const separator = rest.indexOf(":");
    if (separator > 0) {
      const code = rest.slice(0, separator);
      const message = rest.slice(separator + 1).trim() || raw;
      if (isMediaImportErrorCode(code)) return { code, message };
    }
  }

  return { code: "unknown", message: text || "The import failed" };
}

/** Narrows an arbitrary string to a known code. */
export function isMediaImportErrorCode(
  value: string,
): value is MediaImportErrorCode {
  return MEDIA_IMPORT_ERROR_CODES.has(value as MediaImportErrorCode);
}

/** Every code, in one place; also the list the UI switches over. */
export const MEDIA_IMPORT_ERROR_CODES: ReadonlySet<MediaImportErrorCode> =
  new Set<MediaImportErrorCode>([
    "login_required",
    "login_expired",
    "private",
    "members_only",
    "unsupported_url",
    "probe_expired",
    "busy",
    "no_media",
    "size_limit",
    "quota",
    "timeout",
    "network",
    "cancelled",
    "conversion_failed",
    "unknown",
  ]);

/**
 * Human label of an import phase.
 *
 * Lives here rather than in the UI so the progress view, a future native
 * surface, and the tests all read the same wording. The English text is the
 * fallback the i18n runtime uses when a locale has no key yet.
 */
export function mediaImportStageLabel(stage: MediaImportStage): string {
  switch (stage) {
    case "downloading":
      return "正在下载…";
    case "storing":
      return "正在保存到资源库…";
    case "packaging":
      return "正在转码为 HLS…";
    case "preparing":
      return "正在准备导入…";
  }
}
