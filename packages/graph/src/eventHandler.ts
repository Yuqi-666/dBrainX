// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * Shared event handler for graph.
 *
 * Per main design L40 / L102 / L365-367, the *only* callback that
 * `ForceGraph` and `FlowGraph` receive is this `eventHandler`. It is the
 * single entry point through which user gestures (worker events in force
 * mode, ReactFlow callbacks in flow mode) are routed to side effects.
 *
 * The orchestrators never touch `useUIStore` directly and never call any
 * of the 11 `useGraph()` callbacks directly — they package the gesture +
 * its context and hand it to one of the `eventHandler.xxx` methods. The
 * event handler internally decides what to do:
 *
 *   - mutate `useUIStore` (selection, preview block, context menu, ...)
 *   - delegate to a `useGraph()` callback (edit node, create edge, ...)
 *   - or both
 *
 * Cross-document contract: docs/07-agent/graph-v2/src/design.md §3.1,
 * main design L384, L402, L365-367.
 */

import { useEffect, useMemo, useRef } from "react";
import type { EdgeId, NodeId } from "@workspace/interfaces";
import { useUIStore } from "@workspace/store";
import type { WorkerEvent } from "./force/types";
import { useGraph } from "@workspace/hooks";

// -----------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------

/**
 * The single callback surface that every orchestrator (ForceGraph,
 * FlowGraph) receives. Each method corresponds to one user gesture and
 * carries the minimum context the handler needs to do its job.
 *
 * The handler is intentionally a *flat namespace of imperative methods*
 * rather than a single `dispatch(event)` entry point. This keeps the
 * orchestrators' call sites self-documenting (e.g. `eventHandler.onNodeDoubleClick(id)`
 * reads better than `eventHandler.dispatch({ type: 'node:dblclick', nodeId: id })`).
 */
export interface GraphEventHandler {
  /**
   * Force-mode entry point: receive a `WorkerEvent` straight from the
   * Comlink proxy and let the handler decide what (if anything) to do.
   */
  handleWorkerEvent(event: WorkerEvent): void;

  // ---- Selection -----------------------------------------------------

  /** Single node click → select only this node. */
  onSelectNode(nodeId: NodeId): void;
  /** Single edge click → select only this edge. */
  onSelectEdge(edgeId: EdgeId): void;
  /**
   * Multi-selection sync (ReactFlow `onSelectionChange`). Replaces both
   * `selectedNodeIds` and `selectedEdgeIds` with the given sets.
   */
  onSelectMany(args: { nodes: NodeId[]; edges: EdgeId[] }): void;
  /** Clear every selection (canvas click, lasso empty, etc). */
  onClearSelection(): void;

  // ---- Node gestures -------------------------------------------------

  /** Node double click → close preview, open editor. */
  onNodeDoubleClick(nodeId: NodeId): void;
  /**
   * Pointer enters a node (150ms debounce on caller side).
   * Show non-focused preview block.
   */
  onNodePointerEnter(nodeId: NodeId): void;
  /** Pointer leaves a node. Close preview unless it is focused. */
  onNodePointerLeave(): void;
  /** Drag started — close preview block (per main design L80). */
  onNodeDragStart(): void;

  // ---- Canvas gestures -----------------------------------------------

  /** Click on the empty canvas — clear selection + close overlays. */
  onCanvasClick(): void;
  /** ReactFlow `onPaneClick`. Same as `onCanvasClick`. */
  onPaneClick(): void;

  // ---- Alt-drag edge creation (force mode only) ----------------------

  /**
   * User starts Alt+drag from one or more source nodes. `targetId` is
   * the current hover target (or null when hovering empty canvas).
   */
  onAltDragUpdate(args: {
    sourceIds: NodeId[];
    targetId: NodeId | null;
    clientX: number;
    clientY: number;
  }): void;
  /**
   * User releases Alt+drag. `targetId === null` means release on empty
   * canvas (cancelled, main design L139).
   */
  onAltDragEnd(args: {
    sourceIds: NodeId[];
    targetId: NodeId | null;
    clientX: number;
    clientY: number;
  }): Promise<EdgeId | null>;
}

// -----------------------------------------------------------------------
// Bridge implementation (closes over useUIStore + useGraph())
// -----------------------------------------------------------------------

