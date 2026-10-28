// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared types for graph.
 *
 * This module is the **only** place where cross-cutting types live:
 *
 *   - `Modifiers` — keyboard modifier flags used by `force/eventListener.ts`
 *     and `eventHandler.ts` (Alt+drag edge creation, etc.).
 *   - `GraphSnapshot` / `SourceDiff` / `DiffCallback` — the data shape
 *     that the parent `Graph` injects into both `ForceGraph` and
 *     `FlowGraph`. Both renderers consume the same shape so the parent
 *     can be renderer-agnostic.
 *   - `Theme` — the global light/dark token enum, applicable to both
 *     rendering modes.
 *
 * Note: the 7-state `UiState` enum is **force-mode private** — it lives
 * in `force/types.ts`. Flow mode does not express UI state; the only
 * selection visual is ReactFlow's built-in `selected` prop.
 *
 * Architectural rule: `force/*` and `flow/*` modules are siblings and
 * **must not** import from each other. Anything both sides need (and
 * anything the shared `eventHandler.ts` / `graph.tsx` / `src/index.ts`
 * needs) lives here. The one exception is the bridge layer
 * (`eventHandler.ts`), which is *allowed* to import `WorkerEvent` from
 * `force/types` because `handleWorkerEvent` is force-specific by design.
 *
 * Cross-document contract: docs/07-agent/graph-v2/src/design.md §3.1,
 * main design L382-384.
 */

// -----------------------------------------------------------------------
// Keyboard modifiers (shared by force + flow + eventHandler)
// -----------------------------------------------------------------------

/** Keyboard modifier flags. Used by `force/eventListener.ts` to forward
 *  ProxiedDomEvent modifiers, and by `eventHandler.ts` for Alt+drag
 *  edge-creation routing. */
export interface Modifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

// -----------------------------------------------------------------------
// Theme
// -----------------------------------------------------------------------

/** Light/dark theme selector. Passed from the host app down to Graph
 *  (and from Graph into ForceGraph as a prop; FlowGraph reads it
 *  indirectly through `view.visualConfig`). */
export type Theme = "light" | "dark";

// -----------------------------------------------------------------------
// Data feed (shared by both renderers)
// -----------------------------------------------------------------------

import type {
  EdgeData,
  EdgeId,
  EdgeSemantic,
  EdgeSemanticId,
  NodeData,
  NodeId,
  NodeSemantic,
  NodeSemanticId,
} from "@workspace/interfaces";

/**
 * Filtered snapshot of the data store at one point in time. Both
 * `ForceGraph` and `FlowGraph` consume this shape (after applying the
 * parent's `filter` callback) and convert to their own internal DTOs
 * (`ForceNodeSeed[]` / `RenderableNode[]`).
 */
export interface GraphSnapshot {
  nodes: NodeData[];
  edges: EdgeData[];
}

/** Re-export of the diff payload shape. Mirrors
 *  `useDataStore.diff` but is renderer-agnostic. */
export interface SourceDiff {
  nodes: {
    added: NodeData[];
    updated: NodeData[];
    removed: NodeId[];
  };
  edges: {
    added: EdgeData[];
    updated: EdgeData[];
    removed: EdgeId[];
  };
  /** Semantic entity diffs — consumed by ForceGraph for color-live-update. */
  semanticDiffs?: {
    nodeSemantics: {
      added: NodeSemantic[];
      updated: NodeSemantic[];
      removed: NodeSemanticId[];
    };
    edgeSemantics: {
      added: EdgeSemantic[];
      updated: EdgeSemantic[];
      removed: EdgeSemanticId[];
    };
  };
}

/**
 * Diff subscriber callback. The parent `Graph` exposes
 * `subscribeDiff(cb)` so the children receive a filtered, normalized
 * diff stream without ever touching `useDataStore` directly.
 */
export type DiffCallback = (diff: SourceDiff) => void;

/**
 * Collect every distinct node id that appears as an `from` or `to`
 * endpoint of any edge in `diff.edges.added` or `diff.edges.updated`.
 * Used to scope the `filter` call for edge evaluation: edges that
 * reference already-existing endpoints (a common case for `added`
 * edges — user picks two existing nodes and creates a new edge
 * between them) would otherwise be silently dropped because the
 * endpoint nodes are absent from `diff.nodes.added`.
 */
export function collectEdgeEndpointIds(diff: SourceDiff): Set<NodeId> {
  const ids = new Set<NodeId>();
  for (const e of diff.edges.added) {
    ids.add(e.from);
    ids.add(e.to);
  }
  for (const e of diff.edges.updated) {
    ids.add(e.from);
    ids.add(e.to);
  }
  return ids;
}
