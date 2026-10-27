// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Force mode: source data → d3-force seed conversion.
 *
 * Merge order (lower → higher priority):
 *   defaults → business(stateData.server + semantic) → client(stateData.client) → worker(render)
 *
 * Layers 1–3 are resolved here. Layer 4 (render rules) is applied at paint
 * time in canvas.ts — it never changes the seed data.
 */

import type {
  EdgeClientStyle,
  EdgeData,
  EdgeSemanticId,
  EdgeType,
  NodeClientStyle,
  NodeData,
  NodeSemanticId,
  PositionEntry,
  PositionMode,
  ViewId,
} from "@workspace/interfaces";
import type { SourceDiff } from "../types";
import type { ForceLinkSeed, ForceNodeSeed } from "./types";
import {
  NODE_DEFAULTS,
  EDGE_DEFAULTS,
  NODE_BUSINESS_RULES,
  EDGE_BUSINESS_RULES,
  resolveBusinessStyle,
} from "./styleConfig";

// -----------------------------------------------------------------------
// Position persistence helpers
// -----------------------------------------------------------------------

export function getPosition(
  node: NodeData,
  viewId: ViewId,
  mode: PositionMode,
): { x: number; y: number } | null {
  const entry = node.stateData?.client?.position?.find(
    (p) => p.viewId === viewId && p.mode === mode,
  );
  if (!entry) return null;
  if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y)) return null;
  return { x: entry.x, y: entry.y };
}

export function setPosition(
  node: NodeData,
  viewId: ViewId,
  x: number,
  y: number,
  mode: PositionMode,
): NodeData {
  const client = node.stateData?.client ?? {};
  const server = node.stateData?.server ?? {};
  const positionMap = client.position ?? [];
  const existingIndex = positionMap.findIndex(
    (p) => p.viewId === viewId && p.mode === mode,
  );
  const newEntry: PositionEntry = { viewId, x, y, mode };
  const newPositionMap =
    existingIndex >= 0
      ? positionMap.map((p, i) => (i === existingIndex ? newEntry : p))
      : [...positionMap, newEntry];

  return {
    ...node,
    stateData: {
      client: { ...client, position: newPositionMap },
      server,
    },
  };
}

// -----------------------------------------------------------------------
// EdgeType → shape / strokeType mappings
// -----------------------------------------------------------------------

const EDGE_TYPE_TO_SHAPE: Record<EdgeType, ForceLinkSeed["shape"]> = {
  hierarchy: "straight",
  association: "straight",
  flow: "curve",
  interaction: "s-curve",
};

const EDGE_TYPE_TO_STROKE_TYPE: Record<EdgeType, ForceLinkSeed["strokeType"]> = {
  association: "dashed",
  hierarchy: "solid",
  flow: "solid",
  interaction: "solid",
};

// -----------------------------------------------------------------------
// Transform options
// -----------------------------------------------------------------------

export interface TransformOptions {
  viewId: ViewId;
  /** External joined data: NodeSemantic.id → color. Applied at business layer. */
  semanticColorMap?: Map<NodeSemanticId, string>;
  /** External joined data: EdgeSemantic.id → color. Applied at business layer. */
  edgeSemanticColorMap?: Map<EdgeSemanticId, string>;
  /** External joined data: EdgeSemantic.id → category. Drives shape/strokeType. */
  edgeSemanticCategoryMap?: Map<EdgeSemanticId, EdgeType>;
  /**
   * External joined data: EdgeSemantic.id → name. Business layer fallback
   * for the edge label when `stateData.server.label` is absent.
   */
  edgeSemanticNameMap?: Map<EdgeSemanticId, string>;
}

// -----------------------------------------------------------------------
// Node conversion
// -----------------------------------------------------------------------

/**
 * Convert `NodeData[]` → `ForceNodeSeed[]`.
 *
 * Per-node merge pipeline (later wins):
 *   1. NODE_DEFAULTS
 *   2. stateData.server → resolveBusinessStyle() via NODE_BUSINESS_RULES
 *   3. semanticColorMap[semanticId] → fillColor (external joined data)
 *   4. stateData.client.style → overrides (explicit display)
 *
 * The resolved shape is `Required<NodeClientStyle>` — by the time the seed
 * is built every visual property is present.
 */
