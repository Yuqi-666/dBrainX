import type { ReactNode } from "react";
import type { Annotation } from "@workspace/interfaces";
import type { PDFPageProxy } from "pdfjs-dist";

/** Layout axis of the page strip. */
export type PdfDirection = "vertical" | "horizontal";

/**
 * `continuous` scrolls the whole document; `paged` keeps the same page strip but
 * snaps it one page at a time, so the axis still means something.
 */
export type PdfScrollMode = "continuous" | "paged";

/** `free` uses the multiplier as-is; the other two derive it from the viewport. */
export type PdfFitMode = "free" | "width" | "page";

/**
 * `single` is one page per strip slot; `double` puts two consecutive pages side
 * by side in the same slot (两两一组), always left page then right page. The
 * pairing never flips with 方向 — 方向 only decides which way the *slots* run.
 */
export type PdfSpread = "single" | "double";

export type PdfSidebarTab = "thumbs" | "outline";

/**
 * The tab the rail lands on when it opens. 大纲 is the better first look: a
 * table of contents is navigable at a glance, while thumbnails are a wall of
 * pages the reader still has to scroll through.
 */
export const PDF_DEFAULT_SIDEBAR_TAB: PdfSidebarTab = "outline";

/** One outline entry, with its destination already resolved to a page. */
export interface PdfOutlineEntry {
  title: string;
  /** 1-based page, or `null` when the destination cannot be resolved. */
  page: number | null;
  items: PdfOutlineEntry[];
}

export interface PdfViewMode {
  direction: PdfDirection;
  scroll: PdfScrollMode;
  spread: PdfSpread;
}

export const PDF_DEFAULT_MODE: PdfViewMode = {
  direction: "vertical",
  scroll: "continuous",
  spread: "single",
};

/** How many pages one slot of the strip holds. */
export function pdfSpreadStep(spread: PdfSpread): number {
  return spread === "double" ? 2 : 1;
}

/** One slot of the strip: its 1-based index and the pages it shows. */
export interface PdfSlot {
  index: number;
  pages: number[];
}

/**
 * The strip's slots — the unit the viewer renders, observes, snaps to and
 * measures. 单页 is one page per slot; 双页 pairs consecutive pages, leaving the
 * last page alone when the document has an odd count.
 */
export function pdfSlots(pageCount: number, spread: PdfSpread): PdfSlot[] {
  const step = pdfSpreadStep(spread);
  const slots: PdfSlot[] = [];
  for (let start = 1; start <= pageCount; start += step) {
    const pages = [start];
    if (step > 1 && start + 1 <= pageCount) pages.push(start + 1);
    slots.push({ index: slots.length + 1, pages });
  }
  return slots;
}

/** 1-based index of the slot that shows `page`. */
export function pdfSlotOf(page: number, spread: PdfSpread): number {
  return Math.ceil(page / pdfSpreadStep(spread));
}

/** The slot's first (leading) page — what a spread view calls "the page". */
export function pdfSlotStartPage(slot: number, spread: PdfSpread): number {
  return (slot - 1) * pdfSpreadStep(spread) + 1;
}

/**
 * Which pages are inside the rendering window — the filter the ink layer's surface
 * list is built with.
 *
 * It exists as a function because the obvious version is wrong: the visible set the
 * `IntersectionObserver` maintains holds **slot** indices, and in 双页 one slot is
 * two pages, so "is page 3 visible" is `visibleSlots.has(pdfSlotOf(3, spread))` and
 * not `visibleSlots.has(3)`. Testing membership by page number would surface the
 * left page of every spread and silently deny the right one its ink.
 */
export function pdfSurfacedPages(
  pages: Iterable<number>,
  visibleSlots: ReadonlySet<number>,
  spread: PdfSpread,
): number[] {
  const surfaced: number[] = [];
  for (const page of pages) {
    if (visibleSlots.has(pdfSlotOf(page, spread))) surfaced.push(page);
  }
  return surfaced;
}

export const PDF_MIN_SCALE = 0.25;
export const PDF_MAX_SCALE = 6;

