// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * Document lifecycle for the PDF viewer: lazy pdfjs, the worker, page metrics
 * and the two per-page caches (page proxy, text content).
 *
 * Three rules are load-bearing:
 *
 * 1. **pdfjs is imported dynamically and exactly once per session.** It is
 *    ~660KB of parser plus a 1.3MB worker; a static import would put both in
 *    every route's chunk, including the ones that never open a pdf node.
 * 2. **The worker is the patched copy of pdf.js's own worker**, served from
 *    `<origin>/pdfjs/pdf.worker.patched.mjs`. The `scripts/lib/pdfjs-assets.mjs`
 *    copy step writes it into both client apps' `public/` trees; the patch adds
 *    the page-tree fast path that a flat `/Kids` array needs (see
 *    `scripts/lib/pdfjs-worker-patch.mjs`). Creating the worker from that URL,
 *    rather than from a bundler trace, is what keeps the patch in every build;
 *    `GlobalWorkerOptions.workerPort` is still assigned before `getDocument`,
 *    because otherwise pdfjs resolves a `workerSrc` path that does not exist in
 *    the bundle and silently parses on the main thread.
 * 3. **One text fetch serves both consumers.** The text layer needs a
 *    `TextContent` to lay spans out and search needs the same strings to match
 *    against; sharing the cached value is what guarantees a highlight lands on
 *    the span it was computed from.
 *
 * The document is opened **on demand** (`disableStream` plus
 * `disableAutoFetch` in {@link usePdfDocument}): an attachment may be a 2 GiB
 * scan, and anything that streams it whole makes opening the node wait for the
 * entire file.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

import { buildPageText, type PageTextMap } from "./pdf-text";
import type {
  PdfJsModule,
  PdfLoadFailure,
  PdfOutlineEntry,
  PdfPageMetrics,
  PdfTextContent,
  PdfTextLayerInstance,
  PdfTextLayerParams,
} from "./types";

/** A page's text content plus its index map, cached together. */
export interface PdfTextSnapshot {
  content: PdfTextContent;
  map: PageTextMap;
}

/** Fallback page box, in PDF points — A4, so an empty state is still page-shaped. */
const DEFAULT_PAGE_METRICS: PdfPageMetrics = { width: 595, height: 842 };

const METRIC_CONCURRENCY = 6;
const METRIC_COMMIT_BATCH = 24;

/**
 * Pages whose *real* size is measured up front. The rest keep page 1's size
 * until they render, which is what pdf.js's own viewer does implicitly — and
 * what a mixed-size document self-corrects the moment a page is painted.
 * Without the cap, opening a 5000-page document would parse 5000 page objects
 * before the first one is visible.
 */
const MAX_EAGER_METRICS = 200;

/**
 * How long the worker may stay silent before the viewer gives up on it.
 * Re-armed on every progress event, so this is a stall detector rather than a
 * download deadline.
 */
const STALL_TIMEOUT_MS = 30_000;

const WORKER_FAILURE = "PdfWorkerFailure";

let modulePromise: Promise<PdfJsModule> | null = null;

/**
 * Loads pdfjs and wires the worker. Failures are *not* cached: a rejection that
 * survived a reload would be a viewer that can never recover.
 *
 * The parser is a session-wide singleton (~660KB, fetched once), but the worker
 * is not: each document builds its own, handed to `getDocument` through
 * `worker`, so nothing global has to be torn down and re-armed between mounts.
 * (`GlobalWorkerOptions.workerPort` would be the shorter path, but a destroyed
 * loading task arms a `_pendingDestroy` flag on the cached `PDFWorker`, and a
 * remount that lands inside that window — React StrictMode's double invoke, or
 * closing and reopening a node quickly — makes `fromPort` throw instead of
 * loading.)
 */
function loadPdfjs(): Promise<PdfJsModule> {
  modulePromise ??= import("pdfjs-dist").catch((error: unknown) => {
    modulePromise = null;
    throw error;
  });

  return modulePromise;
}

