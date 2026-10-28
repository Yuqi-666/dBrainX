// SPDX-License-Identifier: AGPL-3.0-only

import { translate } from "@workspace/ui/lib/i18n/runtime";
/**
 * The annotation layer's UI-side contract — the **one** declaration of what the
 * toolbar, the ink canvas and the host exchange.
 *
 * The persisted shape is *not* here: `Annotation` / `AnnotationLayerData` live in
 * `@workspace/interfaces` (`models/node/nodes/annotation.ts`, landed by M1 and
 * frozen), because they cross the node boundary and reach PocketBase. This file
 * only adds what the UI needs on top of that shape: which tool is selected, what
 * a colour token is called, how a host hands over the base image's rectangle, and
 * what a gesture reports back.
 *
 * Read `docs/node-content/annotation.md` for the reasoning behind any number:
 * §1.2 (the layer's three boundaries), §2 (toolbar), §3.2/§3.4 (rendering and the
 * coordinate chain), §4 (pen vs. touch). Three rules from §1.2 are structural:
 *
 * 1. the layer never learns who its host is — it eats `items` + `onItemsChange` +
 *    `getBaseRect()`;
 * 2. the layer never touches the store — the host persists;
 * 3. the layer registers no global keyboard — it handles keys on its own subtree.
 */
import type { Annotation } from "@workspace/interfaces";

import type { PanZoomController } from "../pan-zoom/types";

/** Drawing tools share the existing stroke/highlight persistence format. */
export type EraserMode = "stroke" | "path";

export type AnnotationTool =
  | "pointer"
  | "pen"
  | "pencil"
  | "fountain"
  | "marker"
  | "highlighter"
  | "eraser";

/** A rectangle in **viewport** (client) CSS pixels. */
export interface BaseRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The ink layer's own box, in its **container's** CSS pixels — i.e. the values the
 * canvas writes to `style.left/top/width/height`.
 *
 * It is the same rectangle as {@link BaseRect} minus the layer root's viewport
 * origin; the two are separate types so a mixed-up pair is visible in a diff
 * rather than silently drawing the ink at the wrong offset.
 */
export interface LayerBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Legacy theme-aware tokens and full-palette tokens share the same stored shape. */
import type { AnnotationColorKey } from "./colors";
export type { AnnotationColorKey } from "./colors";

export interface AnnotationColorSpec {
  key: AnnotationColorKey;
  /** The custom property the key resolves to, declared in `styles/globals.css`. */
  cssVar: string;
  /** Swatch tooltip / accessible name. */
  label: string;
}

/**
 * The six tokens, in swatch order, exactly as `globals.css` declares them
 * (`--annotation-1..6` in both `:root` and `.dark`, added by this milestone).
 */
export const ANNOTATION_COLORS: readonly AnnotationColorSpec[] = [
  {
    key: "red",
    cssVar: "--annotation-1",
    get label() {
      return translate("红");
    },
  },
  {
    key: "yellow",
    cssVar: "--annotation-2",
    get label() {
      return translate("黄");
    },
  },
  {
    key: "green",
    cssVar: "--annotation-3",
    get label() {
      return translate("绿");
    },
  },
  {
    key: "blue",
    cssVar: "--annotation-4",
    get label() {
      return translate("蓝");
    },
  },
  {
    key: "purple",
    cssVar: "--annotation-5",
    get label() {
      return translate("紫");
    },
  },
  {
    key: "ink",
    cssVar: "--annotation-6",
    get label() {
      return translate("墨");
    },
  },
];

export const DEFAULT_ANNOTATION_COLOR: AnnotationColorKey = "red";

/**
 * The three nib widths, as a fraction of the base image's **short edge** — the
 * unit `Annotation.size` is stored in, so a stroke keeps its weight on another
 * device or after a resize (design §0.2-② last line).
 *
 * 0.004 / 0.008 / 0.016 ≈ 3 / 6 / 12 CSS px on a 720px-tall image.
 */
export const ANNOTATION_SIZES: readonly number[] = [0.004, 0.008, 0.016];

export const DEFAULT_ANNOTATION_SIZE = ANNOTATION_SIZES[1]!;

export const DEFAULT_ANNOTATION_TOOL: AnnotationTool = "pen";

