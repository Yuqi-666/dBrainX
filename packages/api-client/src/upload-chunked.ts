// SPDX-License-Identifier: AGPL-3.0-only

import type {
  CreateUploadSessionRequest,
  IAttachment,
  UploadSessionDTO,
} from "@workspace/interfaces";
import { useWorkspaceStore } from "@workspace/store";
import {
  MAX_UPLOAD_BYTES,
  chunkCountFor,
  chunkLengthFor,
  uploadCompletePath,
  uploadPartPath,
  uploadSessionPath,
  uploadSessionsPath,
} from "@workspace/utils/upload";

import { readAuthSessionToken } from "./auth/session";
import { resolveBackendUrls } from "./backend-urls";
import { getPocketbaseClient } from "./pocketbase-client";
import { resolveFileUrl } from "./upload";

/**
 * Resumable upload of a file that is too large for one request.
 *
 * The flow is the frozen server protocol:
 *
 *   POST   /upload/sessions                  → 201 session (resumes by fingerprint)
 *   PUT    /upload/sessions/{id}/parts/{n}   → 200 session (one chunk, raw bytes)
 *   GET    /upload/sessions/{id}             → 200 session (poll while assembling)
 *   POST   /upload/sessions/{id}/complete    → 202 session (`assembling`)
 *
 * Two properties matter more than speed here:
 *
 * 1. **The chunks are the resume point.** Everything is addressed by a
 *    fingerprint of the picked file, and a session is only ever removed by the
 *    server when it finishes or expires — never by this client. An abort (or a
 *    closed tab) therefore costs at most the chunks that were in flight, and
 *    the next attempt PUTs only what the server reports as missing.
 * 2. **Nothing here may fail an upload for an optional reason.** The session
 *    hint in `localStorage` is written best-effort, the server owns the chunk
 *    geometry, and only the retry policy's own cases are repeated.
 */

/** One abort message for the whole package; the direct path throws it too. */
const ABORT_MESSAGE = "Upload aborted";

/**
 * Chunks in flight at once.
 *
 * Three keeps a slow uplink busy without turning a 2 GiB upload into 256
 * parallel sockets, and it is small enough that an abort only ever has three
 * XHRs to cancel.
 */
const CHUNK_CONCURRENCY = 3;

/** Extra attempts per chunk after the first one fails. */
const CHUNK_MAX_RETRIES = 3;

/**
 * How often `complete` may be rejected for chunks the server does not have
 * before the upload fails.
 *
 * A `409` that names missing chunks is recoverable: the file is still in the
 * browser, so those chunks are simply sent again. It happens when a session is
 * swept mid-upload, or when the server answered a part `PUT` with `404` for a
 * live session and this client continued in a new one — the chunks that went to
 * the first session are then still missing. The cap only stops a server that
 * keeps losing chunks from looping forever.
 */
const COMPLETE_MAX_RETRIES = 3;

/** Backoff before each retry, in order: 500 ms, 1 s, 2 s. */
const RETRY_BACKOFF_MS = [500, 1000, 2000];

/**
 * How often one chunk may find its session gone (404) and have it re-opened.
 *
 * A single re-open is the expected case — the server sweeps an expired
 * session, the fingerprint opens a fresh one — and the cap only stops a
 * server that answers 404 forever from looping the whole upload.
 */
const MAX_SESSION_REOPENS = 3;

/**
 * Per-request ceiling.
 *
 * Long enough that an 8 MiB chunk completes on any usable link, short enough
 * that a stalled socket becomes the retry policy's "timeout" case instead of
 * hanging the upload for good.
 */
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/** How long to wait between two status reads while the server assembles. */
const ASSEMBLY_POLL_INTERVAL_MS = 1000;

/**
 * Overall ceiling for the assembling phase.
 *
 * Deliberately generous: the server spools up to {@link MAX_UPLOAD_BYTES} of
 * parts to disk and streams the assembled file into the file store, so a big
 * upload can legitimately spend minutes here. The deadline exists to turn a
 * stuck session into an error instead of a progress bar that never finishes.
 */
