// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The assembly point: `<AnnotationLayer />` is what a node-content host mounts
 * over its base image, and the only file that knows how the pieces fit together.
 *
 * Design §1.2's three boundaries are the whole reason this file is small:
 *
 * 1. **It never learns who its host is.** Everything it knows about the base layer
 *    arrives through {@link AnnotationLayerProps.getBaseRect} — a callback the host
 *    re-creates whenever the base actually changes (image loaded, container
 *    resized). Nothing here imports the image node content, the store or the route.
 * 2. **It never persists.** A finished gesture becomes a new `items` array, which is
 *    handed to `onItemsChange`; the host decides what that means (for an image node:
 *    `patchContent({ annotations })` through the shared M1 writer).
 * 3. **It registers no global keyboard.** The one `onKeyDown` lives on its own
 *    root element, so it only fires while a gesture or a toolbar button has focus
 *    (the ink canvas is `tabIndex={0}`, which is also what makes ⌘Z work right
 *    after drawing). Nothing is added to `window`/`document` for keys.
 *
 * Stacking follows design §4.2 exactly, because that table is what keeps the
 * canvas from eating the rest of the editor: this root is `pointer-events-none`,
 * the ink canvas (L1) and the toolbar (L3) are the only two things that take
 * pointers, and they are **siblings** — the toolbar floats in its own corner rather
 * than inside the canvas, so a click on a button never reaches the state machine.
 *
 * ## Viewport gestures live one level down
 *
 * Pan / pinch / 恢复位置大小 (单指双击) are the host's *transform* (`panZoom`), and
 * 双指轻点撤回 / 三指轻点重做 are this layer's *history* (`undo` / `redo`). Both
 * are recognised on the ink canvas — the only element a pointer ever lands on —
 * by `use-annotation-input.ts`, which then either drives the controller or calls
 * the two callbacks forwarded here. The layer itself never holds a viewport: it
 * stays host-agnostic, which is why a pdf host can mount it later with its own
 * controller and get the same gestures for free.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Annotation } from "@workspace/interfaces";
import { cn } from "@workspace/ui/lib/utils";

import { useBrushSettings } from "./use-brush-settings";
import { useToolbarPreference } from "./use-toolbar-preference";
import { AnnotationCanvas } from "./annotation-canvas";
import { AnnotationToolbar } from "./annotation-toolbar";
import { toLayerBox } from "./geometry";
import type {
  AnnotationLayerProps,
  AnnotationOperation,
  AnnotationTool,
  EraserMode,
  BaseRect,
  LayerBox,
} from "./types";
import { ANNOTATION_SIZES, DEFAULT_ANNOTATION_TOOL } from "./types";

const NO_ITEMS: Annotation[] = [];

/** How many gestures can be taken back. Generous, because an item is small. */
const HISTORY_LIMIT = 200;

/**
 * One gesture, in the form ⌘Z needs.
 *
 * The persisted `items` array is the truth; a history entry is only enough
 * information to move that array one gesture in either direction. `add` needs the
 * item, `remove` needs each item **and where it was**, so undo restores the
 * original z-order instead of appending an erased highlight back on top.
 */
type HistoryEntry =
  | { kind: "add"; item: Annotation }
  | {
      kind: "remove";
      removed: { item: Annotation; index: number }[];
      added?: { item: Annotation; index: number }[];
    };

interface History {
  entries: HistoryEntry[];
  /** How many entries are currently applied (`canUndo = index > 0`). */
  index: number;
}

const EMPTY_HISTORY: History = { entries: [], index: 0 };

/** Two rects are the same measurement — used to skip a re-render, not to compare. */
function sameRect(a: BaseRect | null, b: BaseRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
}

function sameSize(
  a: { width: number; height: number },
  b: { width: number; height: number },
): boolean {
  return a.width === b.width && a.height === b.height;
}

/**
 * Do two surface lists describe the same pixels?
 *
 * A fresh measurement produces fresh objects every time, so without this every
 * resize event would re-render every canvas — and each canvas re-render replays
 * its cached ink. The page identity and the three rectangles are the whole
 * contract, so that is the comparison.
 */