/** Highlighter alpha and blend (design §2.1 / §2.3). M7 renders these. */
export const HIGHLIGHT_OPACITY = 0.35;
export const HIGHLIGHT_BLEND_LIGHT = "multiply" as const;
export const HIGHLIGHT_BLEND_DARK = "screen" as const;

/**
 * Distance-threshold thinning and the bbox pad are **not** here: they are
 * numerical properties of the geometry module that consumes them, and they live in
 * `geometry.ts` (`SIMPLIFY_EPSILON`, `BBOX_MARGIN`) so that module stays free of
 * runtime imports — `node --test` resolves relative specifiers literally.
 */

/**
 * What one finished gesture reports.
 *
 * The layer, not the canvas, owns the undo stack: a stroke is one `add`, and an
 * eraser pass over N marks is **one** `remove` carrying every item it deleted, so
 * one ⌘Z restores the whole pass (design §0.3-7 "栈里存操作记录").
 */
export type AnnotationOperation =
  | { kind: "add"; item: Annotation }
  | { kind: "remove"; items: Annotation[] }
  | {
      kind: "replace";
      replacements: { original: Annotation; items: Annotation[] }[];
    };

/**
 * One ink surface of a **paginated** base (a pdf).
 *
 * A single-surface host (an image) hands the layer one rectangle through
 * {@link AnnotationLayerProps.getBaseRect} and the layer paints one canvas over
 * its own root. A paginated host cannot: the base is N page boxes that scroll
 * independently of the layer root, so an ink rectangle computed in the root's
 * space would have to be re-measured on every scroll frame — and would be a frame
 * behind the page it belongs to while it did.
 *
 * Instead the host names its page elements and the layer **portals one canvas
 * into each**: the ink becomes a DOM child of the page box, so it scrolls, clips
 * and zooms with that page *by construction*. The overlap guarantee is therefore
 * stronger here than a measurement could make it — the same page element is the
 * containing block of both the page bitmap and the ink.
 *
 * The element must establish a containing block (`relative` on the page box) and
 * be *exactly* the base rectangle: the canvas is pinned to all four insets **and**
 * given an explicit `width/height: 100%` (a canvas is a replaced element, so
 * `width: auto` would resolve to its own bitmap instead of this box), and the
 * normalized coordinates are relative to it. `page` is 0-based and is the value
 * written to {@link Annotation.page}.
 */
export interface AnnotationSurface {
  /** 0-based page index — the same number `Annotation.page` carries for pdf ink. */
  page: number;
  /** The page box the canvas is portaled into. */
  element: HTMLElement;
}

/**
 * Props of the host-agnostic assembly point (`annotation-layer.tsx`).
 *
 * Design §1.2 lists `items` + `onItemsChange` + `tool` + `getBaseRect()`. This
 * contract keeps the first two and `getBaseRect` verbatim, but **keeps the tool as
 * internal state** (`defaultTool` only seeds it): the toolbar lives inside the
 * layer, so lifting the selected tool into every host would make each host own a
 * piece of the layer's own UI state for no benefit. Recorded as a chapter decision
 * (`docs/plan/annotation.md` §M5.2).
 */