const ASSEMBLY_DEADLINE_MS = 30 * 60 * 1000;

/**
 * `localStorage` key prefix for the per-fingerprint session hint.
 *
 * Namespaced so the app never collides with another key on the same origin,
 * and per fingerprint so two different files cannot overwrite each other's
 * resume hint.
 */
const SESSION_STORAGE_PREFIX = "dbrain.upload.session:";

/** Response the retry policy may repeat: a dead socket or a dead timeout. */
class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

/** A response the server actually produced, with its status kept for policy. */
class HttpError extends Error {
  status: number;

  /**
   * Chunk indexes the server reported as missing, when it reported any.
   *
   * Only `409` from `complete` carries this, and it is the one server answer
   * that is worth acting on rather than reporting: the chunks can be sent again.
   */
  missing: number[];

  constructor(status: number, message: string, missing: number[] = []) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.missing = missing;
  }
}

/**
 * `404` from a part `PUT`: the session was swept while the upload was running.
 *
 * Its own type because the recovery is not a retry with backoff — the client
 * has to open a new session for the same fingerprint and continue.
 */
class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

/** Persisted resume hint. Shape is what a later page load needs to re-match. */
interface StoredUploadSession {
  uploadId: string;
  fingerprint: string;
  fileName: string;
  fileSize: number;
}

/** Identifies one browser file the way the server's resume lookup does. */
export async function uploadFingerprint(file: File, workspaceId: string): Promise<string> {
  // Name, size, modification time and workspace together are what "the same
  // file" means to a user: re-picking the file after an edit changes the
  // timestamp, copying it into another workspace changes the workspace, and
  // the same file picked twice hashes the same.
  const value = `${file.name}\u0000${file.size}\u0000${file.lastModified}\u0000${workspaceId}`;

  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    // `crypto.subtle` only exists in a secure context, and the development
    // stack is also opened over plain HTTP from another machine's browser.
    // The fingerprint is a resume key, not a secret: it only has to stay
    // unchanged for one file in one workspace across reloads.
    return fallbackFingerprint(value);
  }
}

/**
 * Deterministic stand-in for SHA-256 when `crypto.subtle` is unavailable.
 *
 * FNV-1a in 64 bits: a handful of lines, no dependency, and stable across
 * reloads and machines, which is everything a resume key needs. It is not
 * collision-resistant, which is why a colliding session hint is discarded by
 * the file-identity check in `uploadChunked`.
 */
export function fallbackFingerprint(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `fnv1a64-${hash.toString(16).padStart(16, "0")}`;
}

/**
 * `localStorage` when it can be used at all.
 *
 * Even the lookup is guarded: reading `window.localStorage` itself throws in
 * Safari's private mode and inside a sandboxed iframe, and an upload must not
 * depend on a resume hint having somewhere to live.
 */
function resumeStorage(): Storage | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    return window.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

function readStoredSession(fingerprint: string): StoredUploadSession | undefined {
  try {
    const raw = resumeStorage()?.getItem(SESSION_STORAGE_PREFIX + fingerprint);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredUploadSession> | null;
    if (!parsed || typeof parsed.uploadId !== "string" || !parsed.uploadId) {
      return undefined;
    }
    return {
      uploadId: parsed.uploadId,
      fingerprint,
      fileName: String(parsed.fileName ?? ""),
      fileSize: Number(parsed.fileSize ?? 0),
    };
  } catch {
    return undefined;
  }
}

function writeStoredSession(fingerprint: string, uploadId: string, file: File): void {
  const record: StoredUploadSession = {
    uploadId,
    fingerprint,
    fileName: file.name,
    fileSize: file.size,
  };
  try {
    resumeStorage()?.setItem(
      SESSION_STORAGE_PREFIX + fingerprint,
      JSON.stringify(record),
    );
  } catch {
    // Private mode and a full quota both throw here. Resuming is a nicety; the
    // upload itself continues and only loses its cross-reload head start.
  }
}

