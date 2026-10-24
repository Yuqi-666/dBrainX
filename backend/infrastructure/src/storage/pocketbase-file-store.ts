// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Explicit `.ts` extension: the co-located tests load this module through
// Node's own resolver (`node --test`), which does not guess an extension.
import { requestToken, fileWorkspace } from "../database/request-scope.ts";
import type {
  DownloadedFile,
  IFileStore,
  StoredBlob,
  StoredFileRef,
} from "@workspace/domain";
import type { PocketBaseClient } from "../database/pocketbase-client";

/**
 * PocketBase-backed file store.
 *
 * The client uploads the original blob itself (so it keeps its progress bar and
 * never proxies a 100 MB body through tRPC); the backend then only needs the
 * address of that blob. {@link download} therefore accepts a URL but never
 * fetches it as given: the path is validated and re-resolved against this
 * server's own PocketBase origin, so a caller cannot turn the endpoint into a
 * proxy for arbitrary addresses.
 *
 * The streaming methods exist for the sizes where the in-memory pair does not.
 * A desktop upload can be 2 GiB:
 *
 * - `fs.openAsBlob` + `fetch(FormData)` was measured at 2150 MB RSS for a 2 GiB
 *   file, because the whole multipart body is buffered before the socket sees
 *   the first byte. {@link uploadFromPath} therefore writes the multipart
 *   envelope by hand (`req.write(head)`, pipe the file, `req.end(tail)`) with an
 *   explicit `Content-Length`, which measured 154 MB peak for the same file.
 * - `fetch` *is* fine for the response side: the download path only ever holds
 *   one chunk (measured 126 MB peak for 2 GiB), so {@link downloadToTempFile}
 *   streams `res.body` straight to disk instead of calling `arrayBuffer()`.
 */

// Explicit `.ts` extension, as in the co-located tests: `node --test` loads this
// module through Node's own resolver, which does not guess an extension.
import { recordIdFromFileUrl, toFileEndpointPath } from "./file-address.ts";
export { recordIdFromFileUrl, toFileEndpointPath } from "./file-address.ts";

/**
 * Copies the bytes into a plain `ArrayBuffer` before wrapping them in a `Blob`:
 * `BlobPart` only accepts views over `ArrayBuffer`, while `Uint8Array` in
 * general is typed over `ArrayBufferLike` (which includes `SharedArrayBuffer`).
 * Covers are tens of kilobytes, so the copy is not worth avoiding.
 */
function toBlob(blob: StoredBlob): Blob {
  const buffer = new ArrayBuffer(blob.bytes.byteLength);
  new Uint8Array(buffer).set(blob.bytes);
  return new Blob([buffer], { type: blob.contentType });
}

/** How much of a failed response body the error message may quote. */
const ERROR_BODY_EXCERPT_BYTES = 500;

/**
 * Reads a whole response body as text. Only used for the small JSON envelope
 * PocketBase answers a record write with, never for a file body.
 */
function readText(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    response.once("error", reject);
  });
}

/**
 * Reduces a caller's suffix suggestion to one safe path segment.
 *
 * The suffix comes from a stored file name, and it is joined into a temporary
 * path, so a separator or a `..` must not survive. Only the extension shape is
 * useful anyway: ffmpeg picks a demuxer by it, nothing else depends on it.
 */
function safeSuffix(suffix: string): string {
  const cleaned = suffix.replace(/[^A-Za-z0-9.]/g, "_").replace(/^\.+/, ".");
  return /^\.[A-Za-z0-9]{1,12}$/.test(cleaned) ? cleaned : ".bin";
}

/** One part of a hand-built `multipart/form-data` body. */
export interface MultipartEnvelope {
  /** Everything up to and including the blank line that opens the file part. */
  head: Buffer;
  /** The closing delimiter; the file's own bytes go between the two. */
  tail: Buffer;
  /**
   * Value for the `Content-Length` header: head + file + tail. Computed here, so
   * the arithmetic lives in one testable place instead of being spread over the
   * request construction.
   */
  contentLength: number;
}