export function nodeDataToForceSeeds(
  nodes: ReadonlyArray<NodeData>,
  options: TransformOptions,
): ForceNodeSeed[] {
  return nodes.map((node) => {
    // Layer 1 + 2: defaults → business(stateData.server) → semantic.color
    let resolved: Required<NodeClientStyle> = resolveBusinessStyle(
      node.stateData?.server,
      NODE_BUSINESS_RULES,
      { ...NODE_DEFAULTS },
    );

    // Layer 2b: business — semantic.color (external joined data)
    if (node.semanticId && options.semanticColorMap) {
      const semanticColor = options.semanticColorMap.get(node.semanticId);
      if (semanticColor) resolved = { ...resolved, fillColor: semanticColor };
    }

    // Layer 3: client.style — explicit display overrides (highest priority before worker)
    const clientStyle = node.stateData?.client?.style;
    if (clientStyle) Object.assign(resolved, clientStyle);

    const seed: ForceNodeSeed = {
      id: node.id,
      fillColor: resolved.fillColor,
      strokeColor: resolved.strokeColor,
      strokeWidth: resolved.strokeWidth,
      label: node.title,
      labelColor: resolved.labelColor,
      labelSize: resolved.labelSize,
      radius: node.stateData?.server?.weight ?? resolved.radius,
      nodeType: node.nodeType,
      viewId: options.viewId,
    };

    const persisted = getPosition(node, options.viewId, "force");
    if (persisted) {
      seed.x = persisted.x;
      seed.y = persisted.y;
    }

    return seed;
  });
}

// -----------------------------------------------------------------------
// Edge conversion
// -----------------------------------------------------------------------

/**
 * Convert `EdgeData[]` → `ForceLinkSeed[]`.
 *
 * Per-edge merge pipeline (later wins):
 *   1. EDGE_DEFAULTS + category → shape/strokeType
 *   2. stateData.server → resolveBusinessStyle() via EDGE_BUSINESS_RULES
 *   3. edgeSemanticColorMap[semanticId] → strokeColor (external joined data)
 *   4. stateData.client.style → overrides (explicit display)
 *
 * The label falls back to `edgeSemanticNameMap[semanticId]`
 * (`EdgeSemantic.name`) when `stateData.server.label` is absent.
 */
export function edgeDataToForceSeeds(
  edges: ReadonlyArray<EdgeData>,
  options?: TransformOptions,
): ForceLinkSeed[] {
  return edges.map((edge) => {
    const category: EdgeType = edge.semanticId
      ? (options?.edgeSemanticCategoryMap?.get(edge.semanticId) ?? "association")
      : "association";

    // Layer 1: defaults + category-driven shape/strokeType
    let resolved: Required<EdgeClientStyle> = resolveBusinessStyle(
      edge.stateData?.server,
      EDGE_BUSINESS_RULES,
      {
        ...EDGE_DEFAULTS,
        shape: EDGE_TYPE_TO_SHAPE[category],
        strokeType: EDGE_TYPE_TO_STROKE_TYPE[category],
      },
    );

    // Layer 2: business — semantic.color (external joined data)
    if (edge.semanticId && options?.edgeSemanticColorMap) {
      const semanticColor = options.edgeSemanticColorMap.get(edge.semanticId);
      if (semanticColor) resolved = { ...resolved, strokeColor: semanticColor };
    }

    // Layer 3: client.style — explicit display overrides
    const clientStyle = edge.stateData?.client?.style;
    if (clientStyle) Object.assign(resolved, clientStyle);

    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label:
        edge.stateData?.server?.label ??
        (edge.semanticId
          ? options?.edgeSemanticNameMap?.get(edge.semanticId)
          : undefined) ??
        "",
      labelColor: resolved.labelColor,
      labelSize: resolved.labelSize,
      shape: resolved.shape,
      strokeType: resolved.strokeType,
      strokeColor: resolved.strokeColor,
      strokeWidth: resolved.strokeWidth,
      direction: edge.direction,
      weight: edge.stateData?.server?.weight,
    };
  });
}

// -----------------------------------------------------------------------
// Single-seed helpers (diff)
// -----------------------------------------------------------------------

export function singleNodeToForceSeed(
  node: NodeData,
  options: TransformOptions,
): ForceNodeSeed {
  return nodeDataToForceSeeds([node], options)[0]!;
}

export function singleEdgeToForceSeed(
  edge: EdgeData,
): ForceLinkSeed {
  return edgeDataToForceSeeds([edge])[0]!;
}

// -----------------------------------------------------------------------
// Diff extraction
// -----------------------------------------------------------------------

export function diffToForcePayload(
  diff: SourceDiff,
  options: TransformOptions,
): import("./types").ForceDiffPayload {
  const upsertedNodes = [...diff.nodes.added, ...diff.nodes.updated];
  const nodeUpserts = nodeDataToForceSeeds(upsertedNodes, options);
  const nodeRemovals = diff.nodes.removed;

  const upsertedEdges = [...diff.edges.added, ...diff.edges.updated];
  const linkUpserts = edgeDataToForceSeeds(upsertedEdges, options);
  const linkRemovals = diff.edges.removed;

  return { nodeUpserts, nodeRemovals, linkUpserts, linkRemovals };
}