function clearStoredSession(fingerprint: string): void {
  try {
    resumeStorage()?.removeItem(SESSION_STORAGE_PREFIX + fingerprint);
  } catch {
    // Nothing to do: a leftover hint only makes the next attempt POST once.
  }
}

/**
 * Token for one upload request.
 *
 * The web reads the `pb_token` cookie on every request, so a renewal or a
 * logout in another tab cannot leave a stale token behind; the desktop app has
 * no cookie and uses the device token the native supervisor installed in the
 * local SDK. The SDK is only consulted in desktop mode, where the cookie does
 * not exist.
 */
function authToken(): string | undefined {
  if (process.env.NEXT_PUBLIC_DBRAIN_PLATFORM === "desktop") {
    return getPocketbaseClient().authStore?.token;
  }
  return readAuthSessionToken();
}

/** HTTP base of the Node server that accepts upload sessions. */
function uploadBase(): string {
  return resolveBackendUrls().upload.replace(/\/+$/, "");
}

/**
 * The `{ message, missing? }` body the upload routes answer with.
 *
 * Every field is optional and unvalidated: a proxy or an error page may answer
 * with HTML, and that must degrade to a generic message rather than throwing a
 * parse error over the top of the real failure.
 */
function errorBody(text: string): { message?: string; missing: number[] } {
  try {
    const body = JSON.parse(text) as { message?: unknown; missing?: unknown } | null;
    return {
      message: typeof body?.message === "string" ? body.message : undefined,
      missing: Array.isArray(body?.missing)
        ? body.missing.filter(
            (value): value is number => Number.isInteger(value) && (value as number) >= 0,
          )
        : [],
    };
  } catch {
    return { missing: [] };
  }
}

/**
 * Error for a response the caller should see.
 *
 * The server's own `{ "message": string }` wins whenever it is present: for a
 * `413` it is the only text that explains *which* limit was hit, and for the
 * `409` of an incomplete `complete` it is how the client learns which chunks to
 * send again.
 */
function errorFromResponse(status: number, text: string): HttpError {
  const body = errorBody(text);
  return new HttpError(
    status,
    body.message ?? `Upload failed with status ${status}`,
    body.missing,
  );
}

function parseSession(text: string): UploadSessionDTO {
  let session: UploadSessionDTO;
  try {
    session = JSON.parse(text) as UploadSessionDTO;
  } catch {
    throw new Error("Upload failed: the server returned an invalid response");
  }
  if (!session || typeof session.uploadId !== "string" || !session.uploadId) {
    throw new Error("Upload failed: the server returned an invalid session");
  }
  return session;
}

interface RequestOptions {
  method: "GET" | "POST" | "PUT";
  url: string;
  body?: Blob | string;
  contentType?: string;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

interface HttpResponse {
  status: number;
  text: string;
}

/**
 * One XHR request, with the abort/progress behaviour every upload request
 * shares.
 *
 * `Content-Length` is not set here and cannot be: it is a forbidden header, and
 * the browser derives it from the blob body, which is exactly what the server
 * needs to spool a part.
 */
function sendRequest(options: RequestOptions): Promise<HttpResponse> {
  return new Promise<HttpResponse>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error(ABORT_MESSAGE));
      return;
    }

    const xhr = new XMLHttpRequest();

    const onAbort = () => {
      xhr.abort();
      reject(new Error(ABORT_MESSAGE));
    };
    const cleanup = () => options.signal?.removeEventListener("abort", onAbort);
    options.signal?.addEventListener("abort", onAbort, { once: true });

    xhr.timeout = REQUEST_TIMEOUT_MS;

    if (options.onProgress) {
      const report = options.onProgress;
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) report(event.loaded, event.total);
      });
    }

    xhr.addEventListener("load", () => {
      cleanup();
      resolve({ status: xhr.status, text: xhr.responseText });
    });
    xhr.addEventListener("error", () => {
      cleanup();
      reject(new NetworkError("Upload failed: network error"));
    });
    xhr.addEventListener("timeout", () => {
      cleanup();
      reject(new NetworkError("Upload failed: request timed out"));
    });
    xhr.addEventListener("abort", () => {
      cleanup();
      reject(new Error(ABORT_MESSAGE));
    });

    xhr.open(options.method, options.url);
    if (options.contentType) {
      xhr.setRequestHeader("Content-Type", options.contentType);
    }
    const token = authToken();
    if (token) xhr.setRequestHeader("Authorization", token);

    xhr.send(options.body);
  });
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