/**
 * Build a `GraphEventHandler` bound to the current `useUIStore` and
 * `useGraph()`. The returned object is stable across renders thanks to
 * `useRef` of the underlying handler set + a single `useMemo`.
 *
 * Per main design L384 ("将 event handler 传递给 Force Graph 和 Flow
 * Graph 的 Callback"), this is the *only* callback the parent `Graph`
 * injects into its children.
 */
export function useGraphEventHandler(): GraphEventHandler {
  const ui = useUIStore.getState();
  const graph = useGraph();

  // Cache the stable UI setters we use most often. The `getState()` call
  // above gives us the current values; for stable references across
  // re-renders we need refs.
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const graphRef = useRef(graph);
  graphRef.current = graph;

  const pendingPreview = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const cancel = () => {
      if (pendingPreview.current !== null) clearTimeout(pendingPreview.current);
      pendingPreview.current = null;
    };
    const unsubscribe = useUIStore.subscribe((state, previous) => {
      if (
        state.islandPanel !== previous.islandPanel ||
        state.currentEditingNodeId !== previous.currentEditingNodeId
      )
        cancel();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancel();
      unsubscribe();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return useMemo<GraphEventHandler>(() => {
    const set = (
      mutator: (s: ReturnType<typeof useUIStore.getState>) => void,
    ) => mutator(useUIStore.getState());

    const cancelPreview = () => {
      if (pendingPreview.current !== null) clearTimeout(pendingPreview.current);
      pendingPreview.current = null;
    };
    const closePreview = () => {
      cancelPreview();
      set((s) => {
        s.closePreviewBlock();
        if (s.islandPanel !== "idle") s.collapseIsland();
      });
    };
    const previewAfterClick = (nodeId: NodeId) => {
      cancelPreview();
      const before = useUIStore.getState();
      before.closePreviewBlock();
      // A worker click can arrive after double-click opened the editor.
      // Cancelling an existing timer alone cannot prevent it re-arming.
      if (before.currentEditingNodeId !== null) return;
      const panelBeforeClick = before.islandPanel;
      // Worker recognises double-clicks within 300ms of the first press.
      // Starting this delay on release also covers a held first click.
      pendingPreview.current = setTimeout(() => {
        pendingPreview.current = null;
        const state = useUIStore.getState();
        if (
          state.currentEditingNodeId === null &&
          state.islandPanel === panelBeforeClick &&
          state.selectedNodeIds.size === 1 &&
          state.selectedNodeIds.has(nodeId) &&
          state.selectedEdgeIds.size === 0
        ) {
          state.openIslandPreview(nodeId);
        }
      }, 320);
    };

    const handleAltDragUpdate = (args: {
      sourceIds: NodeId[];
      targetId: NodeId | null;
    }): void => {
      const targetId = args.targetId;
      closePreview();
      set((s) => {
        if (targetId !== null) {
          s.setSelectedNodeIds(new Set([targetId]));
        } else {
          s.setSelectedNodeIds(new Set(args.sourceIds));
        }
      });
    };

    const handleAltDragEnd = async (args: {
      sourceIds: NodeId[];
      targetId: NodeId | null;
      clientX: number;
      clientY: number;
    }): Promise<EdgeId | null> => {
      if (args.targetId === null) return null;
      return graphRef.current.onCreateEdge(
        args.sourceIds,
        args.targetId,
        args.clientX,
        args.clientY,
        () => {},
      );
    };

    return {
      handleWorkerEvent(event) {
        switch (event.type) {
          case "node:click":
            previewAfterClick(event.nodeId);
            return;
          case "node:dblclick":
            closePreview();
            set((s) => {
              s.closePreviewBlock();
              s.handleNodeEdit(event.nodeId);
            });
            return;
          case "node:pointer-enter":
            // Don't replace a focused preview with a mere hover.
            set((s) => {
              if (!s.previewBlock.isFocus) {
                s.setPreviewBlock({
                  nodeId: event.nodeId,
                  visible: true,
                  isFocus: false,
                });
              }
            });
            return;
          case "node:pointer-leave":
            set((s) => {
              if (!s.previewBlock.isFocus) s.closePreviewBlock();
            });
            return;
          case "node:drag-start":
            closePreview();
            return;
          case "edge:click":
            closePreview();
            set((s) => {
              s.setSelectedEdgeIds(new Set([event.edgeId]));
              s.closePreviewBlock();
            });
            return;
          // Context-menu results (selection only — menu is opened
          // by ForceGraph's onWorkerEvent from the same event).
          case "context-menu:node":
            closePreview();
            set((s) => {
              s.setSelectedNodeIds(new Set([event.nodeId]));
              s.closePreviewBlock();
            });
            return;
          case "context-menu:edge":
            closePreview();
            set((s) => {
              s.setSelectedEdgeIds(new Set([event.edgeId]));
              s.closePreviewBlock();
            });
            return;
          case "context-menu:canvas":
            closePreview();
            set((s) => {
              s.setSelectedNodeIds(new Set());
              s.setSelectedEdgeIds(new Set());
            });
            return;
          case "canvas:click":
            closePreview();
            set((s) => {
              s.setSelectedNodeIds(new Set());
              s.setSelectedEdgeIds(new Set());
              s.closePreviewBlock();
            });
            return;
          case "selection:changed":
            set((s) => {
              s.setSelectedNodeIds(new Set(event.selectedNodeIds));
              s.setSelectedEdgeIds(new Set(event.selectedEdgeIds));
              // Selection stays immediate; only a confirmed click opens preview.
              cancelPreview();
              if (
                event.selectedNodeIds.length !== 1 ||
                event.selectedEdgeIds.length !== 0
              ) {
                closePreview();
              }
            });
            return;
          // The graph owns outside dismissal until the worker hit-test resolves.
          case "canvas:pointer-down":
          case "canvas:dblclick":
            closePreview();
            return;
          // Pure noise / informational events — nothing to do.
          case "frame":
          case "tick":
          case "status":
          case "simulation:stopped":
          case "canvas:pointer-move":
          case "canvas:pointer-up":
          case "canvas:wheel":
          case "node:drag":
          case "node:drag-end":
            return;
          case "alt-drag:update":
            handleAltDragUpdate(event);
            return;
          case "alt-drag:end":
            return;
          default: {
            const _exhaustive: never = event;
            void _exhaustive;
          }
        }
      },

      onSelectNode(nodeId) {
        set((s) => s.setSelectedNodeIds(new Set([nodeId])));
        previewAfterClick(nodeId);
      },

      onSelectEdge(edgeId) {
        closePreview();
        set((s) => {
          s.setSelectedEdgeIds(new Set([edgeId]));
          s.closePreviewBlock();
        });
      },

      onSelectMany({ nodes, edges }) {
        closePreview();
        set((s) => {
          s.setSelectedNodeIds(new Set(nodes));
          s.setSelectedEdgeIds(new Set(edges));
        });
      },

      onClearSelection() {
        closePreview();
        set((s) => {
          s.setSelectedNodeIds(new Set());
          s.setSelectedEdgeIds(new Set());
        });
      },

      onNodeDoubleClick(nodeId) {
        closePreview();
        set((s) => {
          s.closePreviewBlock();
          s.handleNodeEdit(nodeId);
        });
      },

      onNodePointerEnter(nodeId) {
        // Don't replace a focused preview with a mere hover.
        set((s) => {
          if (!s.previewBlock.isFocus) {
            s.setPreviewBlock({
              nodeId,
              visible: true,
              isFocus: false,
            });
          }
        });
      },

      onNodePointerLeave() {
        // Caller (ForceGraph) is responsible for the "don't close if
        // already focused" check — we just provide the close primitive.
        set((s) => s.closePreviewBlock());
      },

      onNodeDragStart() {
        closePreview();
      },

      onCanvasClick() {
        closePreview();
        set((s) => {
          s.setSelectedNodeIds(new Set());
          s.setSelectedEdgeIds(new Set());
          s.closePreviewBlock();
        });
      },

      onPaneClick() {
        closePreview();
        // ReactFlow's onPaneClick and our own onCanvasClick do the
        // same thing: clear all transient UI.
        set((s) => {
          s.setSelectedNodeIds(new Set());
          s.setSelectedEdgeIds(new Set());
          s.closePreviewBlock();
        });
      },

      onAltDragUpdate(args) {
        handleAltDragUpdate({
          sourceIds: args.sourceIds,
          targetId: args.targetId,
        });
      },

      onAltDragEnd(args) {
        return handleAltDragEnd(args);
      },
    };
  }, []);
}