export interface AnnotationLayerProps {
  /** The layer fills an exact image box and shares its parent's CSS transform. */
  selfMeasured?: boolean;
  /** Settled CSS zoom, used only to refresh the ink's backing-store density. */
  /** Keep the existing ink bitmap while the host streams a zoom gesture. */
  suspendMeasurement?: boolean;
  rasterScale?: number;
  /** Keep the toolbar outside a transformed image content box. */
  toolbarContainer?: HTMLElement | null;
  defaultPointerEnabled?: boolean;
  onPointerEnabledChange?: (enabled: boolean) => void;
  /** A host-reserved mouse gesture (for example space + drag) must not draw. */
  isNavigationGesture?: (event: PointerEvent) => boolean;
  onActiveChange?: (active: boolean) => void;
  /**
   * The persisted layer. `undefined` is normal — an old record has no
   * `annotations` key at all (design §0.2-①), and it means "empty".
   */
  items?: Annotation[];
  /**
   * One gesture = one call (a stroke, or one eraser pass). The host owns
   * persistence; the layer never writes to the store.
   */
  onItemsChange?: (items: Annotation[]) => void;
  /**
   * The base image's drawn rectangle, in viewport CSS pixels, or `null` while it
   * is not measurable (image not loaded, container collapsed). The layer re-reads
   * it on resize/scroll and on every pointer event; it must not be cached by the
   * implementation.
   *
   * Optional since the pdf host arrived: a paginated base has no *one* rectangle
   * and uses {@link AnnotationLayerProps.getSurfaces} instead. Exactly one of the
   * two is expected — with neither, the layer paints nothing.
   */
  getBaseRect?: () => BaseRect | null;
  /**
   * The **paginated** base: every page box the ink should be painted on (see
   * {@link AnnotationSurface}). Takes precedence over
   * {@link AnnotationLayerProps.getBaseRect}, and the items are then filtered by
   * `Annotation.page` — one canvas per surface, each carrying only its page's ink.
   */
  getSurfaces?: () => readonly AnnotationSurface[] | null;
  /**
   * Must change whenever the surfaces {@link AnnotationLayerProps.getSurfaces}
   * returns change **or move/resize**.
   *
   * A newly mounted page is the case a `ResizeObserver` cannot handle on its own:
   * it cannot see an element it has never been handed. A *resized* page is the
   * other case, and it is not merely an optimisation: the layer re-measures in a
   * **layout** effect, so a host that names the moment gets its canvases resized in
   * the same paint as the boxes that moved. A canvas pinned to its box
   * (`selfMeasured`) whose store is one frame behind is resampled by the compositor
   * for that frame — soft ink, shimmering during a pinch — which is exactly what
   * the pdf's multiplier in this key removes. (A host that does not announce a
   * resize still gets it, one frame later, from the observers.)
   */
  surfacesKey?: string | number;
  /**
   * Reports the 手指=书写 toggle (the layer owns that state, the host owns whether
   * a single finger draws or pans). A host that also scrolls itself — the pdf —
   * has to know, or its pan and the pen would both claim the same finger.
   */
  onTouchDrawsChange?: (touchDraws: boolean) => void;
  /**
   * The host owns the viewport **elsewhere** (a scroller). The layer then keeps the
   * *arbitration* half of its gesture machine even without a
   * {@link AnnotationLayerProps.panZoom} controller: pen-vs-touch palm rejection, "a
   * second finger closes the stroke in flight, it does not extend it", and the
   * two-/three-finger taps that undo and redo. Without it a pdf would record a
   * stroke that keeps sampling while a pinch moves the page under it.
   *
   * The taps are recognised on the ink canvas, so they exist in 批注 mode only:
   * 浏览 mode (`pointerToggle`) makes that element inert on purpose, and the
   * host's toolbar is then the way to undo (see `AnnotationLayerProps.pointerToggle`).
   */
  arbitrateViewport?: boolean;
  /** Show a browsing/annotation switch when the host owns navigation outside ink. */
  pointerToggle?: boolean;
  /**
   * 恢复位置大小, for a host with no `panZoom` controller: the layer's `0` key.
   * (`0` was documented as the keyboard twin of the single-finger double tap, and
   * a host that owns its own viewport has to supply the action.)
   */
  onResetView?: () => void;
  /** Initial tool; the toolbar changes it from then on. */
  defaultTool?: AnnotationTool;
  /** Dialog mode: the toolbar starts folded (design §2.4). */
  compact?: boolean;
  /** Forwarded to every ink canvas — see {@link AnnotationCanvasProps.maxDpr}. */
  maxDpr?: number;
  /** Forwarded to every ink canvas — see {@link AnnotationCanvasProps.maxPixels}. */
  maxPixels?: number;
  /**
   * Hides the toolbar and refuses to start a stroke (design §2.4), for a read-only
   * share view. The pdf viewer passes it whenever its host gave it nowhere to write
   * (`readOnly={!onAnnotationsChange}`), which today is never — `pdf-node-content.tsx`
   * always supplies the shared writer. The ink is still painted and the host's own
   * gestures are untouched (the canvas keeps its pointers: see
   * {@link AnnotationCanvasProps.readOnly}).
   */
  readOnly?: boolean;
  /**
   * The **shared viewport transform**, owned by the host (design: the base and
   * the ink must never each own a pan/zoom, or they drift). The layer does not
   * read a transform of its own — it learns the result through
   * {@link AnnotationLayerProps.getBaseRect}, which the host derives from this
   * same controller. What the controller buys the layer is the *gestures*: one
   * finger pans, two pinch, a single-finger double tap restores fit, and the
   * canvas is the only surface a pointer actually lands on. The desktop half of
   * 恢复位置大小 is not here — a mouse click is ink, so the host renders
   * `pan-zoom/reset-button.tsx` instead.
   *
   * `undefined` (no host transform, e.g. a plain `readOnly` embed) means the ink
   * canvas takes no viewport gestures at all.
   */
  panZoom?: PanZoomController;
  className?: string;
}