async function openSession(
  request: CreateUploadSessionRequest,
  signal?: AbortSignal,
): Promise<UploadSessionDTO> {
  const response = await sendRequest({
    method: "POST",
    url: `${uploadBase()}${uploadSessionsPath()}`,
    body: JSON.stringify(request),
    contentType: "application/json",
    signal,
  });
  if (!isSuccess(response.status)) {
    throw errorFromResponse(response.status, response.text);
  }
  return parseSession(response.text);
}

async function readSession(
  uploadId: string,
  signal?: AbortSignal,
): Promise<UploadSessionDTO> {
  const response = await sendRequest({
    method: "GET",
    url: `${uploadBase()}${uploadSessionPath(uploadId)}`,
    signal,
  });
  if (!isSuccess(response.status)) {
    throw errorFromResponse(response.status, response.text);
  }
  return parseSession(response.text);
}

async function completeSession(
  uploadId: string,
  signal?: AbortSignal,
): Promise<UploadSessionDTO> {
  const response = await sendRequest({
    method: "POST",
    url: `${uploadBase()}${uploadCompletePath(uploadId)}`,
    signal,
  });
  if (!isSuccess(response.status)) {
    throw errorFromResponse(response.status, response.text);
  }
  return parseSession(response.text);
}

/**
 * `PUT` one chunk and return nothing but success.
 *
 * A `404` is translated here so the retry policy can tell "repeat this request"
 * apart from "this session no longer exists".
 */
async function putPart(
  uploadId: string,
  index: number,
  chunk: Blob,
  signal: AbortSignal | undefined,
  onProgress: (loaded: number, total: number) => void,
): Promise<void> {
  const response = await sendRequest({
    method: "PUT",
    url: `${uploadBase()}${uploadPartPath(uploadId, index)}`,
    body: chunk,
    contentType: "application/octet-stream",
    signal,
    onProgress,
  });
  if (response.status === 404) {
    throw new SessionExpiredError("Upload failed: the upload session expired");
  }
  if (!isSuccess(response.status)) {
    throw errorFromResponse(response.status, response.text);
  }
}

/**
 * Whether repeating the exact same request can help.
 *
 * Retried: a dead socket, a timeout, `408`, `429` and every `5xx`. Never
 * retried: `400`/`401`/`413` and the rest of `4xx` — repeating a request the
 * server already rejected for being wrong or too large only wastes minutes.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (error instanceof HttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return false;
}

/** Resolve after `ms`, or reject with the abort error if the signal fires. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(ABORT_MESSAGE));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error(ABORT_MESSAGE));
    };
    // Declared after `onAbort` closes over it, and only reachable through the
    // listener below, so the timer always exists by the time it is read.
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function putPartWithRetry(options: {
  uploadId: string;
  index: number;
  chunk: Blob;
  signal?: AbortSignal;
  onProgress: (loaded: number, total: number) => void;
}): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await putPart(
        options.uploadId,
        options.index,
        options.chunk,
        options.signal,
        options.onProgress,
      );
      return;
    } catch (error) {
      // A swept session is recovered by re-opening it, not by waiting, and an
      // abort must never turn into "let us try that again".
      if (error instanceof SessionExpiredError) throw error;
      if (options.signal?.aborted || !isRetryable(error)) throw error;
      if (attempt >= CHUNK_MAX_RETRIES) throw error;
      const backoff =
        RETRY_BACKOFF_MS[attempt] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1] ?? 500;
      await sleep(backoff, options.signal);
    }
  }
}

/**
 * Chunk indexes still missing, in ascending order.
 *
 * The server owns the geometry: a deployment may answer with a larger
 * `chunkSize` than the shared default, and slicing at the default instead would
 * corrupt every part but the first. `received` is what makes this a resume
 * rather than a restart, and a server that reports no `chunkCount` is planned
 * with the frozen arithmetic for the size it did report. A `chunkCount` beyond
 * what the file can hold is not silently trimmed — `chunkBlob` throws, because
 * an inconsistent plan means the two sides disagree about the file.
 */
