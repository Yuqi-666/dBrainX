// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";
import { useViewColors } from "@workspace/ui/hooks/use-view-colors";

/**
 * Main `Graph` component for graph.
 *
 * Per main design L379-384 and L384 (the *only* callback the parent
 * injects into its children is the `eventHandler`):
 *
 *   1. Resolves the current `View` (either by `viewId` lookup or via
 *      the `view` prop).
 *   2. Builds the data-feed props (`getDataSnapshot` / `subscribeDiff` /
 *      `filter`) — Graph owns the access to `useDataStore`, the children
 *      never see it.
 *   3. Constructs the shared `eventHandler` via `useGraphEventHandler()`
 *      and injects it as the *single* callback prop.
 *   4. Routes to `ForceGraph` (when `view.viewType === "Force"`) or
 *      `FlowGraph` (when `"Flow"`).
 *
 * The children (ForceGraph / FlowGraph) are intentionally given NO other
 * callback prop — they push every user gesture through
 * `props.eventHandler.xxx`, which internally routes to `useUIStore` and
 * `useGraph()`.
 *
 * Cross-document contract: docs/07-agent/graph-v2/src/design.md §3.1,
 * main design L384, L402, L365-367.
 */

import { useCallback, useMemo } from "react";
import type {
  EdgeData,
  NodeData,
  View,
  ViewId,
  ViewType,
} from "@workspace/interfaces";
import { useDataStore } from "@workspace/store";
import { filterByViewFilterConfig } from "@workspace/utils";
import { ForceGraph } from "./force/ForceGraph";
import { ForceGraphErrorBoundary } from "./force/ForceGraphErrorBoundary";
import { FlowGraph } from "./flow/FlowGraph";
import type { GraphSnapshot, DiffCallback, SourceDiff } from "./types";
import { useGraphEventHandler } from "./eventHandler";

// -----------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------

export interface GraphProps {
  /** Resolve the view by id (mutually exclusive with `view`). */
  viewId?: ViewId;
  /** Pass the view directly (mutually exclusive with `viewId`). */
  view?: View;
  className?: string;
  style?: React.CSSProperties;
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

/**
 * Map `ViewType` to a mode label. (Inlined here so the wrapper can
 * branch without importing the orchestrators' internal types.)
 */
type Mode = "force" | "flow";
const VIEW_TYPE_TO_MODE: Record<ViewType, Mode> = {
  Force: "force",
  Flow: "flow",
};

export function Graph(props: GraphProps) {
  useI18n();

  const { viewId, view: viewProp, className, style } = props;

  // ---- Resolve the view ------------------------------------------
  const views = useDataStore((s) => s.views);
  const storedView: View | undefined = useMemo(() => {
    if (viewProp) return viewProp;
    if (viewId) return views.get(viewId);
    return undefined;
  }, [viewProp, viewId, views]);
  const { backgroundColor, gridColor } = useViewColors(
    storedView?.visualConfig,
  );
  const resolvedView = useMemo(
    () =>
      storedView
        ? {
            ...storedView,
            visualConfig: {
              ...storedView.visualConfig,
              backgroundColor,
              gridColor,
            },
          }
        : undefined,
    [storedView, backgroundColor, gridColor],
  );

  // ---- Snapshot + diff wrappers -----------------------------------
  const getDataSnapshot = useCallback((): GraphSnapshot => {
    const s = useDataStore.getState();
    return {
      nodes: Array.from(s.nodes.values()),
      edges: Array.from(s.edges.values()),
    };
  }, []);

  const filter = useCallback(
    (
      nodes: NodeData[],
      edges: EdgeData[],
      view: View,
    ): { nodes: NodeData[]; edges: EdgeData[] } => {
      if (!view) return { nodes, edges };
      const nodesMap = new Map(nodes.map((n) => [n.id, n]));
      const edgesMap = new Map(edges.map((e) => [e.id, e]));
      const { filteredNodes, filteredEdges } = filterByViewFilterConfig(
        nodesMap,
        edgesMap,
        view,
      );
      return {
        nodes: Array.from(filteredNodes.values()),
        edges: Array.from(filteredEdges.values()),
      };
    },
    [],
  );

  const subscribeDiff = useCallback((cb: DiffCallback) => {
    return useDataStore.subscribe((state) => {
      if (state.isDiffEmpty()) return;
      const d = state.diff;
      const diff: SourceDiff = {
        nodes: d.nodes,
        edges: d.edges,
        semanticDiffs: {
          nodeSemantics: d.nodeSemantics,
          edgeSemantics: d.edgeSemantics,
        },
      };
      cb(diff);
      state.clearDiff();
    });
  }, []);

  // ---- Single shared event handler (the only callback surface) ---
  const eventHandler = useGraphEventHandler();

  // ---- Route by viewType -----------------------------------------
  if (!resolvedView) {
    return (
      <div
        className={className}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          color: "#9ca3af",
          fontSize: 14,
          ...style,
        }}
      >
        {translate("No view selected")}{" "}
      </div>
    );
  }

  const mode = VIEW_TYPE_TO_MODE[resolvedView.viewType];
  const viewIdProp = resolvedView.id;

  if (mode === "flow") {
    return (
      <FlowGraph
        view={resolvedView}
        viewId={viewIdProp}
        getDataSnapshot={getDataSnapshot}
        subscribeDiff={subscribeDiff}
        filter={filter}
        eventHandler={eventHandler}
        className={className}
        style={style}
      />
    );
  }

  return (
    <ForceGraphErrorBoundary>
      <ForceGraph
        view={resolvedView}
        viewId={viewIdProp}
        getDataSnapshot={getDataSnapshot}
        subscribeDiff={subscribeDiff}
        filter={filter}
        eventHandler={eventHandler}
        className={className}
        style={style}
      />
    </ForceGraphErrorBoundary>
  );
}