function sameSurfaces(a: LayerSurface[], b: LayerSurface[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const first = a[i]!;
    const second = b[i]!;
    if (
      first.page !== second.page ||
      first.element !== second.element ||
      !sameRect(first.rect, second.rect) ||
      !sameRect(first.box, second.box) ||
      !sameSize(first.canvas, second.canvas)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Identity comparison for the `items` prop.
 *
 * The host is allowed (and likely) to hand over a freshly built array every
 * render; comparing references would then look like "someone else changed the
 * annotations" on every keystroke and wipe the undo stack. Ids in order are the
 * cheap, honest comparison: same ids means same set, and only a real edit — ours
 * or another client's — changes them.
 */
function sameItems(
  a: readonly Annotation[],
  b: readonly Annotation[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]!.id !== b[i]!.id) return false;
  }
  return true;
}

/**
 * What the layer paints on: one entry per ink surface (see `types.ts`).
 *
 * A single-surface host (an image) is the one-element case — `element`
 * `undefined` means "the layer's own root", which is what the canvas has always
 * been a child of. A pdf hands over N page boxes and gets N canvases portaled into
 * them, each carrying only its own page's items.
 */
interface LayerSurface {
  /** 0-based page, or `undefined` for a single-surface base. */
  page: number | undefined;
  /** Portal target; `undefined` = the layer root itself. */
  element: HTMLElement | undefined;
  /** The base rectangle in viewport px (single surface only — see `selfMeasured`). */
  rect: BaseRect;
  /** The base rectangle inside the canvas element — the ink origin. */
  box: LayerBox;
  /** The canvas element's own CSS box. */
  canvas: { width: number; height: number };
  /** `true` for a page canvas: it *is* the base rectangle, so it self-measures. */
  selfMeasured: boolean;
}

interface LayerGeometry {
  surfaces: LayerSurface[];
}

/** The single-surface geometry, expressed as the one-element case of the above. */
function singleSurface(
  rect: BaseRect,
  box: LayerBox,
  canvas: { width: number; height: number },
): LayerSurface {
  return {
    page: undefined,
    element: undefined,
    rect,
    box,
    canvas,
    selfMeasured: false,
  };
}

export function AnnotationLayer({
  selfMeasured = false,
  rasterScale = 1,
  suspendMeasurement = false,
  toolbarContainer,
  defaultPointerEnabled = true,
  onPointerEnabledChange,
  isNavigationGesture,
  onActiveChange,
  items: itemsProp,
  onItemsChange,
  getBaseRect,
  getSurfaces,
  surfacesKey,
  onTouchDrawsChange,
  arbitrateViewport = false,
  pointerToggle = false,
  onResetView,
  defaultTool = DEFAULT_ANNOTATION_TOOL,
  compact,
  maxDpr,
  maxPixels,
  readOnly = false,
  panZoom,
  className,
}: AnnotationLayerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // `items` is controlled when the host can persist it, and mirrored locally when
  // it cannot (a read-only view with no writer) so the layer is still usable.
  const [localItems, setLocalItems] = useState<Annotation[]>(
    itemsProp ?? NO_ITEMS,
  );
  const items = onItemsChange ? (itemsProp ?? NO_ITEMS) : localItems;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [tool, setTool] = useToolbarPreference<AnnotationTool>(
    "tool",
    defaultPointerEnabled ? defaultTool : "pointer",
    (value): value is AnnotationTool =>
      typeof value === "string" &&
      [
        "pointer",
        "pen",
        "pencil",
        "fountain",
        "marker",
        "highlighter",
        "eraser",
      ].includes(value),
  );
  const { color, size, setColor, setSize } = useBrushSettings(tool);
  const [hidden, setHidden] = useToolbarPreference(
    "hidden",
    false,
    (value): value is boolean => typeof value === "boolean",
  );
  const [touchDraws, setTouchDraws] = useToolbarPreference(
    "touchDraws",
    false,
    (value): value is boolean => typeof value === "boolean",
  );
  /** Ink ownership; navigation remains on the host in browsing mode. */
  const pointerEnabled = tool !== "pointer";
  const [eraserMode, setEraserMode] = useToolbarPreference<EraserMode>(
    "eraserMode",
    "stroke",
    (value): value is EraserMode => value === "stroke" || value === "path",
  );
  const [active, setActive] = useState(false);

  useEffect(() => {
    onPointerEnabledChange?.(pointerEnabled);
  }, [onPointerEnabledChange, pointerEnabled]);
  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  /**
   * The geometry of every surface — always in one read, so a canvas can never be
   * sized for one frame and positioned for another.
   */
  const [geometry, setGeometry] = useState<LayerGeometry | null>(null);

  /**
   * The observer and the elements it is currently watching.
   *
   * The observer is created once and then **re-pointed** by every measurement
   * ({@link syncObserved}) rather than rebuilt around the surface list. A host may
   * announce a geometry change on every frame of a gesture — the pdf's multiplier
   * is part of `surfacesKey` — and an observer re-created per frame would take a
   * fresh "initial" notification for every page each time, i.e. a burst of forced
   * layouts in the middle of the pinch the measurement exists to keep smooth.
   */
  const observerRef = useRef<ResizeObserver | null>(null);
  const observedRef = useRef<Element[]>([]);

  /** `measure` as the observer callback sees it: the current render's closure. */
  const measureRef = useRef<(() => void) | null>(null);

  /** Point the observer at exactly the elements just measured. */
  const syncObserved = useCallback((elements: readonly Element[]) => {
    const observer = observerRef.current;
    const previous = observedRef.current;
    observedRef.current = [...elements];
    if (!observer) return;
    const wanted = new Set(elements);
    for (const element of elements) {
      if (!previous.includes(element)) observer.observe(element);
    }
    for (const element of previous) {
      if (!wanted.has(element)) observer.unobserve(element);
    }
  }, []);

  /**
   * The items of one page, in a stable array.
   *
   * Identity matters here: a canvas replays its cached layer whenever its `items`
   * prop changes, so handing it a fresh `filter()` on every render would replay
   * every page's ink on every keystroke of the toolbar. Memoised per `items`, and
   * the image's single surface skips the map entirely.
   */
  const pageItems = useMemo(() => {
    const map = new Map<number | undefined, Annotation[]>();
    for (const item of items) {
      const key = item.page;
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }
    return map;
  }, [items]);

  /**
   * Re-measure the base layer.
   *
   * Both rectangles come out of the same tick so they cannot describe different
   * frames: `getBaseRect()` is the host's answer (the image's drawn rect, letterbox
   * excluded) and the root's own rect turns it into the canvas's local box.
   *
   * The root's **layout** size goes along with it: `getBoundingClientRect()` bakes
   * in any ancestor transform, and the node editor's Dialog opens with
   * `zoom-in-95`, so a measurement taken inside that 100 ms window would otherwise
   * be 5% small forever — a transform is invisible to `ResizeObserver`. See
   * {@link toLayerBox}, which re-expresses the whole measurement in the space the
   * canvas element is laid out in (and is pinned by `geometry.test.ts`).
   */
  const measure = useCallback(() => {
    if (suspendMeasurement) return;
    const root = rootRef.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    const canvas = { width: root.offsetWidth, height: root.offsetHeight };
    const rootRect = {
      left: origin.left,
      top: origin.top,
      width: origin.width,
      height: origin.height,
    };

    if (getSurfaces) {
      /**
       * The paginated read. Each page box is measured **relative to the layer
       * root**, and that relative offset is what makes this cheap: both the root
       * and the pages live in the same scrolled coordinate space, so the
       * difference survives a scroll untouched and the ink does not have to be
       * re-measured (and cannot lag) while the reader scrolls.
       *
       * `toLayerBox` divides the accumulated ancestor transform back out, exactly
       * as for the image, so the portaled canvas is sized in the page element's
       * own layout pixels — the space its CSS box lives in.
       */
      const surfaces: LayerSurface[] = [];
      // Every page the host announced is watched, including one whose box is not
      // usable *yet*: a zero-sized box is skipped as a surface, but if it also went
      // unobserved nothing would tell us when it grew, and the page would stay
      // inkless until some unrelated re-measure.
      const elements: HTMLElement[] = [];
      for (const entry of getSurfaces() ?? []) {
        elements.push(entry.element);
        const measured = entry.element.getBoundingClientRect();
        const box = toLayerBox(
          {
            left: measured.left,
            top: measured.top,
            width: measured.width,
            height: measured.height,
          },
          rootRect,
          canvas,
        );
        if (box.width <= 0 || box.height <= 0) continue;
        // The canvas *is* the page box, so its own draw space starts at (0, 0)
        // and is as big as the page: `box` and `canvas` are the same rectangle.
        const size = { width: box.width, height: box.height };
        surfaces.push({
          page: entry.page,
          element: entry.element,
          rect: { left: 0, top: 0, ...size },
          box: { left: 0, top: 0, ...size },
          canvas: size,
          selfMeasured: true,
        });
      }
      syncObserved(elements);
      setGeometry((previous) =>
        previous && sameSurfaces(previous.surfaces, surfaces)
          ? previous
          : { surfaces },
      );
      return;
    }

    if (selfMeasured) {
      // Image and ink share one transformed parent. Keep the backing store in
      // its unscaled layout space; pointer sampling measures the live canvas.
      const rect = { left: 0, top: 0, ...canvas };
      const surface = {
        ...singleSurface(rect, rect, canvas),
        selfMeasured: true,
      };
      setGeometry((previous) =>
        previous && sameSurfaces(previous.surfaces, [surface])
          ? previous
          : { surfaces: [surface] },
      );
      return;
    }
    const rect = getBaseRect?.() ?? null;
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      syncObserved([]);
      setGeometry((previous) => (previous === null ? previous : null));
      return;
    }
    const box = toLayerBox(rect, rootRect, canvas);
    syncObserved([]);
    setGeometry((previous) =>
      previous &&
      previous.surfaces.length === 1 &&
      sameRect(previous.surfaces[0]!.rect, rect) &&
      sameRect(previous.surfaces[0]!.box, box) &&
      sameSize(previous.surfaces[0]!.canvas, canvas)
        ? previous
        : { surfaces: [singleSurface(rect, box, canvas)] },
    );
  }, [
    getBaseRect,
    getSurfaces,
    selfMeasured,
    suspendMeasurement,
    syncObserved,
  ]);
  // Read by the observer callback, which outlives the render that created it.
  measureRef.current = measure;

  // The observer itself: created once, kept for the life of the layer, and
  // re-pointed by the measurements below. It is what covers the changes no host
  // can announce — a window resize, a font reflow, a page box that grows when the
  // document finally reports its real size.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measureRef.current?.());
    observerRef.current = observer;
    observer.observe(root);
    for (const element of observedRef.current) observer.observe(element);
    return () => {
      observer.disconnect();
      observerRef.current = null;
      observedRef.current = [];
    };
  }, []);

  // The measurement pass: the first one, and then every moment the host announces
  // through `surfacesKey` — which is what a *newly mounted* page arrives by (an
  // observer cannot watch an element it has never been handed) and, for the pdf,
  // what a new multiplier arrives by.
  //
  // It is a **layout** effect on purpose, and the reason is the ink's backing
  // store: a page canvas is pinned to its page box (`inset: 0`), so its CSS box
  // moves with the page in the commit that changed the multiplier. Measuring in
  // that same commit — before the browser paints — is what lets the canvas resize
  // its store in the same paint. Through a resize observer the store would always
  // be one frame behind its own box, and the compositor would resample the ink on
  // every step of a pinch: soft, and visibly shimmering.
  //
  // The observers remain the fallback for everything the host does *not* announce
  // (a window resize, a page box that grows when the document reports its real
  // size). One such change costs exactly one resampled frame: a `ResizeObserver`
  // callback's `setState` is not flushed before the paint the way a layout effect's
  // is. That is the price of not making every host announce every geometry change,
  // and it is one frame, once, per unannounced resize.
  useLayoutEffect(() => {
    measure();
  }, [measure, surfacesKey]);

  useEffect(() => {
    if (getSurfaces) return;
    const onScrollOrResize = () => measure();
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [getSurfaces, measure]);

  /**
   * The other half of the transform story: an animation or transition that ends on
   * the layer root **or on one of its ancestors** — the Dialog's open animation is
   * the one that matters today — re-measures when it settles.
   *
   * `toLayerBox` already makes a *scale* measurement exact while it is running, so
   * this is not what fixes the reported defect; it is the cheap safety net for the
   * transforms the ratio cannot describe (a rotation, a skew, a scale applied to
   * the image but not to the root) and it keeps the layer correct if a host
   * animates something other than a uniform scale. The listener is filtered to the
   * layer's own ancestor chain so the Dialog's hover transitions cannot turn into a
   * measurement per frame.
   */
  useEffect(() => {
    const onSettled = (event: Event) => {
      const root = rootRef.current;
      const target = event.target;
      if (!root || !(target instanceof Node)) return;
      if (target === root || target.contains(root) || root.contains(target)) {
        measure();
      }
    };
    document.addEventListener("transitionend", onSettled, true);
    document.addEventListener("animationend", onSettled, true);
    return () => {
      document.removeEventListener("transitionend", onSettled, true);
      document.removeEventListener("animationend", onSettled, true);
    };
  }, [measure]);

  /**
   * External-change detection. When the host swaps the whole layer — another node
   * opened in the same dialog, an upload that replaced the content, a remote
   * write — the undo stack describes edits that are no longer on screen and must
   * be thrown away rather than replayed onto someone else's data.
   */
  const emittedRef = useRef<readonly Annotation[] | null>(null);
  useEffect(() => {
    const incoming = itemsProp ?? NO_ITEMS;
    if (sameItems(incoming, emittedRef.current ?? itemsRef.current)) return;
    emittedRef.current = incoming;
    setHistory(EMPTY_HISTORY);
    setLocalItems(incoming);
  }, [itemsProp]);

  const commit = useCallback(
    (next: Annotation[], entry: HistoryEntry) => {
      emittedRef.current = next;
      // A new gesture discards the redo tail — there is no redo of "the future
      // that never happened".
      setHistory((previous) => {
        const entries = [
          ...previous.entries.slice(0, previous.index),
          entry,
        ].slice(-HISTORY_LIMIT);
        return { entries, index: entries.length };
      });
      if (onItemsChange) onItemsChange(next);
      else setLocalItems(next);
    },
    [onItemsChange],
  );

  /**
   * One finished gesture → a new array + one undo step (design §0.3-7).
   *
   * `page` is the surface the gesture happened on. It is stamped here rather than
   * in the canvas because the canvas is page-agnostic on purpose: it is handed one
   * page's items and reports a gesture, and *which* page that is belongs to the
   * layer, which is the only place that knows the surface list. A removal needs no
   * page — an id is unique across the document.
   */
  const handleOperation = useCallback(
    (operation: AnnotationOperation, page: number | undefined) => {
      const current = itemsRef.current;
      const stamped: AnnotationOperation =
        page === undefined || operation.kind !== "add"
          ? operation
          : { kind: "add", item: { ...operation.item, page } };
      if (stamped.kind === "add") {
        commit([...current, stamped.item], {
          kind: "add",
          item: stamped.item,
        });
        return;
      }
      if (stamped.kind === "replace") {
        const replacements = new Map(
          stamped.replacements.map((entry) => [entry.original.id, entry.items]),
        );
        const removed = current
          .map((item, index) => ({ item, index }))
          .filter((entry) => replacements.has(entry.item.id));
        if (!removed.length) return;
        const next = current.flatMap(
          (item) => replacements.get(item.id) ?? [item],
        );
        const originalIds = new Set(current.map((item) => item.id));
        const added = next
          .map((item, index) => ({ item, index }))
          .filter((entry) => !originalIds.has(entry.item.id));
        commit(next, { kind: "remove", removed, added });
        return;
      }
      if (stamped.items.length === 0) return;

      const removedIds = new Set(stamped.items.map((item) => item.id));
      const removed = current
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => removedIds.has(item.id));
      if (removed.length === 0) return;

      commit(
        current.filter((item) => !removedIds.has(item.id)),
        { kind: "remove", removed },
      );
    },
    [commit],
  );

  /**
   * The host has to know whether a single finger draws (see
   * {@link AnnotationLayerProps.onTouchDrawsChange}) — a host that scrolls would
   * otherwise pan with the same finger the pen is writing with.
   */
  useEffect(() => {
    onTouchDrawsChange?.(touchDraws && pointerEnabled);
  }, [onTouchDrawsChange, touchDraws, pointerEnabled]);

  const canUndo = history.index > 0;
  const canRedo = history.index < history.entries.length;

  // Both directions read the entry from state rather than from inside a state
  // updater: an updater may run twice (StrictMode), and handing the host a write
  // from inside one would persist the same edit twice.
  const undo = useCallback(() => {
    if (history.index === 0) return;
    const entry = history.entries[history.index - 1]!;
    const current = itemsRef.current;
    const next =
      entry.kind === "add"
        ? current.filter((item) => item.id !== entry.item.id)
        : reinsert(
            current.filter(
              (item) =>
                !entry.added?.some((added) => added.item.id === item.id),
            ),
            entry.removed,
          );
    emittedRef.current = next;
    setHistory({ entries: history.entries, index: history.index - 1 });
    if (onItemsChange) onItemsChange(next);
    else setLocalItems(next);
  }, [history, onItemsChange]);

  const redo = useCallback(() => {
    if (history.index >= history.entries.length) return;
    const entry = history.entries[history.index]!;
    const current = itemsRef.current;
    const next =
      entry.kind === "add"
        ? [...current, entry.item]
        : reinsert(
            current.filter(
              (item) => !entry.removed.some((gone) => gone.item.id === item.id),
            ),
            entry.added ?? [],
          );
    emittedRef.current = next;
    setHistory({ entries: history.entries, index: history.index + 1 });
    if (onItemsChange) onItemsChange(next);
    else setLocalItems(next);
  }, [history, onItemsChange]);

  const clear = useCallback(() => {
    const current = itemsRef.current;
    if (current.length === 0) return;
    // 清除 is a normal operation, not a special case: it goes on the stack, so one
    // ⌘Z brings everything back (design §2.1's 清除 row).
    commit([], {
      kind: "remove",
      removed: current.map((item, index) => ({ item, index })),
    });
  }, [commit]);

  const stepSize = useCallback(
    (direction: number) => {
      setSize((current) => {
        const at = ANNOTATION_SIZES.indexOf(current);
        const next = Math.min(
          Math.max((at === -1 ? 1 : at) + direction, 0),
          ANNOTATION_SIZES.length - 1,
        );
        return ANNOTATION_SIZES[next]!;
      });
    },
    [setSize],
  );

  /**
   * Keyboard, scoped to the layer's own subtree (boundary 3).
   *
   * The digit shortcuts the design lists for tools (`1`, `3`) collide with the ones
   * it lists for colours (`0`–`5`), so colours are toolbar-only; the letters are
   * unambiguous and both are offered.
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (readOnly) return;
      const modifier = event.metaKey || event.ctrlKey;

      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier || event.altKey) return;

      switch (event.key) {
        case "v":
        case "V":
          setTool("pointer");
          return;
        case "p":
        case "P":
        case "1":
          setTool("pen");
          return;
        case "b":
        case "B":
          setTool("pencil");
          return;
        case "f":
        case "F":
          setTool("fountain");
          return;
        case "m":
        case "M":
          setTool("marker");
          return;
        case "h":
        case "H":
        case "2":
          setTool("highlighter");
          return;
        case "e":
        case "E":
        case "3":
          setTool("eraser");
          return;
        case "[":
          stepSize(-1);
          return;
        case "]":
          stepSize(1);
          return;
        case "\\":
          setHidden((current) => !current);
          return;
        // 恢复位置大小, the keyboard twin of the single-finger double tap and of
        // the host's reset button. `0` is free: the
        // design's digit shortcuts for colours were never implemented (the layer
        // registers no global keyboard and colours are toolbar-only), and the
        // letters above are what the toolbar lists.
        case "0":
          // A transform host resets its controller; a scrolling host supplies the
          // action (`AnnotationLayerProps.onResetView`).
          if (panZoom) panZoom.reset();
          else onResetView?.();
          return;
        default:
          return;
      }
    },
    [onResetView, panZoom, readOnly, redo, stepSize, undo, setHidden, setTool],
  );

  // No document-level key handler is needed for a portaled page canvas: React
  // dispatches synthetic events along the **React** tree, so the root's `onKeyDown`
  // above already receives keys from a canvas that lives in a page box (the same
  // property `annotation-toolbar.tsx` relies on for its portalled menu). Adding one
  // fired every shortcut twice — `[`/`]` stepped two nibs, `\` toggled twice.

  const toolbar = useMemo(
    () =>
      readOnly ? null : (
        <AnnotationToolbar
          tool={tool}
          onToolChange={setTool}
          color={color}
          onColorChange={setColor}
          size={size}
          onSizeChange={setSize}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          onClear={clear}
          hidden={hidden}
          onToggleHidden={() => setHidden((current) => !current)}
          touchDraws={touchDraws}
          onToggleTouchDraws={() => setTouchDraws((current) => !current)}
          eraserMode={eraserMode}
          onEraserModeChange={setEraserMode}
          onResetView={() => (panZoom ? panZoom.reset() : onResetView?.())}
          itemCount={items.length}
          compact={compact}
          className="z-30"
        />
      ),
    [
      setColor,
      setEraserMode,
      setHidden,
      setSize,
      setTool,
      setTouchDraws,
      canRedo,
      canUndo,
      clear,
      color,
      compact,
      hidden,
      items.length,
      eraserMode,
      panZoom,
      onResetView,
      readOnly,
      redo,
      size,
      tool,
      touchDraws,
      undo,
    ],
  );

  return (
    <div
      ref={rootRef}
      data-annotation-layer
      data-annotation-active={active ? "true" : undefined}
      onKeyDown={handleKeyDown}
      className={cn("pointer-events-none absolute inset-0", className)}
    >
      {geometry?.surfaces.map((surface) => {
        const canvas = (
          <AnnotationCanvas
            key={surface.page ?? "single"}
            box={surface.box}
            canvas={surface.canvas}
            rect={surface.rect}
            selfMeasured={surface.selfMeasured}
            rasterScale={rasterScale}
            maxDpr={maxDpr}
            maxPixels={maxPixels}
            items={
              surface.page === undefined
                ? items
                : (pageItems.get(surface.page) ?? NO_ITEMS)
            }
            tool={tool}
            eraserMode={eraserMode}
            size={size}
            color={color}
            touchDraws={touchDraws}
            hidden={hidden}
            readOnly={readOnly}
            panZoom={panZoom}
            arbitrateViewport={arbitrateViewport}
            pointerEnabled={!pointerToggle || pointerEnabled}
            isNavigationGesture={isNavigationGesture}
            onUndo={undo}
            onRedo={redo}
            onOperation={(operation) =>
              handleOperation(operation, surface.page)
            }
            onActiveChange={setActive}
          />
        );
        // A page canvas is portaled *into* its page box, which is what makes it
        // scroll, clip and zoom with the page instead of being re-measured onto it
        // every frame. The layer root stays the single owner of the toolbar and of
        // the history; only the pixels move into the page.
        //
        // The *portal* carries the key, not just the canvas inside it: an array of
        // portals is reconciled as a list, and an unkeyed entry is matched by
        // position — so a surface arriving in the middle of the list (a page
        // re-entering the rendering window) would hand its ink canvas another
        // page's component instance, and with it that page's cached pixels.
        return surface.element
          ? createPortal(canvas, surface.element, surface.page ?? "single")
          : canvas;
      })}
      {toolbarContainer ? createPortal(toolbar, toolbarContainer) : toolbar}
    </div>
  );
}

/** Put erased items back where they were, so z-order survives undo. */
function reinsert(
  items: readonly Annotation[],
  removed: readonly { item: Annotation; index: number }[],
): Annotation[] {
  const next = [...items];
  for (const { item, index } of [...removed].sort(
    (a, b) => a.index - b.index,
  )) {
    next.splice(Math.min(index, next.length), 0, item);
  }
  return next;
}
