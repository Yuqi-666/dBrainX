// SPDX-License-Identifier: AGPL-3.0-only

import type {
  DocumentCover,
  IDocumentAnalyzer,
  IFileStore,
  IMediaAnalysisStore,
  IStorageUsageReader,
  IVideoTranscoder,
} from "@workspace/domain";
import type { StorageLimits } from "@workspace/utils/storage-limits";
import type {
  AnalyzePdfCommand,
  AnalyzedPdfDTO,
  TranscodeVideoCommand,
  TranscodedVideoDTO,
} from "./command";
import { rewriteSegmentUrls } from "./hls-playlist.ts";

/**
 * File upload use cases.
 *
 * Everything a browser cannot do with an uploaded blob happens here: parsing a
 * PDF's parameters, rendering its cover, and packaging a video as HLS in a codec
 * browsers decode. The service owns the ordering — fetch the blob, transform it,
 * store the results — while parsing, transcoding and blob I/O stay behind the
 * {@link IDocumentAnalyzer}, {@link IVideoTranscoder} and {@link IFileStore}
 * ports.
 *
 * Importing a video or an audio file from a site URL is the shared media use
 * case and lives in `../media/media-import.service.ts`: it downloads the source
 * itself and post-processes it per kind, which is more than this upload-side
 * service should own.
 *
 * The PDF and transcode use cases are **idempotent per resource**. The result is
 * cached on the record that owns the blob through {@link IMediaAnalysisStore},
 * and a second call returns that result without fetching, parsing, transcoding
 * or storing anything. Every node that references the same resource therefore
 * shares one cover and one HLS package, instead of adding a copy per reference.
 *
 * Both use cases pull the blob through a temporary file rather than through
 * `download()`: an upload may be 2 GiB, and a video has to reach FFmpeg as a
 * path either way. The temp directory is always removed, on success and on
 * failure.
 */
export class FileCommandService {
  /**
   * Plain field assignments rather than parameter properties: the co-located
   * test runs this module through Node's type-stripping loader (`node --test`),
   * which rejects TypeScript-only syntax that has a runtime effect.
   */
  private readonly analyzer: IDocumentAnalyzer;
  private readonly fileStore: IFileStore;
  private readonly videoTranscoder: IVideoTranscoder;
  /** Cache of the analysis on the resource record. A cache hit answers without
   * downloading the blob at all, which is what makes a reference cheap. */
  private readonly analysis: IMediaAnalysisStore;
  /**
   * Largest PDF the analyzer is allowed to open, in bytes. Injected from the
   * shared upload contract by the composition root so the client's "skip
   * analysis" rule and this guard can never disagree.
   */
  private readonly pdfAnalyzeMaxBytes: number;
  /**
   * Storage policy shared with the client and the PocketBase hook. These two
   * dependencies were introduced for the old site-import path; they stay on the
   * constructor because the composition root injects one upload-side policy
   * set, and the import flow reads the same policy through its own service.
   */
  private readonly storageUsage: IStorageUsageReader;
  private readonly storageLimits: StorageLimits;

  constructor(
    analyzer: IDocumentAnalyzer,
    fileStore: IFileStore,
    videoTranscoder: IVideoTranscoder,
    analysis: IMediaAnalysisStore,
    pdfAnalyzeMaxBytes: number,
    storageUsage: IStorageUsageReader,
    storageLimits: StorageLimits,
  ) {
    this.analyzer = analyzer;
    this.fileStore = fileStore;
    this.videoTranscoder = videoTranscoder;
    this.analysis = analysis;
    this.pdfAnalyzeMaxBytes = pdfAnalyzeMaxBytes;
    this.storageUsage = storageUsage;
    this.storageLimits = storageLimits;
  }

  /**
   * Parses the PDF at `cmd.fileUrl` and stores a cover for its first page.
   *
   * Cover failures are absorbed (logged, `coverUrl: ""`): a missing thumbnail
   * degrades the node to its placeholder, whereas failing the whole call would
   * throw away perfectly good metadata. The call rejects only when the document
   * cannot be fetched, is larger than {@link pdfAnalyzeMaxBytes}, or cannot be
   * opened.
   */
  async analyzePdf(cmd: AnalyzePdfCommand): Promise<AnalyzedPdfDTO> {
    // The cache is the whole point of a second reference: a resource that was
    // already parsed answers here, without a download or a render.
    const cached = await this.analysis.read(cmd.fileUrl);
    if (cached && (cached.pageCount > 0 || cached.coverUrl !== "")) {
      return {
        pageCount: cached.pageCount,
        fileSize:
          cached.fileSize > 0
            ? cached.fileSize
            : await this.fileStore.stat(cmd.fileUrl),
        // Page size and the Info dictionary are not part of the cache: a node
        // only stores the page count and the cover, so a cached answer leaves
        // them at their neutral value instead of re-reading the document.
        pageWidth: 0,
        pageHeight: 0,
        coverUrl: cached.coverUrl,
        info: { isEncrypted: false },
      };
    }

    // Size first: the parser needs the whole document in memory, so a file the
    // parser may not open is never downloaded at all.
    const size = await this.fileStore.stat(cmd.fileUrl);
    if (size > this.pdfAnalyzeMaxBytes) {
      throw new Error(
        `PDF is ${size} bytes; analysis is limited to ${this.pdfAnalyzeMaxBytes} bytes`,
      );
    }

    const bytes = await this.fileStore.download(cmd.fileUrl);
    const analysis = await this.analyzer.analyzePdf(bytes);
    const coverUrl = await this.storeCover(cmd.fileUrl, analysis.cover);
    // Best effort: a teammate's resource stays uncached, but this answer is
    // still correct and the caller still gets it.
    await this.analysis.write(cmd.fileUrl, {
      pageCount: analysis.pageCount,
      coverUrl,
    });

    return {
      pageCount: analysis.pageCount,
      fileSize: analysis.fileSize,
      pageWidth: analysis.pageWidth,
      pageHeight: analysis.pageHeight,
      coverUrl,
      info: analysis.info,
    };
  }

