// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Audio container compatibility.
 *
 * A video node always has a fallback: the uploaded/downloaded file itself, and
 * if the browser cannot decode it, HLS packaging re-encodes the stream. An audio
 * node has no such fallback — the node plays the stored file with a plain
 * `<audio>` element — so an imported track must end up in a container that
 * element can play.
 *
 * Most sites answer with mp3, m4a or flac, which are fine. A webm/opus answer is
 * not safe everywhere, so the import flow converts it with FFmpeg before it is
 * stored. That one effect lives behind this port, next to the HLS transcoder.
 */

/** One file the importer wants to store, before it knows whether it can. */
export interface AudioConversionRequest {
  /** Name of the downloaded file, with its real extension. */
  fileName: string;
  /** Absolute path of the downloaded file. */
  path: string;
  /**
   * Byte ceiling for the converted result. A conversion may grow the file, so
   * the adapter refuses a result above this instead of storing something the
   * category limit would reject later.
   */
  maxBytes: number;
}

/** A file that is playable by an `<audio>` element. */
export interface AudioConversionResult {
  /** Absolute path of the file to store: the input or the converted one. */
  path: string;
  /** Stored name, with the extension of the file at {@link path}. */
  fileName: string;
  /** MIME type matching {@link fileName}'s extension. */
  contentType: string;
  /** True when the file was re-encoded rather than passed through. */
  converted: boolean;
  /** Removes any temporary file this call created. Safe to call twice. */
  cleanup(): Promise<void>;
}

/** Makes an audio file playable in a browser. */
export interface IAudioTranscoder {
  /**
   * Returns the file to store. Resolves with the input untouched when its
   * container is already playable; otherwise re-encodes it to `.m4a` (AAC) in a
   * private temporary directory and moves the caller's name onto that file.
   *
   * Rejects when the conversion cannot run or the result exceeds
   * {@link AudioConversionRequest.maxBytes}.
   */
  ensurePlayable(
    request: AudioConversionRequest,
  ): Promise<AudioConversionResult>;
}