function missingChunkIndexes(
  fileSize: number,
  session: UploadSessionDTO,
): number[] {
  if (!(session.chunkSize > 0)) {
    throw new Error("Upload failed: the server returned an invalid chunk size");
  }
  const chunkCount =
    session.chunkCount > 0
      ? session.chunkCount
      : chunkCountFor(fileSize, session.chunkSize);
  const received = new Set(session.received ?? []);
  const missing: number[] = [];
  for (let index = 0; index < chunkCount; index += 1) {
    if (!received.has(index)) missing.push(index);
  }
  return missing;
}

/** The exact slice of `file` that chunk `index` carries. */
function chunkBlob(file: File, index: number, chunkSize: number): Blob {
  const length = chunkLengthFor(file.size, index, chunkSize);
  if (length <= 0) {
    throw new Error(`Upload failed: chunk ${index} is outside the file`);
  }
  const start = index * chunkSize;
  return file.slice(start, start + length);
}

/**
 * Uploads a large file in chunks and returns the stored file as an
 * {@link IAttachment}.
 *
 * @param file - The file to upload; its size must exceed `DIRECT_UPLOAD_MAX_BYTES`.
 * @param onProgress - Aggregate progress (0-100), monotonic and ending at 100.
 * @param signal - Abort signal; it cancels the requests, never the session.
 */