/**
 * The origin pdf.js has to prefix its asset URLs with.
 *
 * Both trees are fetched by *the worker*, and a worker cannot resolve a
 * root-relative path: `fetch("/pdfjs/cmaps/x.bcmap")` throws
 * `Failed to parse URL` inside a WorkerGlobalScope. pdf.js only logs that as
 * `Error during font loading` and then draws every glyph of the font blank,
 * so the failure reads as a corrupt document. The worker shares the page's
 * origin, which is therefore all the URL needs. Read lazily because the hook is
 * also evaluated during a server render, where `window` does not exist.
 */
function pdfjsAssetOrigin(): string {
  if (typeof window === "undefined") return "";
  const origin = window.location.origin;
  return origin && origin !== "null" ? origin : "";
}

/** One worker for one document; the caller terminates it. */
function createWorker(): Worker {
  try {
    return new Worker(
      `${pdfjsAssetOrigin()}/pdfjs/pdf.worker.patched.mjs`,
      { type: "module" },
    );
  } catch (error) {
    const failure = new Error(translate("PDF 解析线程启动失败"));
    failure.name = WORKER_FAILURE;
    failure.cause = error;
    throw failure;
  }
}

/** Maps a pdfjs (or fetch) rejection onto something the host can act on. */
export function classifyPdfFailure(error: unknown): PdfLoadFailure {
  if (error instanceof Error) {
    switch (error.name) {
      case "PasswordException":
        return {
          code: "password",
          message: translate("这个 PDF 有打开密码，无法直接预览。"),
          cause: error,
        };
      case "InvalidPDFException":
        return {
          code: "invalid",
          message: translate("文件不是有效的 PDF，或已经损坏。"),
          cause: error,
        };
      case "MissingPDFException":
      case "UnexpectedResponseException":
        return {
          code: "network",
          message: translate("读取 PDF 失败：地址无效，或跨源请求被拒绝。"),
          cause: error,
        };
      case WORKER_FAILURE:
        return {
          code: "worker",
          message: translate("PDF 解析线程没能启动，已切换到兼容预览。"),
          cause: error,
        };
      default:
        break;
    }
    if (error instanceof TypeError) {
      return {
        code: "network",
        message: translate("读取 PDF 失败：地址无效，或跨源请求被拒绝。"),
        cause: error,
      };
    }
    return {
      code: "unknown",
      message: translate("PDF 加载失败：{value1}", { value1: error.message }),
      cause: error,
    };
  }
  return {
    code: "unknown",
    message: translate("PDF 加载失败。"),
    cause: error,
  };
}

export interface PdfDocumentApi {
  status: "loading" | "ready" | "error";
  /**
   * The url whose document is currently ready, or `null` while none is.
   *
   * It exists as one value rather than as `status === "ready"` alone because a
   * url change re-renders the host with the *previous* document's ready status
   * and the new url before this hook has published `loading`. A host that
   * restores per-document state (the reading position) can therefore only trust
   * "the document I am looking at is ready" when this equals `url`.
   */
  readyUrl: string | null;
  pageCount: number;
  metrics: ReadonlyMap<number, PdfPageMetrics>;
  failure: PdfLoadFailure | null;
  /** 0..1 while the bytes are downloading; `null` when the length is unknown. */
  progress: number | null;
  getPage: (page: number) => Promise<PDFPageProxy | null>;
  getTextContent: (page: number) => Promise<PdfTextSnapshot | null>;
  createTextLayer: (params: PdfTextLayerParams) => PdfTextLayerInstance | null;
  /** Resolves the document outline, destinations included. Empty when there is none. */
  getOutline: () => Promise<PdfOutlineEntry[]>;
}

/** The shape pdfjs hands back for one outline row (all fields optional in practice). */
interface RawOutlineItem {
  title?: unknown;
  dest?: unknown;
  items?: unknown;
}

