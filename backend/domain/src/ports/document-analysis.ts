// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Document Analysis Ports
 *
 * Contracts for turning an uploaded blob into structured metadata. Like the
 * repository ports they live in the domain layer so that the application layer
 * can depend on them and the infrastructure layer can implement them:
 *
 * - `IDocumentAnalyzer` — pure parsing, no I/O beyond the bytes it is handed.
 * - `IFileStore`        — blob I/O against the backing store (PocketBase).
 *
 * Parsing happens on the server, never in the browser: a PDF requires a real
 * parser (and a rasterizer for its cover), and keeping it here means the web
 * client does not have to ship one.
 */

/** A rendered cover image produced by an analyzer, ready to be stored. */
export interface DocumentCover {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

/**
 * Document-level parameters read out of the PDF trailer / Info dictionary.
 * Every field is optional because PDF producers are free to omit all of them.
 */
export interface PdfDocumentInfo {
  /** `/Info /Title`. */
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  /** Producing application (e.g. `Skia/PDF m152`). */
  creator?: string;
  /** Library that wrote the file (e.g. `pdfTeX`). */
  producer?: string;
  /** Raw PDF date string, e.g. `D:20260923010212+00'00'`. */
  creationDate?: string;
  modDate?: string;
  /** PDF header version, e.g. `1.7`. */
  pdfVersion?: string;
  /** Document language from the catalog, when declared. */
  language?: string;
  /** True when the file carries an encryption dictionary. */
  isEncrypted: boolean;
}

/** Everything the backend extracts from one PDF. */
export interface PdfDocumentAnalysis {
  /** `numPages` of the document. */
  pageCount: number;
  /** Byte length of the analysed document. */
  fileSize: number;
  /** First page size in PDF points (1/72 inch), unscaled. */
  pageWidth: number;
  pageHeight: number;
  info: PdfDocumentInfo;
  /** Absent when the first page could not be rasterized. */
  cover?: DocumentCover;
}

/** Parses a file into its metadata. */
export interface IDocumentAnalyzer {
  /**
   * Parses `bytes` as a PDF.
   *
   * Rejects only when the document cannot be opened at all; a document that
   * opens but whose first page cannot be rasterized still resolves, with
   * {@link PdfDocumentAnalysis.cover} left undefined.
   */
  analyzePdf(bytes: Uint8Array): Promise<PdfDocumentAnalysis>;
}

/** A blob on its way into the store. */
export interface StoredBlob {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

/** Where a stored blob ended up. */
export interface StoredFileRef {
  /** Record id in the file store. */
  id: string;
  /** Root-relative address, `/api/files/<collection>/<record>/<name>`. */
  url: string;
}

/**
 * A stored blob streamed to a private temporary file.
 *
 * The application layer decides *what* to do with a file but owns no paths and
 * no file system calls, so the store creates the temporary location and hands
 * it over together with the way to remove it again.
 */
export interface DownloadedFile {
  /** Absolute path of the temporary copy, inside a directory private to the call. */
  path: string;
  /** Bytes written. */
  bytes: number;
  /** Removes the copy and its directory. Safe to call more than once. */
  cleanup(): Promise<void>;
}

/** Blob storage abstraction used by the upload flow. */
export interface IFileStore {
  /**
   * Reads a previously uploaded blob back out of the store.
   *
   * `fileUrl` may be absolute or relative; only URLs that point at this store's
   * own file endpoint are accepted, so a caller can never make the server fetch
   * an arbitrary address.
   */
  download(fileUrl: string): Promise<Uint8Array>;

  /**
   * Declared byte length of a stored blob.
   *
   * Lets a caller reject a file that is too large to be worth downloading,
   * before any of it is read into memory.
   */
  stat(fileUrl: string): Promise<number>;

  /**
   * Streams a stored blob into a private temporary file.
   *
   * The streaming counterpart of {@link download}: a 2 GiB video must reach
   * FFmpeg through the file system, not through the process heap. The caller
   * closes the copy with {@link DownloadedFile.cleanup}.
   */
  downloadToTempFile(fileUrl: string, suffix: string): Promise<DownloadedFile>;

  /**
   * Stores `blob` and resolves to the URL it can be read from afterwards.
   *
   * Every blob a store accepts lands beside the others in one collection, and
   * the address names it as `<anything>/api/files/<collection>/<record>/<name>`.
   * An artifact can therefore address a sibling relatively and keep working
   * behind any mount prefix; see `rewriteSegmentUrls` in the file command
   * service.
   *
   * @throws when the store rejects the write.
   */
  upload(blob: StoredBlob): Promise<string>;

  /**
   * Stores one artifact derived from the resource at `sourceUrl` — a PDF cover,
   * an HLS playlist, one of its segments, a video poster.
   *
   * Same write as {@link upload}, plus the provenance: the new record names the
   * source record as its `derivedFrom`. The resource library lists only rows
   * without that field, and deleting the source deletes the artifacts, so the
   * bytes a user frees are the bytes the quota charged.
   *
   * @throws when the store rejects the write.
   */
  uploadDerived(sourceUrl: string, blob: StoredBlob): Promise<string>;

  /**
   * Streams the file at `filePath` into the store. Resolves to the
   * root-relative address (`/api/files/…`) it can be read from afterwards.
   *
   * The streaming counterpart of {@link upload}: an assembled 2 GiB upload
   * never sits in memory on its way into the store.
   */
  uploadFromPath(
    filePath: string,
    fileName: string,
    contentType: string,
    workspaceId: string,
  ): Promise<StoredFileRef>;
}