/**
 * The device-pixel ratio a page is rasterised at, capped.
 *
 * Above 2 the bitmap grows quadratically for detail the eye does not resolve at
 * reading distance, and a page is already a large allocation at 适配宽度; the ink
 * layer is capped to the same number for the same reason (see
 * `AnnotationCanvasProps.maxDpr`), so the paper and the ink on it stay one density.
 *
 * This is the *ratio* half of the density policy. {@link pdfRasterDpr} is the whole
 * of it, and is what the paper reads; the ink layer reads this cap plus
 * {@link PDF_MAX_PIXELS} directly (it has to apply the area back-off itself, since
 * only the canvas knows its own measured box).
 */
export const PDF_MAX_DPR = 2;

/**
 * The most device pixels **one page-sized surface** may be rasterised into —
 * 4096², the smallest per-canvas area every browser this app runs in actually
 * allocates (WebKit is the tightest of them) and one the compositor keeps on the
 * GPU.
 *
 * A ratio cap alone does not bound a page: a page is painted *whole*, so its
 * bitmap is `pageCSS² × dpr²`, and at `PDF_MAX_SCALE` (6) a Letter page is
 * 3672 × 4752 CSS pixels — 70 MP at dpr 2, ~280 MB. At that size the repaint stops
 * being a repaint and becomes an allocation that fails: `getContext("2d")` hands
 * back `null` and the page keeps whatever the last wipe left. The budget turns
 * "huge page at a huge multiplier" into "slightly softer page", which is the whole
 * of its ambition.
 *
 * It is the paper's budget and the ink's alike — `pdf-page.tsx` paints with
 * {@link pdfRasterDpr} and the viewer hands the annotation layer the same number as
 * `maxPixels` — because paper and ink have to stay one density, or a stroke ends up
 * crisper (or coarser) than the glyphs it sits on. Note what it does *not* bound:
 * one visible page costs up to **three** surfaces of this size (the page bitmap, the
 * ink canvas, and the ink's offscreen cache), and the ±1000px rendering window
 * keeps several pages alive.
 */
export const PDF_MAX_PIXELS = 16_777_216;

/**
 * The device-pixel density one page surface is rasterised at: the display's,
 * capped at {@link PDF_MAX_DPR}, then backed off far enough that the whole
 * surface still fits in {@link PDF_MAX_PIXELS}.
 *
 * `width`/`height` are the surface's **CSS** pixels, which is the one place the
 * "how big is the box" question becomes "how many pixels may that be": the box
 * follows a gesture while the bitmap does not, so the answer has to be about the
 * box, never about the viewport. A density below 1 is a legitimate answer for a
 * page larger than the budget even at dpr 1 — soft beats an allocation that fails.
 */
export function pdfRasterDpr(
  deviceDpr: number,
  width: number,
  height: number,
): number {
  const dpr = Math.min(deviceDpr > 0 ? deviceDpr : 1, PDF_MAX_DPR);
  if (!(width > 0) || !(height > 0)) return dpr;
  const area = width * height * dpr * dpr;
  if (!(area > PDF_MAX_PIXELS)) return dpr;
  return dpr * Math.sqrt(PDF_MAX_PIXELS / area);
}

/** Multipliers the zoom in/out buttons walk through. */
export const PDF_ZOOM_STEPS: readonly number[] = [
  0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4,
];

/**
 * Within this factor of the multiplier a page's bitmap was painted at, the
 * bitmap is stretched instead of re-painted: at 2% the difference is not
 * visible, and a re-paint costs a frame every time.
 */
export const PDF_ZOOM_CRISP_RATIO = 1.02;

/**
 * The largest stretch the cheap path paints before it has to re-paint. A pinch
 * that keeps growing past this bound gets a mid-gesture repaint, so the canvas
 * cannot stay visibly soft for the whole of a long gesture.
 *
 * This is the one knob that trades mid-gesture sharpness for how often a gesture
 * still rasterises: a mouse spin from 1× to 6× costs 2 repaints at 2.0 and 3 at
 * 1.6, while a trackpad pinch to 2× costs none. At 2.0 the worst case is one device
 * pixel per CSS pixel of a 2× display **only while the painted density is 2**; on a
 * page big enough for `PDF_MAX_PIXELS` to bind, the density is already below 1
 * (a Letter page at 6× paints at ≈0.98 on a 2× display), so a 2× stretch mid-gesture
 * is softer than one device pixel per CSS pixel. That is deliberate: the alternative
 * is re-running pdfjs on a 70 MP canvas in the middle of a pinch.
 */