export function usePdfDocument(url: string): PdfDocumentApi {
  useI18n();

  const [status, setStatus] = useState<PdfDocumentApi["status"]>("loading");
  const [pageCount, setPageCount] = useState(0);
  const [metrics, setMetrics] = useState<ReadonlyMap<number, PdfPageMetrics>>(
    new Map(),
  );
  const [failure, setFailure] = useState<PdfLoadFailure | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [module, setModule] = useState<PdfJsModule | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [readyUrl, setReadyUrl] = useState<string | null>(null);

  const pageCache = useRef(new Map<number, Promise<PDFPageProxy | null>>());
  const textCache = useRef(new Map<number, Promise<PdfTextSnapshot | null>>());

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<PdfJsModule["getDocument"]> | null = null;
    let worker: Worker | null = null;

    pageCache.current = new Map();
    textCache.current = new Map();
    setStatus("loading");
    setPageCount(0);
    setMetrics(new Map());
    setFailure(null);
    setProgress(null);
    setModule(null);
    setDocument(null);
    setReadyUrl(null);

    const commitMetrics = (
      refined: Map<number, PdfPageMetrics>,
      changed: boolean,
    ) => {
      if (cancelled || !changed) return;
      setMetrics(new Map(refined));
    };

    /**
     * Page sizes are read with a small pool and committed in batches. The viewer
     * needs them to lay the strip out *before* a page renders, and a mixed-size
     * document would otherwise reflow every time a page came into view.
     */
    const refineMetrics = async (
      doc: PDFDocumentProxy,
      seed: Map<number, PdfPageMetrics>,
    ) => {
      const refined = new Map(seed);
      const numbers = Array.from(
        { length: Math.min(doc.numPages, MAX_EAGER_METRICS) },
        (_, i) => i + 1,
      );
      let cursor = 0;
      let changed = false;
      let sinceCommit = 0;

      const worker = async () => {
        for (;;) {
          if (cancelled) return;
          const index = cursor++;
          if (index >= numbers.length) return;
          const number = numbers[index];
          if (number === undefined) return;
          try {
            const page = await doc.getPage(number);
            const viewport = page.getViewport({ scale: 1 });
            const previous = refined.get(number);
            if (
              !previous ||
              Math.abs(previous.width - viewport.width) > 0.5 ||
              Math.abs(previous.height - viewport.height) > 0.5
            ) {
              refined.set(number, {
                width: viewport.width,
                height: viewport.height,
              });
              changed = true;
            }
          } catch {
            // A page we cannot measure keeps the seeded size; the viewer still
            // renders it (or reports its own failure) when it comes into view.
          }
          sinceCommit += 1;
          if (sinceCommit >= METRIC_COMMIT_BATCH) {
            sinceCommit = 0;
            commitMetrics(refined, changed);
            changed = false;
          }
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(METRIC_CONCURRENCY, numbers.length) },
          worker,
        ),
      );
      commitMetrics(refined, changed);
    };

    const run = async () => {
      let stallTimer: number | undefined;
      /**
       * A worker that never answers must not leave the viewer on its loading
       * state forever: `getDocument` has no timeout of its own, and pdfjs
       * treats a supplied port as ready immediately, so a 404'd worker script
       * (or a CSP refusal) would simply never reply. Every progress event
       * re-arms this, so it measures a *stall*, not total transfer time.
       */
      let failStalled: ((error: unknown) => void) | null = null;
      const stalled = new Promise<never>((_, reject) => {
        failStalled = reject;
      });
      /** Once the document is in (or failed), progress events must stop arming. */
      let settled = false;
      const armStall = () => {
        if (settled) return;
        if (stallTimer !== undefined) window.clearTimeout(stallTimer);
        stallTimer = window.setTimeout(() => {
          const error = new Error(translate("PDF 解析线程没有响应"));
          error.name = WORKER_FAILURE;
          failStalled?.(error);
        }, STALL_TIMEOUT_MS);
      };

      try {
        const pdfjs = await loadPdfjs();
        if (cancelled) return;
        setModule(pdfjs);

        worker = createWorker();
        const workerFailure = new Promise<never>((_, reject) => {
          worker?.addEventListener(
            "error",
            (event) => {
              const error = new Error(
                event.message || translate("PDF 解析线程加载失败"),
              );
              error.name = WORKER_FAILURE;
              reject(error);
            },
            { once: true },
          );
        });
        // `fromPort` rather than `new PDFWorker({ port })`: pdfjs's published
        // `.d.ts` types that constructor's `name`/`port` as `null | undefined`
        // (a doc-comment artefact), so the positional-free form is the one that
        // compiles — and it is the documented entry point for a supplied port.
        const pdfWorker: InstanceType<PdfJsModule["PDFWorker"]> =
          pdfjs.PDFWorker.fromPort({ port: worker, name: "pdf-viewer" });
        if (cancelled) {
          pdfWorker.destroy();
          worker.terminate();
          return;
        }

        loadingTask = pdfjs.getDocument({
          url,
          worker: pdfWorker,
          // The viewer is a read-only surface: no cookies, no credentials, so a
          // cross-origin file is either public or it degrades.
          withCredentials: false,
          // Where the browser viewer finds pdf.js's own data trees. A CID-keyed
          // font that names a predefined CMap needs the CMap file before it can
          // map character codes to glyph ids; without one pdf.js fails
          // `translateFont` and draws every glyph of that font blank, which
          // reads as a corrupt document because the latin text still draws.
          // Both trees are copied out of pdfjs-dist into the apps' `public/`
          // by scripts/lib/pdfjs-assets.mjs. The URL has to be absolute: see
          // pdfjsAssetOrigin above.
          cMapUrl: `${pdfjsAssetOrigin()}/pdfjs/cmaps/`,
          standardFontDataUrl: `${pdfjsAssetOrigin()}/pdfjs/standard_fonts/`,
          // Read the file on demand instead of streaming all of it.
          //
          // By default pdf.js opens the file with one request for the whole
          // body and keeps reading it while the node stays open — pdf.js only
          // uses byte ranges when streaming is off, and it then cancels that
          // first request as soon as the response says the server supports
          // them. Measured on the library's own 136 MiB / 603-page scan against
          // a range-capable server: the default pulled 130.7 MiB within four
          // seconds of opening the node, while these two flags pulled 0.3 MiB
          // and still had page 1 ready in about 100 ms. `disableAutoFetch` is
          // what stops the background prefetch of every remaining chunk.
          //
          // A deployment whose proxy strips range support is unaffected: with
          // no `Accept-Ranges` header pdf.js never cancels anything and streams
          // the body exactly as it did before (measured on the same file: both
          // settings read the whole 130.4 MiB and loaded in the same time).
          disableStream: true,
          disableAutoFetch: true,
        });
        // `onProgress` belongs to the loading task, not to its parameters.
        loadingTask.onProgress = ({
          loaded,
          total,
        }: {
          loaded: number;
          total: number;
        }) => {
          if (cancelled) return;
          armStall();
          if (!total) return;
          setProgress(Math.min(1, loaded / total));
        };

        armStall();
        const doc = await Promise.race([
          loadingTask.promise,
          workerFailure,
          stalled,
        ]);
        settled = true;
        if (stallTimer !== undefined) window.clearTimeout(stallTimer);
        stallTimer = undefined;
        if (cancelled) {
          void loadingTask.destroy();
          return;
        }

        const seed = new Map<number, PdfPageMetrics>();
        try {
          const first = await doc.getPage(1);
          const viewport = first.getViewport({ scale: 1 });
          const size = { width: viewport.width, height: viewport.height };
          for (let number = 1; number <= doc.numPages; number++) {
            seed.set(number, size);
          }
        } catch {
          for (let number = 1; number <= doc.numPages; number++) {
            seed.set(number, DEFAULT_PAGE_METRICS);
          }
        }
        if (cancelled) return;

        setDocument(doc);
        setPageCount(doc.numPages);
        setMetrics(seed);
        setProgress(1);
        setStatus("ready");
        // Published last, as one value: every other ready-state field above is
        // already set, so a host that reacts to this one sees the whole document.
        setReadyUrl(url);

        void refineMetrics(doc, seed);
      } catch (error) {
        if (cancelled) return;
        setFailure(classifyPdfFailure(error));
        setStatus("error");
      } finally {
        settled = true;
        if (stallTimer !== undefined) window.clearTimeout(stallTimer);
      }
    };

    void run();

    return () => {
      cancelled = true;
      // Order matters: `destroy()` asks the worker to terminate itself and
      // awaits the reply, so killing the port first would drop that message and
      // leave the promise pending — skipping pdfjs's own cleanup (in-flight
      // requests aborted, page/object caches released). The timer is the escape
      // hatch for a worker that never started and therefore never replies.
      const task = loadingTask;
      const port = worker;
      if (task) {
        void task
          .destroy()
          .catch(() => undefined)
          .then(() => port?.terminate());
        window.setTimeout(() => port?.terminate(), 1500);
      } else {
        port?.terminate();
      }
    };
  }, [url]);

  const getPage = useCallback(
    (page: number): Promise<PDFPageProxy | null> => {
      const cached = pageCache.current.get(page);
      if (cached) return cached;
      if (!document) return Promise.resolve(null);
      const pending = document.getPage(page).catch(() => null);
      pageCache.current.set(page, pending);
      return pending;
    },
    [document],
  );

  const getTextContent = useCallback(
    (page: number): Promise<PdfTextSnapshot | null> => {
      const cached = textCache.current.get(page);
      if (cached) return cached;
      if (!document) return Promise.resolve(null);
      const pending = document
        .getPage(page)
        .then((proxy) => proxy.getTextContent())
        .then((content) => ({ content, map: buildPageText(content.items) }))
        .catch(() => null);
      textCache.current.set(page, pending);
      return pending;
    },
    [document],
  );

  const createTextLayer = useCallback(
    (params: PdfTextLayerParams): PdfTextLayerInstance | null =>
      module ? new module.TextLayer(params) : null,
    [module],
  );

  /**
   * Outline destinations come in two flavours — a named destination that has to
   * be looked up, or an explicit array whose first entry is the page reference —
   * and both can point at something that is not a page at all. Anything that
   * cannot be resolved stays `null` and renders as a non-clickable row rather
   * than being dropped.
   */
  const getOutline = useCallback(async (): Promise<PdfOutlineEntry[]> => {
    if (!document) return [];

    let raw: unknown;
    try {
      raw = await document.getOutline();
    } catch {
      return [];
    }
    if (!Array.isArray(raw) || raw.length === 0) return [];

    const resolvePage = async (dest: unknown): Promise<number | null> => {
      try {
        const explicit =
          typeof dest === "string" ? await document.getDestination(dest) : dest;
        if (!Array.isArray(explicit) || explicit.length === 0) return null;
        const reference = explicit[0];
        if (typeof reference === "number") return reference + 1;
        const index = await document.getPageIndex(reference as never);
        return index + 1;
      } catch {
        return null;
      }
    };

    const walk = (
      items: readonly RawOutlineItem[],
    ): Promise<PdfOutlineEntry[]> =>
      Promise.all(
        items.map(async (item) => ({
          title: typeof item?.title === "string" ? item.title : "",
          page: await resolvePage(item?.dest),
          items: Array.isArray(item?.items)
            ? await walk(item.items as RawOutlineItem[])
            : [],
        })),
      );

    return walk(raw as RawOutlineItem[]);
  }, [document]);

  return {
    status,
    readyUrl,
    pageCount,
    metrics,
    failure,
    progress,
    getPage,
    getTextContent,
    createTextLayer,
    getOutline,
  };
}
