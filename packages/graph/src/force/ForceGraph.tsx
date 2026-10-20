// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * ForceGraph — main-thread orchestrator for the d3-force + OffscreenCanvas
 * pipeline.
 *
 * Responsibilities:
 *
 *   1. **Worker lifecycle**: instantiate a `Worker` from
 *      `./worker/force.worker.ts`, expose its API via Comlink, send
 *      canvas dimensions for the worker to create its own OffscreenCanvas.
 *   2. **Data pipeline**:
 *      - Pull a snapshot from `getDataSnapshot()` (parent `Graph`).
 *      - Apply `view.filterConfig` via the `filter` callback (parent
 *        injects it).
 *      - Convert `NodeData[]` / `EdgeData[]` → `ForceNodeSeed[]` /
 *        `ForceLinkSeed[]` via `transform.ts`.
 *      - Push to worker via `api.initData` (full sync) or
 *        `api.applyDiff` (incremental).
 *   3. **Render loop**: every worker tick pushes an `ImageBitmap` over
 *      the raw `postMessage` channel; we paint it onto a `<canvas>` here.
 *   4. **Event loop**: install DOM listeners via `eventListener.ts` and
 *      forward `ProxiedDomEvent`s to the worker; receive `WorkerEvent`s
 *      back and dispatch them to `props.eventHandler.handleWorkerEvent`
 *      (the shared `GraphEventHandler` from `eventHandler.ts`).
 *   5. **ViewId changes**: re-pull data, re-init the worker.
 *   6. **StrictMode cleanup**: every effect must clean up its worker,
 *      listeners, and frame handlers.
 *
 * Per main design L384, this component does **not** receive a
 * `handlers` / `onSelect` / `onPreviewShow` prop. The only callback
 * surface is `eventHandler` (constructed in `Graph`).
 *
 * Cross-document contract: force/design.md §1-§7, main design L379-432.
 */

import * as Comlink from "comlink";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  EdgeData,
  EdgeId,
  EdgeType,
  NodeData,
  NodeId,
  View,
  ViewId,
} from "@workspace/interfaces";
import { DEFAULT_FORCE_CONFIG } from "./styleConfig";
import type {
  ForceConfig,
  ForceStyle,
  WorkerEvent,
  WorkerInbound,
} from "./types";
import {
  diffToForcePayload,
  edgeDataToForceSeeds,
  nodeDataToForceSeeds,
  setPosition,
} from "./transform";
import { installDomEventProxy, screenToSimulation } from "./eventListener";
import { useUIStore } from "@workspace/store";
import { useDataStore } from "@workspace/store";
import { NodeService } from "@workspace/services";
import { debounce } from "@workspace/utils";
import {
  GraphContextMenu,
  type GraphContextMenuProps,
} from "@workspace/ui/components/menu/graph-context-menu/graph-context-menu";
import { PreviewBlock } from "@workspace/ui/components/preview-block/preview-block";
import type { GraphEventHandler } from "../eventHandler";

// -----------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------

import type { GraphSnapshot, DiffCallback, SourceDiff } from "../types";
import { collectEdgeEndpointIds } from "../types";

export interface ForceGraphProps {
  view: View;
  viewId: ViewId;
  /** Parent `Graph` injects these to keep ForceGraph store-agnostic. */
  getDataSnapshot: () => GraphSnapshot;
  subscribeDiff: (cb: DiffCallback) => () => void;
  /**
   * Filter applied to the raw snapshot. Receives the view so the parent
   * can apply its `filterConfig`.
   */
  filter: (
    nodes: NodeData[],
    edges: EdgeData[],
    view: View,
  ) => { nodes: NodeData[]; edges: EdgeData[] };
  /**
   * The single callback surface. ForceGraph never touches `useUIStore`
   * directly and never calls any of the `useGraph()` 11 callbacks
   * directly — every gesture is routed through here.
   */
  eventHandler: GraphEventHandler;
  /** Optional className for the outer container. */
  className?: string;
  /** Optional inline style for the outer container. */
  style?: React.CSSProperties;
  /** Show or hide the minimap stub. (Real minimap renders in a future PR.) */
  showMinimap?: boolean;
}

