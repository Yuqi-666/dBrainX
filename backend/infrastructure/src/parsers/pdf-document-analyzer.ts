// SPDX-License-Identifier: AGPL-3.0-only

import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import type {
  DocumentCover,
  IDocumentAnalyzer,
  PdfDocumentAnalysis,
  PdfDocumentInfo,
} from "@workspace/domain";

/**
 * PDF analysis adapter (pdfjs-dist + Skia canvas).
 *
 * Runs in the Node process, which buys three things the browser could not give
 * us: no parser ships to the client, parsing does not block the UI thread, and
 * pdfjs uses its Node code path (`NodeCanvasFactory` / `NodeStandardFontDataFactory`,
 * backed by `@napi-rs/canvas`) instead of the main-thread fake worker it falls
 * back to in a browser bundle.
 *
 * Both dependencies are import()-ed lazily and memoized: pdfjs is ~1 MB of
 * parser and the canvas binding is a native addon, so a server that never sees
 * a PDF should not pay for either at boot.
 */

/** Longest cover edge, in pixels. */
const COVER_WIDTH = 1280;
/** Never upscale past this factor, and never exceed {@link MAX_HEIGHT}. */
const MAX_SCALE = 2;
const MAX_HEIGHT = 2560;
/** `@napi-rs/canvas` expects 0–100 here (not the browser's 0–1). */
const JPEG_QUALITY = 85;

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfJsDocument = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
type PdfJsPage = Awaited<ReturnType<PdfJsDocument["getPage"]>>;
type CanvasModule = typeof import("@napi-rs/canvas");
type DocumentAssets = {
  cMapUrl?: string;
  standardFontDataUrl?: string;
};

let pdfjsModule: Promise<PdfJs> | undefined;
let canvasModule: Promise<CanvasModule> | undefined;
let documentAssets: DocumentAssets | undefined;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsModule ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsModule;
}

function loadCanvas(): Promise<CanvasModule> {
  canvasModule ??= import("@napi-rs/canvas");
  return canvasModule;
}

/**
 * Points pdfjs at the CMap and standard-font data that ships inside its own
 * package.
 *
 * `standardFontDataUrl` is not optional in practice: for a page that uses a
 * base-14 font without embedding it (Helvetica, Times, …) pdfjs otherwise
 * silently drops every glyph, and the cover comes out blank — which is exactly
 * what happened before this was wired up. `cMapUrl` lives in the same package
 * and is read from disk only when a document actually asks for a predefined
 * CMap, so it is enabled alongside; measured against embedded-font PDFs
 * (Chrome/Skia output) it changes nothing, and it is what keeps a CMap-based
 * document from failing outright.
 *
 * Both directories are resolved from the installed package and memoized. If
 * resolution ever fails (say a bundled deployment), analysis degrades to the
 * old glyph-dropping behaviour instead of breaking.
 */
function loadDocumentAssets(): DocumentAssets {
  if (documentAssets) return documentAssets;

  try {
    const require = createRequire(import.meta.url);
    const root = dirname(require.resolve("pdfjs-dist/package.json"));
    // pdfjs concatenates `baseUrl + name`, so the trailing separator matters.
    documentAssets = {
      cMapUrl: join(root, "cmaps") + sep,
      standardFontDataUrl: join(root, "standard_fonts") + sep,
    };
  } catch (error) {
    console.warn(
      "[PdfDocumentAnalyzer] pdfjs asset directory unavailable",
      error,
    );
    documentAssets = {};
  }

  return documentAssets;
}

/** Reads a key that PDF producers are free to omit or to fill with junk. */
function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function openDocument(
  pdfjs: PdfJs,
  bytes: Uint8Array,
): Promise<PdfJsDocument> {
  try {
    return await pdfjs.getDocument({ data: bytes, ...loadDocumentAssets() })
      .promise;
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    if (name === "PasswordException") {
      throw new Error("PDF is password protected and cannot be analysed");
    }
    if (name === "InvalidPDFException") {
      throw new Error("File is not a valid PDF");
    }
    throw error;
  }
}

async function readInfo(doc: PdfJsDocument): Promise<PdfDocumentInfo> {
  const raw: Record<string, unknown> = await doc
    .getMetadata()
    .then((meta) => (meta.info ?? {}) as Record<string, unknown>)
    .catch(() => ({}));

  return {
    title: optionalText(raw.Title),
    author: optionalText(raw.Author),
    subject: optionalText(raw.Subject),
    keywords: optionalText(raw.Keywords),
    creator: optionalText(raw.Creator),
    producer: optionalText(raw.Producer),
    creationDate: optionalText(raw.CreationDate),
    modDate: optionalText(raw.ModDate),
    pdfVersion: optionalText(raw.PDFFormatVersion),
    language: optionalText(raw.Language),
    isEncrypted: optionalText(raw.EncryptFilterName) !== undefined,
  };
}

/** First page size in PDF points, rotation applied. */
function readPageSize(page: PdfJsPage): { width: number; height: number } {
  const viewport = page.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
}

async function renderCover(
  canvasModule: CanvasModule,
  page: PdfJsPage,
): Promise<DocumentCover> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(
    MAX_SCALE,
    COVER_WIDTH / base.width,
    MAX_HEIGHT / base.height,
  );
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.round(viewport.width));
  const height = Math.max(1, Math.round(viewport.height));

  const canvas = canvasModule.createCanvas(width, height);
  // pdfjs types the context as the DOM one; the Skia canvas implements the
  // same interface, they are just declared in two different type universes.
  const context = canvas.getContext(
    "2d",
  ) as unknown as CanvasRenderingContext2D;
  await page.render({ canvasContext: context, viewport }).promise;

  const bytes = canvas.toBuffer("image/jpeg", JPEG_QUALITY);
  return {
    fileName: `pdf-cover-${Date.now()}.jpg`,
    contentType: "image/jpeg",
    bytes: new Uint8Array(bytes),
  };
}

export class PdfDocumentAnalyzer implements IDocumentAnalyzer {
  async analyzePdf(bytes: Uint8Array): Promise<PdfDocumentAnalysis> {
    const fileSize = bytes.byteLength;
    const [pdfjs, canvasModule] = await Promise.all([
      loadPdfJs(),
      loadCanvas(),
    ]);
    const doc = await openDocument(pdfjs, bytes);

    try {
      const info = await readInfo(doc);
      const page = await doc.getPage(1);
      let pageSize: { width: number; height: number };
      let cover: DocumentCover | undefined;

      try {
        pageSize = readPageSize(page);
        cover = await renderCover(canvasModule, page);
      } catch (error) {
        // A page that will not rasterize still tells us how many pages there
        // are; only the thumbnail is lost.
        console.warn("[PdfDocumentAnalyzer] cover rendering failed", error);
        pageSize = { width: 0, height: 0 };
      } finally {
        page.cleanup();
      }

      return {
        pageCount: doc.numPages,
        fileSize,
        pageWidth: pageSize.width,
        pageHeight: pageSize.height,
        info,
        cover,
      };
    } finally {
      await doc.destroy();
    }
  }
}