/** Controlled drawing settings; toolbar owns floating position and clear confirmation. */
export interface AnnotationToolbarProps {
  tool: AnnotationTool;
  eraserMode?: EraserMode;
  onToolChange: (tool: AnnotationTool) => void;
  onEraserModeChange?: (mode: EraserMode) => void;
  onResetView?: () => void;
  color: AnnotationColorKey;
  onColorChange: (color: AnnotationColorKey) => void;
  /** Continuous width normalized to the short edge; ANNOTATION_SIZES are presets. */
  size: number;
  onSizeChange: (size: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Called only after the toolbar's own confirmation step. */
  onClear: () => void;
  /** `hidden` hides the ink without touching the data (design §2.1 隐藏批注). */
  hidden: boolean;
  onToggleHidden: () => void;
  /** The "finger draws too" fallback switch (design §0.3-5); default off. */
  touchDraws: boolean;
  onToggleTouchDraws: () => void;
  /** How many items the layer currently holds — 清除 is disabled at zero. */
  itemCount: number;
  /** Folded layout for the Dialog host (design §2.4). */
  compact?: boolean;
  className?: string;
}

/**
 * Props of `annotation-canvas.tsx` — the ink layer (L1 in design §1.2) and the
 * only pointer target.
 *
 * `box` and `rect` are the same rectangle in two coordinate systems on purpose:
 * the ink is drawn through `box` (the base rectangle in the layer root's own CSS
 * pixels) and pointers are normalized with `rect` (viewport). Deriving one from
 * the other inside the canvas would mean measuring its own offset parent, which
 * is exactly the kind of hidden coupling the frozen contract exists to avoid.
 *
 * The canvas element itself is bigger than that rectangle: it covers the whole
 * layer root ({@link AnnotationCanvasProps.canvas}). Two reasons, both about
 * gestures — the host's pan/pinch must work when a finger lands on the
 * `object-contain` letterbox beside the photo, and the ink must not be clipped
 * any earlier than the host clips it. The ink simply stops being drawn outside
 * `box`.
 *
 * A pdf page is the one case where the element is *not* bigger: the layer
 * portals one canvas per page and the canvas fills the page box exactly, so
 * `box` is the whole element and the rectangle comes from the element itself
 * ({@link AnnotationCanvasProps.selfMeasured}).
 */
export interface AnnotationCanvasProps {
  rasterScale?: number;
  isNavigationGesture?: (event: PointerEvent) => boolean;
  /** The base rectangle, in the layer root's own CSS pixels — the ink origin. */
  box: LayerBox;
  /** The canvas element's own CSS box; always the layer root's layout size. */
  canvas: { width: number; height: number };
  /** The base rectangle in viewport CSS pixels — what pointers are normalized against. */
  rect: BaseRect;
  /**
   * `true` when the canvas element **is** the base rectangle, which is the pdf
   * case: the canvas is portaled into the page box and fills it exactly, so
   * `rect` above is only a size carrier and the real measurement is taken from
   * the element itself **at gesture start**.
   *
   * That timing is the point. A paginated host scrolls its base under a canvas
   * whose viewport position therefore changes without a resize, so a `rect`
   * cached in state is stale the moment the reader scrolls — normalizing a pen
   * sample against it would draw the stroke displaced by exactly the scroll
   * offset. Measuring at `pointerdown` and holding that rectangle for the
   * gesture is both exact and cheap (one layout read per stroke, not per sample).
   */
  selfMeasured?: boolean;
  /**
   * Upper bound on the device-pixel ratio the ink is rasterised at, or unbounded
   * when omitted (the image host's case).
   *
   * A pdf page's own bitmap is capped at 2 (`pdf-page.tsx`), so a 3× ink canvas
   * over a 2× page is 2¼ times the pixels of the page it sits on — for ink that is
   * *strokes*, whose crispness is already bounded by the bitmap underneath. On a
   * tablet whose window reports dpr 3 that is the difference between tens of
   * megabytes per visible page and well over a hundred.
   */
  maxDpr?: number;
  /**
   * Ceiling on how many device pixels **this canvas** may be rasterised into, or
   * unbounded when omitted (the image host's case).
   *
   * A ratio cap alone does not bound a surface whose size follows a zoom: the
   * element is *pinned* to its base, so at a large multiplier the ink canvas is
   * `base² × multiplier²` CSS pixels before any density is applied — a pdf page at
   * 6× is 17 MP of CSS, 70 MP at dpr 2, per canvas, with a second (the committed
   * cache) behind it. That is an allocation the browser may refuse, and paying for
   * it every frame of a pinch makes the ink the slowest thing on screen instead of
   * the fastest.
   *
   * A host passes whatever the base underneath it uses, so paper and ink stay one
   * density: a pdf hands in `PDF_MAX_PIXELS`, the same budget `pdfRasterDpr` gives
   * its own page bitmaps. It is measured against the **canvas element's** box —
   * which for a paginated ({@link AnnotationCanvasProps.selfMeasured}) surface is
   * the base rectangle itself, and for a single-surface host the whole layer root.
   *
   * Two things the caller should know. A surface whose box changes with a zoom is
   * priced again on every step, so the ink's density is the *live* box's while the
   * page bitmap's is the *painted* one: mid-gesture the ink can be a shade coarser
   * than the paper, and the two agree again as soon as the raster lands. And the
   * budget bounds one surface, not one page — a paginated host that also keeps an
   * offscreen cache of the ink (this canvas does) spends twice this much per page,
   * on top of whatever its own base costs.
   */
  maxPixels?: number;
  items: Annotation[];
  tool: AnnotationTool;
  eraserMode?: EraserMode;
  /** Nib width in normalized units ({@link ANNOTATION_SIZES}). */
  size: number;
  color: AnnotationColorKey;
  /**
   * Design §0.3-5's fallback switch: when on, a single finger draws like a pen.
   * It is a **layer** decision (the toolbar owns it) that reaches the state machine
   * through here, because the canvas is the only thing that sees the pointers.
   */
  touchDraws?: boolean;
  hidden?: boolean;
  /**
   * Show the ink, take no ink. The element stays hit-testable — a host whose
   * pan/zoom lives on this canvas (an image) keeps its gestures — but nothing is
   * sampled and nothing can be committed, which is what "read-only" has to mean
   * for a layer with no writer: otherwise a stroke would be drawn, mirrored
   * locally, and thrown away on the next render.
   */
  readOnly?: boolean;
  /**
   * The host's viewport controller. When present the ink canvas also becomes the
   * gesture surface for the whole stack (see
   * {@link AnnotationLayerProps.panZoom}).
   */
  panZoom?: PanZoomController;
  /**
   * Arbitrate the pointer sequence without a controller (see
   * {@link AnnotationLayerProps.arbitrateViewport}): palm rejection, closing a
   * stroke when a second finger lands, and the multi-finger taps.
   */
  arbitrateViewport?: boolean;
  /**
   * Whether the canvas takes pointers at all. `false` is 浏览 mode: the ink stays
   * painted, the host's own gestures are unaffected, and the element underneath
   * (a pdf's text layer) can be selected again.
   */
  pointerEnabled?: boolean;
  /** 双指轻点撤回 — the layer's own history, so the canvas only reports the tap. */
  onUndo?: () => void;
  /** 三指轻点重做. */
  onRedo?: () => void;
  /** One finished gesture, reported once. */
  onOperation: (operation: AnnotationOperation) => void;
  /** A gesture started / ended — the layer uses it for the cursor and for ⌘Z focus. */
  onActiveChange?: (active: boolean) => void;
}