export interface ForceGraphHandle {
  /** Imperative re-init (used by the parent Graph). */
  resync: () => void;
  /** Stop the simulation. */
  stop: () => void;
  /** Resume the simulation. */
  resume: () => void;
}

// -----------------------------------------------------------------------
// Style mapping
// -----------------------------------------------------------------------

/**
 * Maps the current view's `visualConfig` to the worker's global
 * `ForceStyle`. `undefined` backgroundStyle keeps the legacy always-visible
 * grid for views without an explicit style; "solid" is a plain colored
 * background (no grid layer).
 */
function buildForceStyle(view: View): ForceStyle {
  const vc = view.visualConfig ?? {};
  return {
    backgroundColor: vc.backgroundColor || "#ffffff",
    gridColor: vc.gridColor || "#e5e7eb",
    backgroundStyle:
      vc.backgroundStyle === "grid" || vc.backgroundStyle === "dots"
        ? vc.backgroundStyle
        : vc.backgroundStyle === undefined
          ? "grid"
          : "none",
  };
}

/**
 * The view's persisted boundary node density, or the renderer default.
 *
 * `visualConfig.nodeDensity` is a user preference (the graph header's
 * slider) and may be absent, `0`, or garbage in an old record; the force
 * layer must still run, so an unusable value falls back rather than
 * disabling the boundary.
 */