export const PDF_ZOOM_STRETCH_LIMIT = 2;

/**
 * Whether a page box at `scale` may keep the bitmap painted at `painted`, i.e.
 * whether the two multipliers are close enough that a re-paint would not change
 * what the reader sees.
 */
export function pdfZoomIsCrisp(scale: number, painted: number): boolean {
  const stretch = scale / painted;
  return stretch < PDF_ZOOM_CRISP_RATIO && stretch > 1 / PDF_ZOOM_CRISP_RATIO;
}

/** What a change of multiplier has to do about the painted bitmap. */
export type PdfZoomRaster = "skip" | "now" | "later";

/**
 * Decides whether a page has to be re-painted for `scale` given a bitmap painted
 * at `painted` — `null` while no bitmap has been recorded, which always has to be
 * painted, at `scale`, because that is the multiplier the boxes are laid out at.
 *
 * That `null` case is part of the policy rather than a special case in the
 * viewer for a reason: a viewer that instead treats "no bitmap recorded" as
 * "nothing to compare against" ends up comparing the multiplier against itself on
 * every commit, answering "skip" forever, and never records one — the deferral
 * below then never runs and a gesture repaints per notch, which is the stutter
 * this whole mechanism exists to remove.
 *
 * `defer` is the caller's answer to "is this a gesture in flight?" — a wheel
 * notch or a pinch is, a button or a fit mode is not. A *deferred* step is
 * painted by stretching the existing bitmap and re-painting once the gesture
 * stops, which is the point: re-painting on every notch makes each one cancel the
 * page render the notch before it started, so a spin repaints nothing and drops
 * every frame. Bounded by `PDF_ZOOM_STRETCH_LIMIT`, so a long pinch still
 * sharpens mid-gesture instead of blurring all the way.
 */
export function pdfZoomRaster(
  scale: number,
  painted: number | null,
  defer: boolean,
): PdfZoomRaster {
  if (painted === null) return "now";
  if (pdfZoomIsCrisp(scale, painted)) return "skip";
  const stretch = scale / painted;
  if (
    !defer ||
    stretch > PDF_ZOOM_STRETCH_LIMIT ||
    stretch < 1 / PDF_ZOOM_STRETCH_LIMIT
  ) {
    return "now";
  }
  return "later";
}

/** Page size in PDF points at scale 1, with the page's own `/Rotate` applied. */
export interface PdfPageMetrics {
  width: number;
  height: number;
}

export type PdfLoadFailureCode =
  | "worker"
  | "network"
  | "password"
  | "invalid"
  | "unknown";

export interface PdfLoadFailure {
  code: PdfLoadFailureCode;
  message: string;
  cause?: unknown;
}

/** `index` / `length` address the page's joined text (see `pdf-text.ts`). */
export interface PdfSearchMatch {
  page: number;
  index: number;
  length: number;
}

