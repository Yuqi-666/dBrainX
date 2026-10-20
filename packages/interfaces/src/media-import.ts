// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Cross-boundary shapes of the media import (video and audio).
 *
 * A node can be filled from a site URL instead of an upload: the server
 * downloads it with yt-dlp, stores it, and (for video) packages it as HLS. The
 * same flow serves a video node and an audio node — only the requested kind, the
 * quality picker and the post-processing differ.
 *
 * These types cross every boundary: the server's application layer produces
 * them, the tRPC router serializes them, and the client draws them. They live
 * here, in the one package both sides import, rather than being declared twice.
 * The matching runtime helpers (the error-wire format) live in
 * `@workspace/utils/media-import`, because this package declares types only.
 */

/** The media a node holds; also which site list the import dialog shows. */
export type MediaKind = "video" | "audio";

/**
 * Phase of an import the server is working on.
 *
 * `downloading` and `storing` are shared by both kinds. A video then runs
 * `packaging` (HLS); an audio runs `preparing` (cover upload and, when the
 * container is not playable, a conversion).
 */
export type MediaImportStage =
  | "downloading"
  | "storing"
  | "packaging"
  | "preparing";

/**
 * One progress update of an import, as the client receives it.
 *
 * `percent` estimates the **whole** import, so the bar advances monotonically
 * even though the download and the packaging each report only their own
 * fraction. `100` is never sent: the mutation resolving is what says "done".
 *
 * `speedBytesPerSecond` and `etaSeconds` are `0` when the site does not report
 * them; `totalBytes` is `0` when the site does not declare a size.
 */
export interface MediaImportProgress {
  /** Random id naming this import, the same one the job store uses. */
  jobId: string;
  /** Node the result belongs to. */
  nodeId: string;
  /** What is being imported. */
  kind: MediaKind;
  /** Phase currently running. */
  stage: MediaImportStage;
  /** Estimated overall completion, `0`–`99`. */
  percent: number;
  /** Bytes downloaded so far. */
  downloadedBytes: number;
  /** Declared stream size, `0` when the site declares none. */
  totalBytes: number;
  /** Current download speed in bytes per second, `0` when unknown. */
  speedBytesPerSecond: number;
  /** Estimated seconds remaining, `0` when unknown. */
  etaSeconds: number;
}

/**
 * Stable reason an import or a probe failed.
 *
 * The UI needs the reason, not only the sentence: a login error has to highlight
 * the matching site capsule and offer 「登录后重试」, while a size error suggests
 * a lower quality. A plain message could only be matched by its text, which
 * breaks the moment a message is reworded or translated.
 */
export type MediaImportErrorCode =
  /** The site wants a login before it answers. */
  | "login_required"
  /** A saved login no longer works. */
  | "login_expired"
  /** The media is private. */
  | "private"
  /** The site requires a paid membership. */
  | "members_only"
  /** The pasted address is not something this flow can import. */
  | "unsupported_url"
  /** The parse result the client is importing is gone; parse the URL again. */
  | "probe_expired"
  /** The server already runs as many imports as its policy allows. */
  | "busy"
  /** The site has no playable stream / track for this kind. */
  | "no_media"
  /** The file is larger than the category ceiling. */
  | "size_limit"
  /** The owner has no storage quota left. */
  | "quota"
  /** The download took longer than the allowed time. */
  | "timeout"
  /** The site or the network failed. */
  | "network"
  /** The user cancelled the import. */
  | "cancelled"
  /** An audio container had to be converted and the conversion failed. */
  | "conversion_failed"
  /** Anything else; the message carries the detail. */
  | "unknown";