export async function uploadChunked(
  file: File,
  onProgress: (event: { progress: number }) => void,
  signal?: AbortSignal,
): Promise<IAttachment> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Upload failed: the file is larger than ${MAX_UPLOAD_BYTES} bytes`,
    );
  }
  if (signal?.aborted) throw new Error(ABORT_MESSAGE);

  const workspaceId = useWorkspaceStore.getState().currentWorkspaceId ?? "";
  const fingerprint = await uploadFingerprint(file, workspaceId);

  // The hint is only a hint: the server matches on the fingerprint, and this
  // client never sends the stored id. It is read so a collision in the
  // non-crypto fallback cannot point the next attempt at another file's
  // session, and it is dropped the moment the file identity disagrees.
  const stored = readStoredSession(fingerprint);
  if (stored && (stored.fileName !== file.name || stored.fileSize !== file.size)) {
    clearStoredSession(fingerprint);
  }

  const createRequest: CreateUploadSessionRequest = {
    fileName: file.name,
    fileSize: file.size,
    contentType: file.type || "",
    workspaceId,
    fingerprint,
  };

  let session = await openSession(createRequest, signal);
  writeStoredSession(fingerprint, session.uploadId, file);

  // Aggregate progress: every chunk's own XHR reports its bytes, and the sum is
  // clamped monotonic because a retried chunk restarts at zero and a rounded
  // percentage can otherwise step backwards.
  const loadedByIndex = new Map<number, number>();
  let lastPercent = 0;
  const flushProgress = () => {
    let loaded = 0;
    for (const value of loadedByIndex.values()) loaded += value;
    const percent =
      file.size > 0
        ? Math.min(100, Math.round((loaded / file.size) * 100))
        : 0;
    if (percent <= lastPercent) return;
    lastPercent = percent;
    onProgress({ progress: percent });
  };

  // The plan is a queue plus the set of indexes sitting in it, so a reopen can
  // add what a *different* session is missing without queueing anything twice.
  const queue = missingChunkIndexes(file.size, session);
  const queued = new Set(queue);
  const enqueue = (indexes: number[]): void => {
    for (const index of indexes) {
      if (queued.has(index)) continue;
      queued.add(index);
      queue.push(index);
    }
  };

  let reopens = 0;
  let reopening: Promise<void> | undefined;

  /**
   * Open a new session for the same fingerprint after a `404`.
   *
   * Only one POST runs while several chunks discover the same swept session.
   */
  const reopenSession = async (): Promise<void> => {
    if (reopening) return reopening;
    if (reopens >= MAX_SESSION_REOPENS) {
      throw new Error("Upload failed: the upload session kept expiring");
    }
    reopens += 1;
    reopening = openSession(createRequest, signal)
      .then((next) => {
        session = next;
      })
      .finally(() => {
        reopening = undefined;
      });
    return reopening;
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) throw new Error(ABORT_MESSAGE);
      const index = queue.shift();
      if (index === undefined) return;
      queued.delete(index);

      try {
        await putPartWithRetry({
          uploadId: session.uploadId,
          index,
          chunk: chunkBlob(file, index, session.chunkSize),
          signal,
          onProgress: (loaded, total) => {
            loadedByIndex.set(index, Math.min(loaded, total));
            flushProgress();
          },
        });
        loadedByIndex.set(index, chunkLengthFor(file.size, index, session.chunkSize));
        flushProgress();
      } catch (error) {
        if (error instanceof SessionExpiredError) {
          await reopenSession();
          // The plan belonged to the session that just went away, so it is
          // recomputed from what the new one reports. Everything sent to the
          // old session — and the chunk that failed here — is missing there,
          // and a plan that only put this one chunk back would leave the rest
          // behind and be rejected by `complete` for them.
          enqueue(missingChunkIndexes(file.size, session));
          continue;
        }
        throw error;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CHUNK_CONCURRENCY, queue.length) }, () => worker()),
  );

  // The last byte may have been counted by a rounded-up percentage already, so
  // only a missing 100 is emitted here; the caller always ends at 100.
  if (lastPercent < 100) {
    lastPercent = 100;
    onProgress({ progress: 100 });
  }

  /**
   * `complete`, re-sending the chunks the server says it never got.
   *
   * This is the safety net under the session bookkeeping: a session swept
   * mid-upload, or a part `PUT` that answered `404` for a session that was in
   * fact still there, leaves chunks in a session nobody will assemble. The
   * server names them in its `409`, and they are still in the browser, so the
   * upload continues instead of failing after all of its bytes were sent.
   */
  const completeWithHealing = async (): Promise<UploadSessionDTO> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await completeSession(session.uploadId, signal);
      } catch (error) {
        const missing = error instanceof HttpError ? error.missing : [];
        if (missing.length === 0 || attempt >= COMPLETE_MAX_RETRIES) throw error;
        await Promise.all(
          missing.map((index) =>
            putPartWithRetry({
              uploadId: session.uploadId,
              index,
              chunk: chunkBlob(file, index, session.chunkSize),
              signal,
              // Progress is already at 100 and counts bytes the user sent once;
              // a re-sent chunk must not push it backwards.
              onProgress: () => undefined,
            }),
          ),
        );
      }
    }
  };

  // Deliberately no `DELETE` on abort: the stored parts are the resume point,
  // and the server sweeps an abandoned session on its own schedule.
  let state = await completeWithHealing();

  const deadline = Date.now() + ASSEMBLY_DEADLINE_MS;
  while (state.status !== "done" && state.status !== "error") {
    if (Date.now() >= deadline) {
      throw new Error("Upload failed: the server did not finish assembling in time");
    }
    await sleep(ASSEMBLY_POLL_INTERVAL_MS, signal);
    state = await readSession(session.uploadId, signal);
  }

  if (state.status === "error") {
    throw new Error(state.error || "Upload failed: the server reported an error");
  }

  const attachment = state.attachment;
  if (!attachment) {
    throw new Error("Upload failed: the server returned no attachment");
  }

  clearStoredSession(fingerprint);

  return {
    id: attachment.id,
    // The server may rename the file on disk; the caller gets the name the user
    // picked, exactly as the direct path does.
    fileName: file.name,
    fileSize: file.size,
    updatedAt: attachment.updatedAt,
    url: resolveFileUrl(attachment.url),
  };
}