export interface PdfViewerProps {
  /** Already resolved against the API origin by the host. */
  url: string;
  title?: string;
  /**
   * Optional host-provided image of page 1, such as the cover stored alongside
   * the file. It is shown while the document opens and while page 1 is
   * rasterised, so the first screen is the real page instead of a spinner.
   *
   * It exists because pdf.js's *open* time is not decided by file size. Resolving
   * page 1 makes pdf.js pre-fetch every top-level kid of the page tree
   * (`Catalog.getPageDict`); on a scan with a flat page tree the page dictionaries
   * sit megabytes apart, so that pre-fetch turns into hundreds of scattered range
   * reads before `getDocument` resolves. The cover needs none of that.
   *
   * Empty/absent is the ordinary case for a file that was not analysed: the
   * viewer then shows its plain loading state.
   */
  coverUrl?: string;
  className?: string;
  /** Initial layout — the viewer owns it afterwards. Defaults to 垂直 + 连续 + 单页. */
  defaultMode?: PdfViewMode;
  /** Initial multiplier; ignored unless no `defaultFit` is given. */
  defaultScale?: number;
  /** Initial fit mode. Defaults to 适配宽度 (or `free` when `defaultScale` is set). */
  defaultFit?: PdfFitMode;
  /**
   * The persisted ink layer (`PdfContent.annotations.items`). Every item carries a
   * 0-based `Annotation.page`; the viewer paints each page's ink on that page.
   */
  annotations?: Annotation[];
  /**
   * One finished ink gesture. Providing it is what makes the document
   * **annotatable**: without it the layer is mounted read-only — the ink is still
   * painted (a host showing someone else's document should show their notes) but
   * no pen, no toolbar and no pointer target.
   */
  onAnnotationsChange?: (items: Annotation[]) => void;
  /** Dialog mode: the ink toolbar starts folded (design §2.4). */
  compact?: boolean;
  /** Extra controls for the toolbar's right-hand group. */
  toolbarExtras?: ReactNode;
  onPageChange?: (page: number, pageCount: number) => void;
  /** pdfjs could not be used — the host is expected to degrade. */
  onError?: (failure: PdfLoadFailure) => void;
  /**
   * Remembers the reading position under this key, and restores it on the next
   * mount. The host passes a per-user, per-node value; absent means the viewer
   * persists nothing, which is the default for an embedded or throwaway
   * document.
   */
  progressKey?: string;
}

/**
 * The cover a page may paint while its own bitmap is still loading.
 *
 * Only page 1 has one: the cover is rendered from page 1 at upload. An empty
 * string is what the backend stores when its own render failed, so it must not
 * become a broken `<img>` in the page box.
 */
export function pdfPageCover(
  coverUrl: string | undefined,
  pageNumber: number,
): string | null {
  return pageNumber === 1 && coverUrl ? coverUrl : null;
}

export interface PdfToolbarProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;

  zoom: {
    /** Multiplier currently painted (derived when a fit mode is active). */
    scale: number;
    fit: PdfFitMode;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onSelectScale: (scale: number) => void;
    onSelectFit: (fit: PdfFitMode) => void;
  };

  mode: PdfViewMode;
  onModeChange: (mode: PdfViewMode) => void;

  search: {
    open: boolean;
    query: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    /** Total matches in the document. */
    count: number;
    /** 1-based position of the current match, `0` when there is none. */
    active: number;
    /** Still scanning pages. */
    pending: boolean;
    onOpenChange: (open: boolean) => void;
    onQueryChange: (query: string) => void;
    onCaseSensitiveChange: (value: boolean) => void;
    onWholeWordChange: (value: boolean) => void;
    onPrev: () => void;
    onNext: () => void;
  };

  /**
   * The rail has one switch here, not one button per tab: 缩略图/大纲 are tabs
   * *inside* the rail, so the toolbar only needs to open and close it.
   */
  sidebar: {
    /** Whether the rail is showing. */
    open: boolean;
    /** Opens the rail on `PDF_DEFAULT_SIDEBAR_TAB`, or closes it. */
    onToggle: () => void;
  };

  downloadUrl: string;
  /**
   * Files come from the API origin, where the `download` attribute is ignored —
   * the viewer fetches a blob instead and hands the toolbar a plain action.
   */
  onDownload: () => void;
  title?: string;
  extras?: ReactNode;
  className?: string;
}

/* ------------------------------------------------------------------ *
 * pdfjs-derived types. Kept here so no module outside the loader has
 * to name the package, and so a type-only import never pulls the ~1MB
 * parser into a statically bundled chunk.
 * ------------------------------------------------------------------ */

export type PdfJsModule = typeof import("pdfjs-dist");

export type PdfTextContent = Awaited<
  ReturnType<PDFPageProxy["getTextContent"]>
>;

export type PdfTextLayerInstance = InstanceType<PdfJsModule["TextLayer"]>;

export type PdfTextLayerParams = ConstructorParameters<
  PdfJsModule["TextLayer"]
>[0];

export type PdfRenderTask = ReturnType<PDFPageProxy["render"]>;