/**
 * Builds the constant parts of a streamed `multipart/form-data` body.
 *
 * `fileName` is user input that lands inside a header, so CR, LF and `"` are
 * replaced with `_` before it is quoted: a bare quote would end the filename
 * parameter early and let the rest of the name be read as another header.
 * `contentType` is a value this server chooses, so it is passed through.
 *
 * `fileBytes` is the exact size of the file part the caller is about to stream;
 * only its length is used, never its content, so a 2 GiB file never passes
 * through memory.
 */
export function multipartEnvelope(
  boundary: string,
  field: string,
  fileName: string,
  contentType: string,
  fileBytes: number,
): MultipartEnvelope {
  const safeName = fileName.replace(/[\r\n"]/g, "_");
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field}"; filename="${safeName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

  return {
    head,
    tail,
    contentLength: head.length + fileBytes + tail.length,
  };
}

/**
 * Header the desktop runtime stamps on every request it proxies to its own
 * PocketBase (`apps/server/src/desktop/pb_hooks/local.pb.js`). The runtime does
 * that by patching `globalThis.fetch`, which `node:http` deliberately bypasses,
 * so the multipart upload has to add the header itself or the local database
 * answers 403. Read on every call rather than at module load: the value only
 * exists once the desktop runtime has started the backend.
 */
const INTERNAL_SECRET_ENV = "DBRAINX_PB_INTERNAL_SECRET";

/** Headers shared by the hand-built record-write request. */
function uploadHeaders(
  contentType: string,
  contentLength: number,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: requestToken(),
    "content-type": contentType,
    "content-length": String(contentLength),
  };

  const internalSecret = process.env[INTERNAL_SECRET_ENV];
  if (internalSecret) headers["X-DBrainX-Internal"] = internalSecret;

  return headers;
}

export class PocketBaseFileStore implements IFileStore {
  private readonly pb: PocketBaseClient;
  private readonly collection: string;
  private readonly field: string;

  /**
   * Plain field assignments rather than parameter properties: the co-located
   * tests run this module through Node's type-stripping loader (`node --test`),
   * which rejects TypeScript-only syntax that has a runtime effect.
   */
  constructor(pb: PocketBaseClient, collection = "files", field = "file") {
    this.pb = pb;
    this.collection = collection;
    this.field = field;
  }

  async download(fileUrl: string): Promise<Uint8Array> {
    const target = new URL(toFileEndpointPath(fileUrl), this.pb.baseUrl);
    const response = await fetch(target, {
      headers: { Authorization: requestToken() },
    });

    if (!response.ok) {
      throw new Error(
        `Could not read uploaded file (HTTP ${response.status}) at ${target.pathname}`,
      );
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * Declared byte length of a stored blob, read with a `HEAD` so no body ever
   * crosses the wire.
   *
   * The application layer calls this before a download it would rather not make:
   * the PDF analyzer has to hold the whole document in memory, so a file over
   * its limit must be rejected before a byte of it is read.
   */
  async stat(fileUrl: string): Promise<number> {
    const target = new URL(toFileEndpointPath(fileUrl), this.pb.baseUrl);
    const response = await fetch(target, {
      method: "HEAD",
      headers: { Authorization: requestToken() },
    });

    if (!response.ok) {
      throw new Error(
        `Could not read the size of an uploaded file (HTTP ${response.status}) at ${target.pathname}`,
      );
    }

    const declared = response.headers.get("content-length");
    const bytes = declared === null ? Number.NaN : Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error(
        `The file store reported no usable length for ${target.pathname}`,
      );
    }

    return bytes;
  }

  /**
   * Streaming counterpart of {@link download}: the body is piped to disk as it
   * arrives, so a 2 GiB video reaches FFmpeg through the file system rather than
   * through the process heap (measured 126 MB peak for 2 GiB). `fetch` is safe
   * here — unlike the upload direction nothing has to be buffered before the
   * request is sent.
   *
   * The temporary directory is created and owned by this method: the caller gets
   * a path and the way to remove it, and never has to know where the store keeps
   * its scratch space. `suffix` only decides the demuxer's extension, so it is
   * reduced to one safe path segment before it is joined.
   */
  async downloadToTempFile(
    fileUrl: string,
    suffix: string,
  ): Promise<DownloadedFile> {
    const dir = await mkdtemp(join(tmpdir(), "dbrainx-download-"));
    const destPath = join(dir, `source${safeSuffix(suffix)}`);

    let bytes: number;
    try {
      bytes = await this.downloadToPath(fileUrl, destPath);
    } catch (error) {
      // A failed download must not leave its scratch directory behind.
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    return {
      path: destPath,
      bytes,
      cleanup: () => rm(dir, { recursive: true, force: true }),
    };
  }

  /**
   * Pipes a stored blob into `destPath`, which the caller owns.
   *
   * Not part of {@link IFileStore}: the application layer must not choose paths,
   * so the port only exposes {@link downloadToTempFile}. This is the shared
   * implementation of both, and a caller that already owns a path (a test, a
   * one-off script) can still use it.
   */
  async downloadToPath(fileUrl: string, destPath: string): Promise<number> {
    const target = new URL(toFileEndpointPath(fileUrl), this.pb.baseUrl);
    const response = await fetch(target, {
      headers: { Authorization: requestToken() },
    });

    if (!response.ok) {
      throw new Error(
        `Could not read uploaded file (HTTP ${response.status}) at ${target.pathname}`,
      );
    }
    if (!response.body) {
      throw new Error(
        `The file store returned an empty body for ${target.pathname}`,
      );
    }

    await pipeline(
      // `fromWeb` is typed against the DOM `ReadableStream`, while the fetch
      // types hand back the Node flavour of it; the cast only bridges the two
      // declarations, the object is the same stream.
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(destPath),
    );

    // The byte count comes from the file system, not from a running total: it is
    // the number the caller compares against the size it expects.
    return (await stat(destPath)).size;
  }

  async upload(blob: StoredBlob): Promise<string> {
    return this.store(blob);
  }

  /**
   * Stores one artifact derived from a resource and names the source record as
   * its `derivedFrom`. The library hides such rows, and deleting the source
   * deletes them, so the artifact's bytes are accounted and released together
   * with the resource they were made from.
   */
  async uploadDerived(sourceUrl: string, blob: StoredBlob): Promise<string> {
    return this.store(blob, {
      derivedFrom: recordIdFromFileUrl(sourceUrl),
    });
  }

  /**
   * Creates one `files` record, optionally with extra text fields, and resolves
   * to the root-relative address of the stored blob.
   *
   * The workspace is taken from the request scope rather than from the caller:
   * the API only writes a blob while it is handling a request that already
   * resolved which workspace the source resource belongs to.
   */
  private async store(
    blob: StoredBlob,
    extra: Record<string, string> = {},
  ): Promise<string> {
    const form = new FormData();
    form.append(this.field, toBlob(blob), blob.fileName);
    for (const [name, value] of Object.entries(extra)) form.append(name, value);
    if (fileWorkspace()) form.append("workspaceId", fileWorkspace());

    const record = await this.pb.collection(this.collection).create(form);
    const storedName = record[this.field];
    if (typeof storedName !== "string" || storedName.length === 0) {
      throw new Error(
        `Storing the file returned no "${this.field}" value on the new record`,
      );
    }

    const url = this.pb.client.files.getURL(record, storedName);
    return new URL(url).pathname;
  }

  /**
   * Streaming counterpart of {@link upload}: one record-create request whose
   * multipart body is built by hand and streamed from `filePath`, so the file
   * never has to be materialized as a `Blob`. See the class comment for the
   * measurement that makes this necessary.
   *
   * A `workspaceId` text part is added only when it is non-empty: the field does
   * not exist on every collection, and PocketBase rejects an unknown body field.
   */
  async uploadFromPath(
    filePath: string,
    fileName: string,
    contentType: string,
    workspaceId: string,
  ): Promise<StoredFileRef> {
    const fileBytes = (await stat(filePath)).size;
    const boundary = `----dbrainx${randomBytes(8).toString("hex")}`;

    // The workspace part precedes the file part, so the head is not constant:
    // build it here and let `multipartEnvelope` keep the size arithmetic.
    const workspacePart = workspaceId
      ? Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="workspaceId"\r\n\r\n` +
            `${workspaceId}\r\n`,
        )
      : Buffer.alloc(0);
    const envelope = multipartEnvelope(
      boundary,
      this.field,
      fileName,
      contentType,
      fileBytes,
    );
    const head = Buffer.concat([workspacePart, envelope.head]);
    const contentLength = head.length + fileBytes + envelope.tail.length;

    const target = new URL(
      `/api/collections/${this.collection}/records`,
      this.pb.baseUrl,
    );
    const record = await this.postStream(target, head, envelope.tail, {
      path: filePath,
      fileName,
      contentLength,
      boundary,
    });

    return {
      id: record.id,
      url: `/api/files/${record.collectionId}/${record.id}/${record.storedName}`,
    };
  }

  /**
   * Sends one `node:http` POST whose body is `head`, then the file, then `tail`,
   * and resolves with the created record once the store has confirmed it.
   *
   * `fetch` cannot express this: a `FormData` body is serialized in full before
   * the first byte goes out, and a `ReadableStream` body would need a chunked
   * transfer encoding instead of the `Content-Length` PocketBase is happiest
   * with. `node:http` also bypasses the runtime's patched `globalThis.fetch`,
   * which is why this path adds the internal header itself.
   */
  private postStream(
    target: URL,
    head: Buffer,
    tail: Buffer,
    file: {
      path: string;
      fileName: string;
      contentLength: number;
      boundary: string;
    },
  ): Promise<{ id: string; collectionId: string; storedName: string }> {
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        target,
        {
          method: "POST",
          headers: uploadHeaders(
            `multipart/form-data; boundary=${file.boundary}`,
            file.contentLength,
          ),
        },
        (response) => {
          readText(response)
            .then((body) => {
              const status = response.statusCode ?? 0;
              if (status < 200 || status >= 300) {
                reject(
                  new Error(
                    `Storing ${file.fileName} failed (HTTP ${status}): ` +
                      `${body.slice(0, ERROR_BODY_EXCERPT_BYTES)}`,
                  ),
                );
                return;
              }

              let parsed: Record<string, unknown>;
              try {
                parsed = JSON.parse(body) as Record<string, unknown>;
              } catch {
                reject(
                  new Error(
                    `The file store returned an unreadable record body: ${body.slice(0, ERROR_BODY_EXCERPT_BYTES)}`,
                  ),
                );
                return;
              }

              const id = parsed.id;
              const collectionId = parsed.collectionId;
              const storedName = parsed[this.field];
              if (
                typeof id !== "string" ||
                typeof collectionId !== "string" ||
                typeof storedName !== "string" ||
                storedName.length === 0
              ) {
                reject(
                  new Error(
                    `Storing ${file.fileName} returned no "${this.field}" value on the new record`,
                  ),
                );
                return;
              }

              resolve({ id, collectionId, storedName });
            })
            .catch(reject);
        },
      );

      request.once("error", reject);
      request.write(head);
      pipeline(
        createReadStream(file.path, { highWaterMark: 1 << 20 }),
        request,
        {
          end: false,
        },
      )
        .then(() => {
          request.end(tail);
        })
        .catch((error: unknown) => {
          // A read failure leaves the request half-sent: destroy it so the
          // socket is not held open until the store times out.
          request.destroy();
          reject(error);
        });
    });
  }
}