function resolveBoundaryDensity(view: View): number {
  const value = view.visualConfig?.nodeDensity;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_FORCE_CONFIG.boundaryDensity;
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export const ForceGraph = forwardRef<ForceGraphHandle, ForceGraphProps>(
  function ForceGraph(props, ref) {
    useI18n();

    const {
      view,
      viewId,
      getDataSnapshot,
      subscribeDiff,
      filter,
      eventHandler,
      className,
      style,
    } = props;

    // ---- Refs --------------------------------------------------------
    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const workerRef = useRef<Worker | null>(null);
    const apiRef = useRef<WorkerInbound | null>(null);
    const listenersRef = useRef<
      import("./eventListener").InstalledListeners | null
    >(null);
    const canvasRectRef = useRef<DOMRect | null>(null);
    const viewportRef = useRef({ x: 0, y: 0, scale: 1 });
    const dprRef = useRef(Math.max(1, globalThis.devicePixelRatio ?? 1));
    const currentViewIdRef = useRef<ViewId>(viewId);
    // Always point to the latest view — the mount effect captures
    // callbacks once, so they read view via this ref to stay fresh when
    // the same-id View object changes (e.g. filterConfig edit).
    const viewRef = useRef(view);
    viewRef.current = view;

    // ---- Local state ------------------------------------------------
    const [isReady, setIsReady] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [contextMenuState, setContextMenuState] = useState<
      (GraphContextMenuProps & { setContextMenu?: (m: unknown) => void }) | null
    >(null);

    const setContextMenu = useCallback(
      (menu: {
        x: number;
        y: number;
        type: GraphContextMenuProps["type"];
        context: GraphContextMenuProps["context"];
      }) => {
        useUIStore.getState().closePreviewBlock();
        setContextMenuState({
          x: menu.x,
          y: menu.y,
          visible: true,
          type: menu.type,
          context: menu.context,
          onClose: () => setContextMenuState(null),
        } as GraphContextMenuProps);
      },
      [],
    );
    const previewBlock = useUIStore((s) => s.previewBlock);
    const closePreviewBlock = useUIStore((s) => s.closePreviewBlock);

    // ---- Worker setup ------------------------------------------------
    const setupWorker = useCallback(async (): Promise<{
      api: WorkerInbound;
      worker: Worker;
    }> => {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("canvas ref is null");
      const container = containerRef.current;
      if (!container) throw new Error("container ref is null");

      const rect = container.getBoundingClientRect();
      canvasRectRef.current = rect;
      const dpr = Math.max(1, globalThis.devicePixelRatio ?? 1);
      dprRef.current = dpr;
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      // After Phase 2 (direct OffscreenCanvas transfer), the main thread
      // no longer holds a 2D context. All rendering is done by PixiJS in
      // the worker, composited onto the page by the browser GPU.

      const worker = new Worker(
        new URL("./worker/force.worker.ts", import.meta.url),
        { type: "module" },
      );

      await new Promise<void>((resolve, reject) => {
        const onMsg = (ev: MessageEvent) => {
          if (ev.data?.type === "__READY__") {
            worker.removeEventListener("message", onMsg);
            clearTimeout(timeoutId);
            resolve();
          }
        };
        const timeoutId = setTimeout(
          () => reject(new Error("worker boot timeout")),
          5000,
        );
        worker.addEventListener("message", onMsg);
        worker.addEventListener(
          "error",
          () => {
            clearTimeout(timeoutId);
            reject(new Error("worker boot error"));
          },
          { once: true },
        );
      });

      // Phase 2: transfer OffscreenCanvas ownership to the worker so
      // PixiJS renders directly into the page-visible canvas (zero-copy
      // GPU compositing — no more ImageBitmap / drawImage copying).
      const offscreenCanvas = canvas.transferControlToOffscreen();
      worker.postMessage(
        { type: "__SET_CANVAS__", canvas: offscreenCanvas, width, height, dpr },
        [offscreenCanvas],
      );

      // Persistent error handler — surface unexpected worker crashes
      worker.addEventListener("error", (ev) => {
        console.error("[ForceGraph] Worker error:", ev.message);
        setError(new Error(`Worker crash: ${ev.message}`));
      });

      const api = Comlink.wrap<WorkerInbound>(worker);

      const onWorkerMessage = (ev: MessageEvent) => {
        if (ev.data?.type === "__ERROR__") {
          console.error("[ForceGraph] Worker reported error:", ev.data.message);
          setError(new Error(ev.data.message));
        }
      };
      worker.addEventListener("message", onWorkerMessage);

      workerRef.current = worker;
      apiRef.current = api;

      return { api, worker };
    }, []);

    // ---- Full sync (re-init from snapshot) ----------------------------
    const buildSemanticColorMaps = useCallback(() => {
      const storeState = useDataStore.getState();
      const semanticColorMap = new Map<string, string>();
      for (const [id, sem] of storeState.nodeSemantics) {
        if (sem.color) semanticColorMap.set(id, sem.color);
      }
      const edgeSemanticColorMap = new Map<string, string>();
      const edgeSemanticCategoryMap = new Map<string, EdgeType>();
      const edgeSemanticNameMap = new Map<string, string>();
      for (const [id, sem] of storeState.edgeSemantics) {
        if (sem.color) edgeSemanticColorMap.set(id, sem.color);
        if (sem.category) edgeSemanticCategoryMap.set(id, sem.category);
        if (sem.name) edgeSemanticNameMap.set(id, sem.name);
      }
      return {
        semanticColorMap,
        edgeSemanticColorMap,
        edgeSemanticCategoryMap,
        edgeSemanticNameMap,
      };
    }, []);

    const performFullSync = useCallback(async () => {
      const api = apiRef.current;
      if (!api) return;
      const raw = getDataSnapshot();
      const currentView = viewRef.current;
      const filtered = filter(raw.nodes, raw.edges, currentView);

      const {
        semanticColorMap,
        edgeSemanticColorMap,
        edgeSemanticCategoryMap,
        edgeSemanticNameMap,
      } = buildSemanticColorMaps();
      const opts = {
        viewId,
        semanticColorMap,
        edgeSemanticColorMap,
        edgeSemanticCategoryMap,
        edgeSemanticNameMap,
      };

      const seeds = nodeDataToForceSeeds(filtered.nodes, opts);
      const linkSeeds = edgeDataToForceSeeds(filtered.edges, opts);

      const canvas = canvasRef.current;
      const dims = canvas
        ? { width: canvas.width, height: canvas.height }
        : { width: 800, height: 600 };

      await api.initData(seeds, linkSeeds, dims);

      await api.updateStyle(buildForceStyle(view));
      const cfg: ForceConfig = {
        ...DEFAULT_FORCE_CONFIG,
        centerX: dims.width / 2,
        centerY: dims.height / 2,
        boundaryDensity: resolveBoundaryDensity(view),
      };
      await api.updateConfig(cfg);
      await api.setViewport(
        viewportRef.current.x,
        viewportRef.current.y,
        viewportRef.current.scale,
      );
    }, [getDataSnapshot, filter, view, viewId]);

    // ---- Diff subscriber ---------------------------------------------
    // Each diff bucket is filtered through the SAME `filter` predicate
    // that full-sync uses, scoped to just that bucket (e.g. for
    // `nodes.added` we pass `{ nodes: <added>, edges: [], view }`).
    // `removed` is passed through untouched — the worker is the source
    // of truth for "what does it currently know about", so it can
    // decide whether each removed id was actually rendered.
    const subscribeStore = useCallback(() => {
      return subscribeDiff((diff) => {
        try {
          const api = apiRef.current;
          if (!api) return;
          const currentView = viewRef.current;

          const filteredNodesAdded = filter(
            diff.nodes.added,
            [],
            currentView,
          ).nodes;
          const filteredNodesUpdated = filter(
            diff.nodes.updated,
            [],
            currentView,
          ).nodes;

          const endpointIds = collectEdgeEndpointIds(diff);
          const endpointNodes: NodeData[] = [];
          if (endpointIds.size > 0) {
            const snapshot = getDataSnapshot();
            endpointNodes.push(
              ...snapshot.nodes.filter((n) => endpointIds.has(n.id)),
            );
          }
          const filteredEdgesAdded = filter(
            endpointNodes,
            diff.edges.added,
            currentView,
          ).edges;
          const filteredEdgesUpdated = filter(
            endpointNodes,
            diff.edges.updated,
            currentView,
          ).edges;

          const trimmed: SourceDiff = {
            nodes: {
              added: filteredNodesAdded,
              updated: filteredNodesUpdated,
              removed: diff.nodes.removed,
            },
            edges: {
              added: filteredEdgesAdded,
              updated: filteredEdgesUpdated,
              removed: diff.edges.removed,
            },
          };
          const payload = diffToForcePayload(trimmed, {
            viewId,
            ...buildSemanticColorMaps(),
          });
          api.applyDiff(payload).catch((err) => {
            console.error("[ForceGraph] applyDiff failed:", err);
          });

          // ---- Semantic color live-update -------------------------
          // When a NodeSemantic/EdgeSemantic's color changes, the affected
          // nodes/edges need their fillColor/strokeColor updated. Semantic
          // diffs don't produce node/edge diffs, so we handle them here.
          handleSemanticColorUpdate(diff);
        } catch (err) {
          console.error("[ForceGraph] subscribeDiff callback failed:", err);
        }
      });
    }, [
      subscribeDiff,
      getDataSnapshot,
      filter,
      view,
      viewId,
      buildSemanticColorMaps,
    ]);

    // ---- Semantic change handler --------------------------------------
    // NodeSemantic/EdgeSemantic changes don't produce NodeData/EdgeData
    // diffs, so they're handled separately. We find all nodes/edges that
    // reference the changed semanticId, re-transform just those, and push
    // as an upserts-only diff (no simulation restart, no removals).
    // Edge semantics matter for more than color: category drives
    // shape/strokeType and name is the default label.
    const handleSemanticColorUpdate = useCallback(
      (diff: SourceDiff) => {
        const sd = diff.semanticDiffs;
        if (!sd) return;
        const api = apiRef.current;
        if (!api) return;

        const changedNodeSemIds = new Set(
          sd.nodeSemantics.updated
            .filter((s) => s.color !== undefined)
            .map((s) => s.id),
        );
        // Edge semantics contribute color (business layer), category
        // (shape/strokeType) and name (default label), so every updated
        // edge semantic invalidates its referencing edges.
        const changedEdgeSemIds = new Set(
          sd.edgeSemantics.updated.map((s) => s.id),
        );
        if (changedNodeSemIds.size === 0 && changedEdgeSemIds.size === 0)
          return;

        const raw = getDataSnapshot();
        const affectedNodes = raw.nodes.filter(
          (n) => n.semanticId && changedNodeSemIds.has(n.semanticId),
        );
        const affectedEdges = raw.edges.filter(
          (e) => e.semanticId && changedEdgeSemIds.has(e.semanticId),
        );
        if (affectedNodes.length === 0 && affectedEdges.length === 0) return;

        const {
          semanticColorMap,
          edgeSemanticColorMap,
          edgeSemanticCategoryMap,
          edgeSemanticNameMap,
        } = buildSemanticColorMaps();
        const opts = {
          viewId,
          semanticColorMap,
          edgeSemanticColorMap,
          edgeSemanticCategoryMap,
          edgeSemanticNameMap,
        };
        const nodeUpserts = nodeDataToForceSeeds(affectedNodes, opts);
        const linkUpserts = edgeDataToForceSeeds(affectedEdges, opts);

        api.applyDiff({ nodeUpserts, linkUpserts }).catch((err) => {
          console.error("[ForceGraph] semantic color update failed:", err);
        });
      },
      [getDataSnapshot, viewId, buildSemanticColorMaps],
    );

    // ---- Position persistence (sim settled → 3s debounce) ----------
    const persistPositions = useMemo(
      () =>
        debounce((positions: { id: NodeId; x: number; y: number }[]) => {
          const snapshot = getDataSnapshot();
          for (const pos of positions) {
            const node = snapshot.nodes.find((n) => n.id === pos.id);
            if (!node) continue;
            const updated = setPosition(node, viewId, pos.x, pos.y, "force");
            NodeService.upsert(
              pos.id,
              { stateData: updated.stateData ?? { client: {}, server: {} } },
              { debounce: 200 },
            ).catch((err: unknown) => {
              console.error("[ForceGraph] position persist failed:", err);
            });
          }
        }, 3000),
      [getDataSnapshot, viewId],
    );

    // Per main design L229-232 / L365-367, worker events are forwarded
    // straight to the shared event handler, which owns the routing to
    // useUIStore / useGraph().
    const onWorkerEvent = useCallback(
      (event: WorkerEvent) => {
        if (event.type === "selection:changed") {
          if (
            event.selectedNodeIds.length > 0 ||
            event.selectedEdgeIds.length > 0
          ) {
            listenersRef.current?.cancelPan();
          }
        } else if (
          event.type === "node:dblclick" ||
          event.type === "node:drag-start" ||
          event.type === "edge:click"
        ) {
          listenersRef.current?.cancelPan();
        } else if (event.type === "canvas:dblclick") {
          // Double-click on empty canvas → restore the default view:
          // translation back to the origin (the layout is centered there
          // by forceCenter) and zoom back to scale 1.
          listenersRef.current?.cancelPan();
          viewportRef.current = { x: 0, y: 0, scale: 1 };
          apiRef.current?.setViewport(0, 0, 1).catch((err) => {
            console.debug("[ForceGraph] viewport reset failed:", err);
          });
        }

        // Context-menu results: the worker returns the hit-test target
        // with client coordinates, so we can open the menu directly.
        switch (event.type) {
          case "context-menu:node":
            setContextMenuState({
              x: event.clientX,
              y: event.clientY,
              visible: true,
              type: "node",
              context: { nodeId: event.nodeId as string },
              onClose: () => setContextMenuState(null),
            });
            break;
          case "context-menu:edge":
            setContextMenuState({
              x: event.clientX,
              y: event.clientY,
              visible: true,
              type: "edge",
              context: { edgeId: event.edgeId as string },
              onClose: () => setContextMenuState(null),
            });
            break;
          case "context-menu:canvas": {
            const rect = canvasRectRef.current;
            const vp = viewportRef.current;
            const dpr = dprRef.current;
            const sim = rect
              ? screenToSimulation(event.clientX, event.clientY, rect, vp, dpr)
              : { x: event.clientX, y: event.clientY };
            setContextMenuState({
              x: event.clientX,
              y: event.clientY,
              visible: true,
              type: "canvas",
              context: {
                simX: sim.x,
                simY: sim.y,
                viewId: currentViewIdRef.current,
              },
              onClose: () => setContextMenuState(null),
            });
            break;
          }
          case "simulation:stopped":
            persistPositions(event.positions);
            break;
          case "alt-drag:end": {
            closePreviewBlock();
            if (event.targetId === null) {
              setContextMenuState({
                x: event.clientX,
                y: event.clientY,
                visible: true,
                type: "add-edge",
                context: { sourceIds: event.sourceIds, targetId: null },
                onClose: () => setContextMenuState(null),
              });
            } else {
              eventHandler.onAltDragEnd(event).then((edgeId) => {
                closePreviewBlock();
                if (edgeId) {
                  setContextMenuState({
                    x: event.clientX,
                    y: event.clientY,
                    visible: true,
                    type: "edge",
                    context: { edgeId },
                    onClose: () => setContextMenuState(null),
                  });
                }
              });
            }
            break;
          }
        }

        eventHandler.handleWorkerEvent(event);
      },
      [eventHandler, persistPositions],
    );

    // ---- Effect: Worker lifecycle (mount/unmount only) -----------------
    useEffect(() => {
      let cancelled = false;
      let worker: Worker | null = null;
      let api: WorkerInbound | null = null;
      let unsubDiff: (() => void) | null = null;

      (async () => {
        try {
          const result = await setupWorker();
          worker = result.worker;
          api = result.api;

          if (cancelled) {
            worker.terminate();
            return;
          }

          await api.setEventHandler(Comlink.proxy(onWorkerEvent));
          await performFullSync();

          // ★ Re-check cancelled BEFORE subscribing (fixes 0.4 leak)
          if (cancelled) {
            api.setEventHandler(null).catch(() => {});
            worker.terminate();
            return;
          }

          unsubDiff = subscribeStore();
          if (!cancelled) setIsReady(true);
        } catch (err) {
          console.error("[ForceGraph] worker init failed:", err);
          if (!cancelled) setError(err as Error);
        }
      })();

      const domListeners = installDomEventProxy(
        containerRef.current!,
        canvasRectRef,
        viewportRef,
        {
          proxyEvent: (ev) => {
            if (!api) return Promise.resolve();
            return api.proxyEvent(ev).catch((err) => {
              console.debug("[ForceGraph] proxyEvent rejected:", err);
            });
          },
          onViewportChange: (x, y, scale) => {
            // best-effort: rejections during worker teardown races are expected and harmless
            api?.setViewport(x, y, scale).catch(() => {});
          },
        },
        dprRef.current,
      );
      listenersRef.current = domListeners;

      return () => {
        cancelled = true;
        domListeners.dispose();
        listenersRef.current = null;
        if (unsubDiff) unsubDiff();
        try {
          api?.setEventHandler(null);
        } catch {
          // Worker may already be dead.
        }
        worker?.terminate();
        setIsReady(false);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- Effect: view or viewId change triggers re-init ------------
    useEffect(() => {
      const viewIdChanged = currentViewIdRef.current !== viewId;
      currentViewIdRef.current = viewId;
      if (viewIdChanged) {
        performFullSync().catch((err) =>
          console.error("[ForceGraph] re-init on viewId change failed:", err),
        );
      }
      // When the View object identity changes with the same id
      // (e.g. filterConfig edited), performFullSync uses viewRef.current
      // to pick up the latest filter. No additional action needed here
      // since the diff subscriber also reads via viewRef.current.
    }, [viewId, view, performFullSync]);

    // ---- Effect: visualConfig change → push style to worker ----------
    // Background / grid changes must reach the worker without a full
    // re-init (which would restart the simulation and reset positions).
    // `visualConfig` is a fresh object reference whenever the view is
    // replaced by ViewService.upsert, so this fires exactly on edit.
    useEffect(() => {
      const api = apiRef.current;
      if (!api) return;
      api.updateStyle(buildForceStyle(viewRef.current)).catch((err) => {
        console.error("[ForceGraph] updateStyle failed:", err);
      });
    }, [view?.visualConfig]);

    // ---- Effect: node-density change → push config to worker ---------
    // The settings menu's density slider writes `visualConfig`, and the
    // boundary has to move on the running simulation — a full re-init
    // would restart it and throw the layout away. `updateConfig` merges
    // into the worker's cached config and reheats, so dragging the slider
    // previews live. Only the boundary fields are sent: the centre axes
    // are already in the cached config.
    useEffect(() => {
      const api = apiRef.current;
      if (!api) return;
      api
        .updateConfig({
          boundaryDensity: resolveBoundaryDensity(viewRef.current),
        })
        .catch((err) => {
          console.error("[ForceGraph] boundary updateConfig failed:", err);
        });
    }, [view?.visualConfig?.nodeDensity]);

    // ---- Imperative handle ------------------------------------------
    useImperativeHandle(
      ref,
      () => ({
        resync: () => {
          performFullSync().catch((err) =>
            console.error("[ForceGraph] resync failed:", err),
          );
        },
        stop: () => {
          apiRef.current?.stop().catch((err) => {
            console.debug("[ForceGraph] stop failed:", err);
          });
        },
        resume: () => {
          apiRef.current?.resume().catch((err) => {
            console.debug("[ForceGraph] resume failed:", err);
          });
        },
      }),
      [performFullSync],
    );

    // ---- Resize observer --------------------------------------------
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      const ro = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        // Debounce: only apply after the resize stream settles.
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          // IMPORTANT: entry.contentRect.x/y are always 0 (relative to the
          // element's own padding box, NOT the viewport). We must use
          // getBoundingClientRect() for viewport-relative left/top so that
          // screenToSimulation() in eventListener.ts doesn't produce offset
          // coords when the sidebar (or any ancestor) reflows the container.
          const bounds = container.getBoundingClientRect();
          canvasRectRef.current = new DOMRect(
            bounds.left,
            bounds.top,
            entry.contentRect.width,
            entry.contentRect.height,
          );
          const canvas = canvasRef.current;
          if (!canvas) return;
          const dpr = Math.max(1, globalThis.devicePixelRatio ?? 1);
          dprRef.current = dpr;
          const width = Math.max(1, Math.floor(entry.contentRect.width * dpr));
          const height = Math.max(
            1,
            Math.floor(entry.contentRect.height * dpr),
          );
          // Phase 2: canvas.width/height are no longer writable after
          // transferControlToOffscreen. Only CSS sizing remains on the
          // placeholder element; the worker handles renderer resize.
          canvas.style.width = `${entry.contentRect.width}px`;
          canvas.style.height = `${entry.contentRect.height}px`;
          apiRef.current?.setDimensions(width, height).catch((err) => {
            console.debug("[ForceGraph] setDimensions failed:", err);
          });
        }, 150);
      });
      ro.observe(container);
      return () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        ro.disconnect();
      };
    }, []);

    // ---- Dismiss focused preview on outside click --------------------
    // When previewBlock is focused (clicked on a node), clicking
    // anywhere outside the canvas container and the preview itself
    // should dismiss it. Clicks on the canvas are handled by the worker
    // (canvas:click → closePreviewBlock).
    useEffect(() => {
      if (!previewBlock.isFocus) return;
      const handlePointerDown = (e: PointerEvent) => {
        const target = e.target as HTMLElement;
        if (containerRef.current?.contains(target)) return;
        if (target.closest("[data-preview-block]")) return;
        closePreviewBlock();
      };
      document.addEventListener("pointerdown", handlePointerDown);
      return () =>
        document.removeEventListener("pointerdown", handlePointerDown);
    }, [previewBlock.isFocus, closePreviewBlock]);

    // ---- Render ------------------------------------------------------
    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          ...style,
        }}
      >
        <canvas
          data-island-defer-dismiss
          ref={canvasRef}
          style={{
            display: "block",
            cursor: "grab",
            touchAction: "none",
          }}
        />
        {error ? (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              padding: "4px 8px",
              borderRadius: 4,
              background: "rgba(220,38,38,0.9)",
              color: "white",
              fontSize: 12,
            }}
          >
            {translate("Worker init failed:")} {error.message}
          </div>
        ) : null}
        {!isReady && !error ? (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              fontSize: 12,
              color: "#9ca3af",
            }}
          >
            {translate("Initializing…")}{" "}
          </div>
        ) : null}
        {contextMenuState && contextMenuState.visible ? (
          <GraphContextMenu
            {...contextMenuState}
            setContextMenu={setContextMenu}
          />
        ) : null}
        {previewBlock.visible && previewBlock.nodeId ? (
          <PreviewBlock
            nodeId={previewBlock.nodeId}
            containerRef={containerRef}
            visible={previewBlock.visible}
            isFocus={previewBlock.isFocus}
            onClose={closePreviewBlock}
          />
        ) : null}
      </div>
    );
  },
);

// Re-export for downstream type consumers (so the props type can be
// reached as `ForceGraphProps["eventHandler"]`).
export type { EdgeId, NodeId };
