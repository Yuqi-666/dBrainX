// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * FlowGraph — placeholder shell for flow mode.
 *
 * The original ReactFlow-based implementation was removed in the flow
 * refactor. This component intentionally preserves the EXACT
 * `FlowGraphProps` contract that `src/graph.tsx` injects, so the router
 * and the event-handler surface stay intact while flow mode is rebuilt.
 *
 * Deliberately minimal:
 *   - No ReactFlow, no data pipeline, no position/viewport persistence.
 *   - No node/edge registries, no transforms, no services.
 *   - Renders a static placeholder and accepts (and ignores) the data-feed
 *     props so callers compile unchanged.
 *
 * When flow mode is re-implemented, start from this file and restore the
 * original responsibilities documented in the git history:
 *   - data pipeline (snapshot → filter → renderable nodes/edges)
 *   - coordinate + viewport persistence
 *   - edge creation / selection sync via `eventHandler`
 */

import type { EdgeData, NodeData, View, ViewId } from "@workspace/interfaces";
import type { GraphSnapshot, DiffCallback } from "../types";
import type { GraphEventHandler } from "../eventHandler";

// -----------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------

export interface FlowGraphProps {
  view: View;
  viewId: ViewId;
  getDataSnapshot: () => GraphSnapshot;
  subscribeDiff: (cb: DiffCallback) => () => void;
  filter: (
    nodes: NodeData[],
    edges: EdgeData[],
    view: View,
  ) => { nodes: NodeData[]; edges: EdgeData[] };
  /**
   * The single callback surface. FlowGraph never touches `useUIStore`
   * directly and never calls any of the `useGraph()` callbacks directly —
   * every gesture is routed through here.
   */
  eventHandler: GraphEventHandler;
  className?: string;
  style?: React.CSSProperties;
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export function FlowGraph(props: FlowGraphProps) {
  useI18n();

  const { className, style } = props;

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
      {translate("Flow mode is under reconstruction")}{" "}
    </div>
  );
}