  /**
   * Packages the video at `cmd.fileUrl` as HLS and stores it next to its source.
   *
   * A stream browsers already decode is copied, so an H.264 upload is merely
   * re-packaged; only a codec the browser cannot decode (HEVC from a phone, say)
   * is re-encoded. The order matters: every segment is stored first, because the
   * playlist has to name the addresses they ended up at.
   *
   * Rejects when the video cannot be fetched or read by the transcoder; the
   * caller keeps the original upload as the fallback source.
   */
  async transcodeVideo(
    cmd: TranscodeVideoCommand,
  ): Promise<TranscodedVideoDTO> {
    // A packaged video answers from its own record: no download, no FFmpeg, and
    // no second copy of the segments.
    const cached = await this.analysis.read(cmd.fileUrl);
    if (cached && cached.hlsUrl !== "") {
      return {
        hlsUrl: cached.hlsUrl,
        coverUrl: cached.coverUrl,
        duration: cached.duration,
        width: cached.width,
        height: cached.height,
        // Codec names are diagnostics of the transcode, not a property of the
        // stored resource; a cached answer does not claim one.
        videoCodec: "",
        audioCodec: undefined,
        reencoded: false,
      };
    }

    return this.packageVideo(cmd.fileUrl);
  }

  /**
   * The uncached half of {@link transcodeVideo}: downloads the stored source,
   * transcodes it, stores the artifacts, caches the analysis and returns it.
   *
   * It never consults the cache: both callers have already decided a cache hit
   * answers the call.
   */
  private async packageVideo(fileUrl: string): Promise<TranscodedVideoDTO> {
    const fileName = fileNameFromUrl(fileUrl);
    // The store owns the temporary location: this layer decides what happens to
    // a file, never where it lives. The suffix keeps the extension FFmpeg picks
    // its demuxer by.
    const source = await this.fileStore.downloadToTempFile(
      fileUrl,
      sourceSuffix(fileName),
    );

    try {
      // FFmpeg reads the downloaded path directly, so a 2 GiB source is written
      // exactly once and never materialised on the heap.
      const result = await this.videoTranscoder.transcodeToHls({
        fileName,
        path: source.path,
      });

      const storedSegments: { fileName: string; url: string }[] = [];
      for (const segment of result.segments) {
        storedSegments.push({
          fileName: segment.fileName,
          url: await this.fileStore.uploadDerived(fileUrl, segment),
        });
      }

      const playlist = rewriteSegmentUrls(result.playlist, storedSegments);
      const hlsUrl = await this.fileStore.uploadDerived(fileUrl, playlist);
      const coverUrl = await this.storeCover(fileUrl, result.cover);

      // Best effort, as for a PDF: a resource the caller does not own is
      // packaged but not cached, and the next caller packages it again.
      await this.analysis.write(fileUrl, {
        hlsUrl,
        coverUrl,
        duration: result.duration,
        width: result.width,
        height: result.height,
      });

      return {
        hlsUrl,
        coverUrl,
        duration: result.duration,
        width: result.width,
        height: result.height,
        videoCodec: result.videoCodec,
        audioCodec: result.audioCodec,
        reencoded: result.reencoded,
      };
    } finally {
      await source.cleanup();
    }
  }

  private async storeCover(
    sourceUrl: string,
    cover?: DocumentCover,
  ): Promise<string> {
    if (!cover) return "";

    try {
      return await this.fileStore.uploadDerived(sourceUrl, cover);
    } catch (error) {
      console.warn("[FileCommandService] cover upload failed", error);
      return "";
    }
  }
}

/**
 * Name of the stored file a file-store address points at.
 *
 * The transcoder derives its artifact names from it, so the original name is
 * kept (PocketBase has already sanitized it on upload).
 */
function fileNameFromUrl(fileUrl: string): string {
  try {
    const pathname = new URL(fileUrl, "http://file.invalid").pathname;
    const last = pathname.split("/").pop() ?? "";
    return decodeURIComponent(last) || "video";
  } catch {
    return "video";
  }
}

/**
 * Turns a stored name into one safe path segment.
 *
 * The name only ever comes from this project's own file store, but it is joined
 * into a temporary path, so anything that could climb out of that directory is
 * replaced rather than trusted. The extension survives, which is the part the
 * demuxer is chosen by.
 */
function safeSegment(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_");
  return cleaned || "video";
}

/**
 * The suffix of the temporary download, taken from the stored name.
 *
 * FFmpeg probes by content, but some demuxers are only picked by extension, and
 * the stored name is the only place the original extension survives.
 */
function sourceSuffix(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return ".bin";
  const suffix = safeSegment(fileName.slice(dot));
  return suffix.startsWith(".") && suffix.length > 1
    ? suffix.slice(0, 12)
    : ".bin";
}
