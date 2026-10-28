// SPDX-License-Identifier: AGPL-3.0-only

import type { PdfDocumentInfo } from "@workspace/domain";

/**
 * Asks the backend to parse an already-uploaded PDF and, on success, to store a
 * rendered first-page cover next to it.
 *
 * The blob itself never travels through this command — the client has just
 * uploaded it to the file store, so only its address is passed on.
 */
export interface AnalyzePdfCommand {
  /**
   * Address of the uploaded PDF, absolute (`http://…/api/files/files/<id>/x.pdf`)
   * or relative (`/api/files/files/<id>/x.pdf`). Addresses outside the file
   * store are rejected.
   */
  fileUrl: string;
}

/**
 * Result of {@link AnalyzePdfCommand}.
 *
 * A document that was already parsed answers from the analysis cached on its
 * resource record: `pageCount` and `coverUrl` are then the cached values,
 * `fileSize` the recorded byte length, and the page size and Info dictionary
 * stay neutral (0 / `{ isEncrypted: false }`) because a node never stores them.
 */
export interface AnalyzedPdfDTO {
  /** `/Pages /Count`. */
  pageCount: number;
  /** Byte length of the stored document. */
  fileSize: number;
  /** First page size in PDF points (1/72 inch). */
  pageWidth: number;
  pageHeight: number;
  /**
   * URL of the stored cover JPEG, or `""` when the first page could not be
   * rasterized or storing it failed. Cover generation is best-effort: the
   * metadata above is still returned.
   */
  coverUrl: string;
  /** Document-level parameters from the PDF Info dictionary. */
  info: PdfDocumentInfo;
}

/**
 * Asks the backend to package an already-uploaded video as HLS so a browser can
 * play it.
 *
 * Needed because the codec an upload arrives in is the recording device's
 * choice, not the browser's: a phone writing HEVC produces a node that plays its
 * audio track with no picture. Only the address of the blob travels here — the
 * client has already uploaded it.
 *
 * Importing a video (or audio) from a site URL is a different use case; it lives
 * in `../media/command.ts` because it downloads the source itself and shares one
 * pipeline with audio.
 */
export interface TranscodeVideoCommand {
  /**
   * Address of the uploaded video, absolute
   * (`http://…/api/files/files/<id>/x.mp4`) or relative
   * (`/api/files/files/<id>/x.mp4`). Addresses outside the file store are
   * rejected.
   */
  fileUrl: string;
}

/**
 * Result of {@link TranscodeVideoCommand}.
 *
 * A video that was already packaged answers from the cache on its resource
 * record: `hlsUrl`, `coverUrl`, `duration`, `width` and `height` are the stored
 * values, and the codec names are empty because they describe a transcode run
 * rather than the resource.
 */
export interface TranscodedVideoDTO {
  /** URL of the stored `.m3u8` playlist. */
  hlsUrl: string;
  /** URL of the stored poster frame, or `""` when none could be rendered. */
  coverUrl: string;
  /** Duration in seconds, `0` when the container declared none. */
  duration: number;
  width: number;
  height: number;
  /** Video codec of the *source*, e.g. `hevc`. */
  videoCodec: string;
  /** Audio codec of the source, absent when it carried no audio. */
  audioCodec?: string;
  /** True when the video stream had to be re-encoded rather than copied. */
  reencoded: boolean;
}
