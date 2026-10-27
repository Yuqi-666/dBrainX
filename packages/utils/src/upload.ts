// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Resumable-upload contract shared by the browser clients and the server.
 *
 * Two transports exist for one file:
 *
 * - **Direct** — at or below {@link DIRECT_UPLOAD_MAX_BYTES} the client POSTs
 *   the whole file to the file store in one request, exactly as it always has.
 * - **Chunked** — above that threshold the client opens a *session*, PUTs
 *   fixed-size chunks, and asks the server to assemble them. The server spools
 *   the chunks to disk and streams the assembled file into the file store, so
 *   no part of the pipeline holds more than one chunk in memory.
 *
 * These values are runtime constants, not types, so they live in
 * `@workspace/utils`; the wire shapes stay in `@workspace/interfaces`. The
 * client (`packages/api-client`) and the server both import this module, so the
 * two sides cannot drift.
 */

/** Largest file the upload pipeline accepts, in bytes (2 GiB). */
export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;

/**
 * Bytes carried by one chunk on the chunked path.
 *
 * Small enough that a chunk request stays well under every proxy limit in the
 * deployment (nginx `client_max_body_size` is 100 MiB), large enough that a
 * 2 GiB file needs only 256 requests.
 */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 ** 2;

/**
 * Largest file the client still sends in a single request.
 *
 * Below the nginx and PocketBase single-request limits, so a small file keeps
 * its old one-request path and no proxy configuration has to change.
 */
export const DIRECT_UPLOAD_MAX_BYTES = 32 * 1024 ** 2;

/**
 * Largest PDF the server will parse.
 *
 * Uploading a bigger PDF still works — the blob is stored and downloadable —
 * but the parser needs the whole document in memory (pdf.js), and a rasterizer
 * on top of it, so past this size the analysis is skipped instead of risking
 * the server process.
 */
export const PDF_ANALYZE_MAX_BYTES = 256 * 1024 ** 2;

/** Path prefix of the upload endpoints, relative to the resolved upload base. */
export const UPLOAD_BASE_PATH = "/upload";

export const UPLOAD_SESSIONS_PATH = `${UPLOAD_BASE_PATH}/sessions`;

/** `POST` here opens (or resumes) a session. */
export function uploadSessionsPath(): string {
  return UPLOAD_SESSIONS_PATH;
}

/** `GET` / `DELETE` here read or drop one session. */
export function uploadSessionPath(uploadId: string): string {
  return `${UPLOAD_SESSIONS_PATH}/${encodeURIComponent(uploadId)}`;
}

/** `PUT` one chunk here. */
export function uploadPartPath(uploadId: string, index: number): string {
  return `${uploadSessionPath(uploadId)}/parts/${index}`;
}

/** `POST` here to ask the server to assemble and store the file. */
export function uploadCompletePath(uploadId: string): string {
  return `${uploadSessionPath(uploadId)}/complete`;
}

/** A resolved upload route, or `undefined` when the path is not one. */
export type UploadRoute =
  | { kind: "sessions" }
  | { kind: "session"; uploadId: string }
  | { kind: "part"; uploadId: string; index: number }
  | { kind: "complete"; uploadId: string }
  | { kind: "unknown" };

/**
 * Parses an upload path (`/upload/sessions/<id>/parts/0`).
 *
 * Used by the server so the client and the server agree on the routes; an
 * unrecognised shape is reported as `unknown` rather than guessed at.
 */
export function parseUploadRoute(pathname: string): UploadRoute {
  const path = pathname.split("?")[0] ?? "";
  if (path === UPLOAD_SESSIONS_PATH) return { kind: "sessions" };

  const prefix = `${UPLOAD_SESSIONS_PATH}/`;
  if (!path.startsWith(prefix)) return { kind: "unknown" };

  const rest = path.slice(prefix.length).split("/");
  let uploadId = "";
  try {
    uploadId = decodeURIComponent(rest[0] ?? "");
  } catch {
    return { kind: "unknown" };
  }
  if (!uploadId) return { kind: "unknown" };

  if (rest.length === 1) return { kind: "session", uploadId };
  if (rest.length === 2 && rest[1] === "complete")
    return { kind: "complete", uploadId };
  if (rest.length === 3 && rest[1] === "parts") {
    const index = Number(rest[2]);
    if (!Number.isSafeInteger(index) || index < 0) return { kind: "unknown" };
    return { kind: "part", uploadId, index };
  }
  return { kind: "unknown" };
}

/**
 * Number of chunks one file needs.
 *
 * A zero-byte file needs no chunk at all; the pipeline rejects it earlier.
 */
export function chunkCountFor(fileSize: number, chunkSize = UPLOAD_CHUNK_BYTES): number {
  if (fileSize <= 0) return 0;
  return Math.ceil(fileSize / chunkSize);
}

/** Byte length of chunk `index` (the last chunk may be short). */
export function chunkLengthFor(
  fileSize: number,
  index: number,
  chunkSize = UPLOAD_CHUNK_BYTES,
): number {
  const start = index * chunkSize;
  if (start >= fileSize) return 0;
  return Math.min(chunkSize, fileSize - start);
}
