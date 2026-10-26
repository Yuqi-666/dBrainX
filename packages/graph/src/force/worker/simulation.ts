// SPDX-License-Identifier: AGPL-3.0-only

/**
 * d3-force simulation core (runs inside the WebWorker).
 *
 * Owns:
 *   - The `d3.Simulation` instance.
 *   - The internal node / link arrays (with d3-mutated `x`, `y`, `vx`,
 *     `vy`, `fx`, `fy`, `index` fields).
 *   - The internal selection / hover state used to compute the 7-state
 *     `UiState` for each node on every render frame.
 *   - Hit-testing (linear for n<2000, d3-quadtree for n>=2000, per
 *     worker/design.md §6.2).
 *
 * Cross-document contract: worker/design.md §3.1, §4 (forces), §6 (hit-test),
 * §7.2 (UI state mirror).
 *
 * NOTE: this file has zero DOM access. The only browser API it touches is
 * the `OffscreenCanvas` (held in `canvas.ts`) and `postMessage` (called by
 * `force.worker.ts`).
 */

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceCenter,
  type Force,
  type Simulation,
} from "d3-force";
import { quadtree, type Quadtree } from "d3-quadtree";
import type { EdgeId, NodeId } from "@workspace/interfaces";
import type {
  ForceConfig,
  ForceLinkSeed,
  ForceNodeSeed,
  ProxiedDomEvent,
} from "../types";
import type { RenderState } from "../types";
import { DEFAULT_FORCE_CONFIG } from "../styleConfig";
import {
  DEFAULT_NODE_RADIUS,
  pointToCubicCurve,
  pointToQuadraticCurve,
  pointToSegment,
  resolveEdgeGeometry,
} from "./edgeGeometry";

// -----------------------------------------------------------------------
// Internal mutable types (d3 mutates these in-place)
// -----------------------------------------------------------------------

/**
 * The d3 `SimulationNodeDatum` declares `fx` / `fy` as `number | null`.
 * `ForceNodeSeed` declares them as optional `number | undefined`. We
 * unify on `number | null` to satisfy d3's typing while still allowing
 * callers to omit them (omitted = `undefined` → we coerce to `null`).
 */
type PinCoord = number | null;

export interface SimNode extends Omit<ForceNodeSeed, "fx" | "fy"> {
  x?: number;
  y?: number;
  fx?: PinCoord;
  fy?: PinCoord;
  vx?: number;
  vy?: number;
  index?: number;
  /** Cached label text (truncated for canvas). */
  __label?: string;
  /** Worker-internal interaction state for render rules. */
  renderState?: RenderState;
}

export interface SimLink extends Omit<ForceLinkSeed, "source" | "target"> {
  source: SimNode;
  target: SimNode;
  index?: number;
  renderState?: RenderState;
}

// -----------------------------------------------------------------------
// Internal state
// -----------------------------------------------------------------------

let sim: Simulation<SimNode, SimLink> | null = null;
let nodes: SimNode[] = [];
let links: SimLink[] = [];
let nodeMap: Map<NodeId, SimNode> = new Map();
/** Module-level index: EdgeId → SimLink. Always kept in sync with the `links` array. */
let linkMap: Map<EdgeId, SimLink> = new Map();
let qt: Quadtree<SimNode> | null = null;

/** Tick counter for throttled quadtree rebuild. */
let tickCount = 0;

/** Cached simulation config — kept so we can rebuild forces after diff. */
let currentConfig: ForceConfig = { ...DEFAULT_FORCE_CONFIG };
let currentDims = { width: 800, height: 600 };

/** Hover / selection state. The worker owns these (main thread pushes them
 *  in via `setNodeFixed` / `setSelectionState`, see `api.ts`). */
let selectedNodeIds: Set<NodeId> = new Set();
let selectedEdgeIds: Set<EdgeId> = new Set();
let hoveredNodeId: NodeId | null = null;
let neighborNodeIds: Set<NodeId> = new Set();

/** Multi-select drag offsets (FIX 1.2). */
const dragOffsets = new Map<NodeId, { ox: number; oy: number }>();

/** Click-vs-drag distinction: drag only starts after 3 sim-px movement. */
let dragMoved = false;
let dragStarted = false;
let dragStartX = 0;
let dragStartY = 0;

/** Double-click detection (FIX 1.4). */
let lastClickTime = 0;
let lastClickNode: NodeId | null = null;
let pressedNodeId: NodeId | null = null;
/**
 * Double-click on empty canvas → the main thread resets the viewport
 * (center + default scale). Tracked separately from node double-clicks so
 * the two gestures never collide.
 */
let lastCanvasClickTime = 0;

/** Alt-drag edge-creation state (drives the assist-edge render + event emission). */
interface AltDragAssistState {
  active: boolean;
  sourceIds: NodeId[];
  targetId: NodeId | null;
  assistPoint: { x: number; y: number };
}
let altDragAssist: AltDragAssistState = {
  active: false,
  sourceIds: [],
  targetId: null,
  assistPoint: { x: 0, y: 0 },
};

/** Listeners that get fired on every `tick`. */
let tickListeners: Array<(alpha: number) => void> = [];

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** Update the internal `ui` for every node based on hover / selection. */
function recomputeWorkerState(): void {
  const hasSelection = selectedNodeIds.size > 0 || selectedEdgeIds.size > 0;
  for (const node of nodes) {
    const isSelected = selectedNodeIds.has(node.id);
    const isHovered = hoveredNodeId === node.id;
    if (isSelected && isHovered) node.renderState = "active";
    else if (isSelected) node.renderState = "selected";
    else if (isHovered) node.renderState = "hover";
    else if (neighborNodeIds.has(node.id)) node.renderState = "neighbor";
    else if (hasSelection) node.renderState = "inactive";
    else node.renderState = "default";
  }
  for (const link of links) {
    const isEdgeSelected = selectedEdgeIds.has(link.id);
    if (isEdgeSelected) {
      link.renderState = "selected";
    } else {
      const srcSel = selectedNodeIds.has(link.source.id);
      const tgtSel = selectedNodeIds.has(link.target.id);
      if (srcSel && tgtSel) link.renderState = "selected";
      else if (srcSel || tgtSel) link.renderState = "neighbor";
      else if (hasSelection) link.renderState = "inactive";
      else link.renderState = "default";
    }
  }
}

/** Compute the 1-degree neighbor set for the currently selected nodes. */
function recomputeNeighbors(): void {
  neighborNodeIds = new Set();
  if (selectedNodeIds.size === 0) return;
  for (const link of links) {
    if (selectedNodeIds.has(link.source.id)) {
      neighborNodeIds.add(link.target.id);
    }
    if (selectedNodeIds.has(link.target.id)) {
      neighborNodeIds.add(link.source.id);
    }
  }
  // Selected nodes themselves are not their own neighbors.
  for (const id of selectedNodeIds) neighborNodeIds.delete(id);
}

function rebuildQuadtree(): void {
  if (nodes.length < 2000) {
    qt = null;
    return;
  }
  qt = quadtree<SimNode>()
    .x((d) => d.x ?? 0)
    .y((d) => d.y ?? 0)
    .addAll(nodes);
}

// -----------------------------------------------------------------------
// Boundary (soft circular wall)
// -----------------------------------------------------------------------

/**
 * Soft circular wall around the layout centre.
 *
 * Two rules, nothing else:
 *   1. `radius = sqrt(nodeCount / density)` when no explicit radius is
 *      set; an explicit radius holds one frame regardless of node count.
 *      It never looks at positions, so it cannot chase a node and needs
 *      no connectivity analysis;
 *   2. a node outside the boundary feels a spring anchored at it,
 *      `v += -r̂ * strength * (r - radius) * alpha`. Inside the boundary
 *      the force is exactly zero.
 *
 * The force fades to zero at the boundary, so a caught node returns
 * monotonically and parks just outside it instead of overshooting or
 * orbiting (d3's `forceRadial` is not usable here: it pushes a node that
 * is inside the radius back out).
 */
function createBoundaryForce(
  centerX: number,
  centerY: number,
  strength: number,
  density: number,
  fixedRadius?: number,
): Force<SimNode, SimLink> {
  return (alpha: number): void => {
    const radius =
      fixedRadius != null && fixedRadius > 0
        ? fixedRadius
        : density > 0
          ? Math.sqrt(nodes.length / density)
          : 0;
    if (strength <= 0 || !(radius > 0) || nodes.length === 0) return;
    const radius2 = radius * radius;

    for (const node of nodes) {
      const dx = (node.x ?? 0) - centerX;
      const dy = (node.y ?? 0) - centerY;
      const d2 = dx * dx + dy * dy;
      // Only a node outside the boundary pays for the sqrt.
      if (d2 <= radius2 || d2 === 0) continue;
      const r = Math.sqrt(d2);
      const pull = (strength * (r - radius) * alpha) / r;
      node.vx = (node.vx ?? 0) - dx * pull;
      node.vy = (node.vy ?? 0) - dy * pull;
    }
  };
}

function applyConfig(forceCfg: ForceConfig): void {
  if (!sim) return;
  const cfg = { ...DEFAULT_FORCE_CONFIG, ...forceCfg };
  currentConfig = cfg;

  const centerX = cfg.centerX ?? currentDims.width / 2;
  const centerY = cfg.centerY ?? currentDims.height / 2;

  sim
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(cfg.linkDistance ?? DEFAULT_FORCE_CONFIG.linkDistance),
    )
    .force(
      "charge",
      forceManyBody().strength(cfg.strength ?? DEFAULT_FORCE_CONFIG.strength),
    )
    .force(
      "collide",
      forceCollide<SimNode>().radius(
        (d) => d.radius + (cfg.collisionRadius != null
          ? cfg.collisionRadius - 8
          : DEFAULT_FORCE_CONFIG.collisionRadius - 8),
      ),
    )
    .force("center", forceCenter(centerX, centerY))
    .force(
      "boundary",
      createBoundaryForce(
        centerX,
        centerY,
        cfg.boundaryStrength ?? DEFAULT_FORCE_CONFIG.boundaryStrength,
        cfg.boundaryDensity ?? DEFAULT_FORCE_CONFIG.boundaryDensity,
        cfg.boundaryRadius,
      ),
    )
    .alphaMin(cfg.alphaMin ?? DEFAULT_FORCE_CONFIG.alphaMin)
    .alphaDecay(cfg.alphaDecay ?? DEFAULT_FORCE_CONFIG.alphaDecay)
    .velocityDecay(
      cfg.velocityDecay ?? DEFAULT_FORCE_CONFIG.velocityDecay,
    );
}

// -----------------------------------------------------------------------
// Public lifecycle
// -----------------------------------------------------------------------

/**
 * Initialize / reset the simulation with a fresh dataset. Hot-reload of
 * d3-force: we mutate the existing node/link arrays in place where
 * possible, otherwise re-create the simulation.
 */
export function createOrUpdate(
  seeds: ForceNodeSeed[],
  linkSeeds: ForceLinkSeed[],
  dims: { width: number; height: number },
): void {
  currentDims = dims;

  // Build (or merge) the internal node list.
  const seedById = new Map<NodeId, ForceNodeSeed>();
  for (const seed of seeds) seedById.set(seed.id, seed);

  // Remove nodes that no longer exist in the seed set.
  nodes = nodes.filter((n) => seedById.has(n.id));

  // Upsert nodes.
  const nodeById = new Map<NodeId, SimNode>();
  for (const existing of nodes) nodeById.set(existing.id, existing);

  const next: SimNode[] = [];
  for (const seed of seeds) {
    const existing = nodeById.get(seed.id);
    if (existing) {
      // Update mutable fields in place.
      existing.label = seed.label;
      existing.fillColor = seed.fillColor;
      existing.strokeColor = seed.strokeColor;
      existing.strokeWidth = seed.strokeWidth;
      existing.labelColor = seed.labelColor;
      existing.labelSize = seed.labelSize;
      existing.radius = seed.radius;
      existing.nodeType = seed.nodeType ?? existing.nodeType;
      existing.viewId = seed.viewId ?? existing.viewId;
      existing.__label = undefined;
      // First-load coords override the running x/y (only on initial sync
      // — we detect "initial" by checking that fx/fy are both null AND
      // x/y are also null).
      if (
        typeof seed.x === "number" &&
        typeof seed.y === "number" &&
        (existing.x === undefined || Number.isNaN(existing.x)) &&
        existing.fx === null
      ) {
        existing.x = seed.x;
        existing.y = seed.y;
      }
      next.push(existing);
    } else {
      // New node.
      next.push({
        ...seed,
        x: seed.x,
        y: seed.y,
        fx: seed.fx ?? null,
        fy: seed.fy ?? null,
      });
    }
  }
  nodes = next;
  nodeMap = new Map(nodes.map((n): [NodeId, SimNode] => [n.id, n]));

  // Build the link list (forceLink expects objects whose source/target
  // are node references, but the d3 link force can also resolve ids at
  // initialization time when `link.id(d => d.id)` is set).
  const seedLinksById = new Map<EdgeId, ForceLinkSeed>();
  for (const seed of linkSeeds) seedLinksById.set(seed.id, seed);

  // Drop links whose endpoints are not in the new node set.
  links = links.filter((l) =>
    seedLinksById.has(l.id) && nodeMap.has(l.source.id) && nodeMap.has(l.target.id)
  );

  const linkById = new Map<EdgeId, SimLink>();
  for (const l of links) linkById.set(l.id, l);

  const nextLinks: SimLink[] = [];
  for (const seed of linkSeeds) {
    const source = nodeMap.get(seed.source);
    const target = nodeMap.get(seed.target);
    if (!source || !target) continue; // skip orphan edges
    const existing = linkById.get(seed.id);
    if (existing) {
      existing.source = source;
      existing.target = target;
      existing.label = seed.label;
      existing.labelColor = seed.labelColor;
      existing.labelSize = seed.labelSize;
      existing.shape = seed.shape;
      existing.strokeType = seed.strokeType;
      existing.strokeColor = seed.strokeColor;
      existing.strokeWidth = seed.strokeWidth;
      existing.direction = seed.direction;
      existing.weight = seed.weight;
      nextLinks.push(existing);
    } else {
      nextLinks.push({
        id: seed.id,
        source,
        target,
        label: seed.label,
        labelColor: seed.labelColor,
        labelSize: seed.labelSize,
        shape: seed.shape,
        strokeType: seed.strokeType,
        strokeColor: seed.strokeColor,
        strokeWidth: seed.strokeWidth,
        direction: seed.direction,
        weight: seed.weight,
      });
    }
  }
  links = nextLinks;
  linkMap = new Map(links.map((l): [EdgeId, SimLink] => [l.id, l]));

  // (Re)create the simulation. d3's `forceSimulation` mutates its input
  // arrays, which is fine here.
  if (sim) {
    sim.nodes(nodes);
    (sim.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>> | null)
      ?.links(links);
  } else {
    sim = forceSimulation<SimNode>(nodes)
      .on("tick", onTick)
      .on("end", onEnd);
  }
  applyConfig(currentConfig);

  // Build the quadtree lazily.
  rebuildQuadtree();
  tickCount = 0;

  // Restart with full alpha so the new dataset visibly settles.
  sim.alpha(1).restart();
}

/** Apply a diff (incremental) to the running simulation. */
export function applyDiff(
  payload: import("../types").ForceDiffPayload,
): void {
  if (!sim) return;

  let hasTopologyChange = false;

  // -- Nodes ----------------------------------------------------------
  if (payload.nodeRemovals && payload.nodeRemovals.length > 0) {
    hasTopologyChange = true;
    const removeSet = new Set(payload.nodeRemovals);
    nodes = nodes.filter((n) => !removeSet.has(n.id));
    for (const id of payload.nodeRemovals) nodeMap.delete(id);
    selectedNodeIds = new Set(
      [...selectedNodeIds].filter((id) => !removeSet.has(id)),
    );
    if (hoveredNodeId && removeSet.has(hoveredNodeId)) {
      hoveredNodeId = null;
    }
  }

  if (payload.nodeUpserts && payload.nodeUpserts.length > 0) {
    for (const seed of payload.nodeUpserts) {
      const existing = nodeMap.get(seed.id);
      if (existing) {
        existing.label = seed.label;
        existing.fillColor = seed.fillColor;
        existing.strokeColor = seed.strokeColor;
        existing.strokeWidth = seed.strokeWidth;
        existing.labelColor = seed.labelColor;
        existing.labelSize = seed.labelSize;
        existing.radius = seed.radius;
        existing.nodeType = seed.nodeType ?? existing.nodeType;
        existing.viewId = seed.viewId ?? existing.viewId;
        existing.__label = undefined;
      } else {
        const newNode: SimNode = {
          ...seed,
          fx: seed.fx ?? null,
          fy: seed.fy ?? null,
        };
        nodes.push(newNode);
        nodeMap.set(seed.id, newNode);
        hasTopologyChange = true;
      }
    }
  }

  // -- Links ----------------------------------------------------------
  if (payload.linkRemovals && payload.linkRemovals.length > 0) {
    const removeSet = new Set(payload.linkRemovals);
    links = links.filter((l) => !removeSet.has(l.id));
    for (const id of payload.linkRemovals) linkMap.delete(id);
    selectedEdgeIds = new Set(
      [...selectedEdgeIds].filter((id) => !removeSet.has(id)),
    );
    hasTopologyChange = true;
  }

  if (payload.linkUpserts && payload.linkUpserts.length > 0) {
    for (const seed of payload.linkUpserts) {
      const source = nodeMap.get(seed.source);
      const target = nodeMap.get(seed.target);
      if (!source || !target) continue;
      const existing = linkMap.get(seed.id);
      if (existing) {
        existing.source = source;
        existing.target = target;
        existing.label = seed.label;
        existing.labelColor = seed.labelColor;
        existing.labelSize = seed.labelSize;
        existing.shape = seed.shape;
        existing.strokeType = seed.strokeType;
        existing.strokeColor = seed.strokeColor;
        existing.strokeWidth = seed.strokeWidth;
        existing.direction = seed.direction;
        existing.weight = seed.weight;
      } else {
        const newLink: SimLink = {
          id: seed.id,
          source,
          target,
          label: seed.label,
          labelColor: seed.labelColor,
          labelSize: seed.labelSize,
          shape: seed.shape,
          strokeType: seed.strokeType,
          strokeColor: seed.strokeColor,
          strokeWidth: seed.strokeWidth,
          direction: seed.direction,
          weight: seed.weight,
        };
        links.push(newLink);
        linkMap.set(newLink.id, newLink);
        hasTopologyChange = true;
      }
    }
  }

  // Only rebuild the simulation when topology changed (adds/removes).
  // Pure property updates (e.g. semantic color change) skip the restart.
  if (hasTopologyChange) {
    sim.nodes(nodes);
    (sim.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>> | null)
      ?.links(links);
    sim.alpha(0.3).restart();
  } else {
    // Still need to tell d3 about the updated nodes array in case
    // radius changed (affects forceCollide). But no simulation injection.
    sim.nodes(nodes);
    (sim.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>> | null)
      ?.links(links);
  }

  recomputeNeighbors();
  recomputeWorkerState();
  if (hasTopologyChange) {
    rebuildQuadtree();
  }
}

// -----------------------------------------------------------------------
// Label pre-computation
// -----------------------------------------------------------------------

/**
 * Pre-compute `__label` for nodes that have a title. Call this after
 * data ingestion (createOrUpdate / applyDiff) to avoid per-frame
 * `measureText` calls in the canvas renderer.
 *
 * @param getLabel — function that maps a title string to its truncated label.
 *   Typically `truncateLabel` from canvas.ts, invoked with the canvas context.
 * @param nodeIds — optional subset of node ids to recompute. When omitted,
 *   all nodes are processed (full sync path).
 */
export function populateNodeLabels(
  getLabel: (title: string) => string,
  nodeIds?: NodeId[],
): void {
  if (nodeIds && nodeIds.length > 0) {
    for (const id of nodeIds) {
      const node = nodeMap.get(id);
      if (node?.label) {
        node.__label = getLabel(node.label);
      }
    }
  } else {
    for (const node of nodes) {
      if (node.label) {
        node.__label = getLabel(node.label);
      }
    }
  }
}

// -----------------------------------------------------------------------
// Node mutation
// -----------------------------------------------------------------------

export function setNodeFixed(
  nodeId: NodeId,
  fixed: boolean,
  x?: number,
  y?: number,
): void {
  const node = nodeMap.get(nodeId);
  if (!node || !sim) return;
  if (typeof x === "number") node.x = x;
  if (typeof y === "number") node.y = y;
  node.fx = fixed ? (typeof x === "number" ? x : (node.x ?? 0)) : null;
  node.fy = fixed ? (typeof y === "number" ? y : (node.y ?? 0)) : null;
  if (fixed) {
    sim.alphaTarget(0.3).restart();
  } else {
    sim.alphaTarget(0).restart();
  }
}

function setNodePositionRaw(
  nodeId: NodeId,
  x: number,
  y: number,
): void {
  const node = nodeMap.get(nodeId);
  if (!node) return;
  node.x = x;
  node.y = y;
  if (node.fx !== null) node.fx = x;
  if (node.fy !== null) node.fy = y;
}

export function setNodePosition(
  nodeId: NodeId,
  x: number,
  y: number,
): void {
  if (!sim) return;
  setNodePositionRaw(nodeId, x, y);
  sim.alpha(0.3).restart();
}

// -----------------------------------------------------------------------
// Selection / hover state
// -----------------------------------------------------------------------

export function setSelectedNodes(ids: NodeId[]): void {
  selectedNodeIds = new Set(ids);
  selectedEdgeIds = new Set();
  recomputeNeighbors();
  recomputeWorkerState();
}

export function setSelectedEdges(ids: EdgeId[]): void {
  selectedEdgeIds = new Set(ids);
  selectedNodeIds = new Set();
  recomputeNeighbors();
  recomputeWorkerState();
}

export function setHoveredNode(id: NodeId | null): void {
  if (hoveredNodeId === id) return;
  const prev = hoveredNodeId;
  hoveredNodeId = id;
  recomputeWorkerState();
  if (id !== null) {
    emit({ type: "node:pointer-enter", nodeId: id });
  } else if (prev !== null) {
    emit({ type: "node:pointer-leave", nodeId: prev });
  }
}

export function getSelectionState() {
  return {
    selectedNodeIds: new Set(selectedNodeIds),
    selectedEdgeIds: new Set(selectedEdgeIds),
    hoveredNodeId,
    neighborNodeIds: new Set(neighborNodeIds),
  };
}

export function clearSelection(): void {
  selectedNodeIds = new Set();
  selectedEdgeIds = new Set();
  hoveredNodeId = null;
  recomputeNeighbors();
  recomputeWorkerState();
  emit({ type: "selection:changed", selectedNodeIds: [], selectedEdgeIds: [] });
}

// -----------------------------------------------------------------------
// Simulation control
// -----------------------------------------------------------------------

export function reheat(): void {
  if (!sim) return;
  sim.alpha(1).restart();
}

export function stopSimulation(): void {
  if (!sim) return;
  sim.stop();
  for (const cb of tickListeners) cb(sim.alpha());
}

export function resumeSimulation(): void {
  if (!sim) return;
  sim.alphaTarget(0).restart();
}

export function updateConfig(config: ForceConfig): void {
  currentConfig = { ...currentConfig, ...config };
  applyConfig(currentConfig);
  if (sim) sim.alpha(0.3).restart();
}

export function updateDims(width: number, height: number): void {
  currentDims = { width, height };
  applyConfig(currentConfig);
}

// -----------------------------------------------------------------------
// Tick + listener
// -----------------------------------------------------------------------

function onTick(): void {
  if (!sim) return;
  const alpha = sim.alpha();
  for (const cb of tickListeners) cb(alpha);
  // Throttle quadtree rebuild: once every 5 ticks. The quadtree is
  // always rebuilt after topology changes (applyDiff), so the per-tick
  // path only needs a fixed-interval refresh.
  if (qt && ++tickCount % 5 === 0) {
    rebuildQuadtree();
  }
}

/** d3 `end` event — fires when the simulation naturally settles; snapshot
 *  node positions so the main thread can persist the layout. */
function onEnd(): void {
  emit({
    type: "simulation:stopped",
    positions: nodes.map((n) => ({
      id: n.id,
      x: n.x ?? 0,
      y: n.y ?? 0,
    })),
  });
}

export function onTickListener(cb: (alpha: number) => void): () => void {
  tickListeners.push(cb);
  return () => {
    tickListeners = tickListeners.filter((c) => c !== cb);
  };
}

// -----------------------------------------------------------------------
// Hit-testing
// -----------------------------------------------------------------------

/**
 * Find the closest node within `radius` of the given simulation-coord
 * point. Uses d3-quadtree when node count >= 2000, brute-force otherwise.
 */
export function hitTest(
  x: number,
  y: number,
  radius: number = 10,
): SimNode | null {
  if (nodes.length === 0) return null;

  if (qt) {
    // Use the built-in find() with a search radius — it walks the tree
    // internally and returns the closest match.
    const found = qt.find(x, y, radius) as SimNode | undefined;
    return found ?? null;
  }

  // Brute force.
  let closest: SimNode | null = null;
  let minDist = Infinity;
  for (const n of nodes) {
    const nx = Number.isFinite(n.x) ? n.x! : 0;
    const ny = Number.isFinite(n.y) ? n.y! : 0;
    const dx = x - nx;
    const dy = y - ny;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < minDist && dist <= radius) {
      minDist = dist;
      closest = n;
    }
  }
  return closest;
}

// -----------------------------------------------------------------------
// Edge hit-testing
// -----------------------------------------------------------------------

/**
 * Hit-test all edges. Returns the closest edge within `threshold`
 * device pixels, or null.
 *
 * The curve geometry is resolved through `resolveEdgeGeometry` — the same
 * shared math the Pixi renderer uses — so a visible curve is always
 * hit-testable at the same coordinates it is drawn.
 *
 * When the d3-quadtree is available (n ≥ 2000), we pre-filter edges by
 * finding candidate nodes near the hit point first, then only checking
 * edges incident to those candidates. This avoids the O(m) brute-force
 * iteration for large graphs.
 */
export function hitTestEdge(
  x: number,
  y: number,
  threshold: number = 10,
): { link: SimLink; dist: number } | null {
  let closest: SimLink | null = null;
  let minDist = Infinity;

  // Spatial pre-filter: when quadtree exists, find candidate nodes near
  // the hit point. Search radius = linkDistance (80) + threshold (10) +
  // padding, since edges can span up to ~linkDistance in the layout.
  let candidateNodeIds: Set<NodeId> | null = null;
  if (qt) {
    const searchRadius = 100;
    const candidateIds = new Set<NodeId>();
    qt.visit((node, x1, y1, x2, y2) => {
      if (node) {
        const simNode = node as unknown as SimNode;
        const ndx = (simNode.x ?? 0) - x;
        const ndy = (simNode.y ?? 0) - y;
        if (Math.sqrt(ndx * ndx + ndy * ndy) <= searchRadius) {
          candidateIds.add(simNode.id);
        }
        return true;
      }
      const dx = x < x1 ? x1 - x : (x > x2 ? x - x2 : 0);
      const dy = y < y1 ? y1 - y : (y > y2 ? y - y2 : 0);
      return dx * dx + dy * dy < searchRadius * searchRadius;
    });
    candidateNodeIds = candidateIds;
  }

  for (const link of links) {
    // Pre-filter: skip edges whose both endpoints are outside the candidate set.
    if (candidateNodeIds && !candidateNodeIds.has(link.source.id) && !candidateNodeIds.has(link.target.id)) {
      continue;
    }

    const geom = resolveEdgeGeometry(
      {
        x: link.source.x ?? 0,
        y: link.source.y ?? 0,
        radius: link.source.radius ?? DEFAULT_NODE_RADIUS,
      },
      {
        x: link.target.x ?? 0,
        y: link.target.y ?? 0,
        radius: link.target.radius ?? DEFAULT_NODE_RADIUS,
      },
      link.shape,
      link.direction,
    );
    if (
      !Number.isFinite(geom.sx) ||
      !Number.isFinite(geom.sy) ||
      !Number.isFinite(geom.tx) ||
      !Number.isFinite(geom.ty)
    ) {
      continue;
    }

    let dist: number;
    if (geom.kind === "cubic") {
      dist = pointToCubicCurve(
        x, y,
        geom.sx, geom.sy,
        geom.c1x, geom.c1y,
        geom.c2x, geom.c2y,
        geom.tx, geom.ty,
      );
    } else if (geom.kind === "quadratic") {
      dist = pointToQuadraticCurve(
        x, y,
        geom.sx, geom.sy,
        geom.c1x, geom.c1y,
        geom.tx, geom.ty,
      );
    } else {
      dist = pointToSegment(x, y, geom.sx, geom.sy, geom.tx, geom.ty);
    }

    if (dist < minDist && dist <= threshold) {
      minDist = dist;
      closest = link;
    }
  }
  return closest ? { link: closest, dist: minDist } : null;
}

// -----------------------------------------------------------------------
// DOM event handling (worker-internal, takes a ProxiedDomEvent)
// -----------------------------------------------------------------------

/**
 * Resolve a `ProxiedDomEvent` into a `WorkerEvent` (or null when the event
 * does not produce a domain event — e.g. pan/zoom modifies viewport state
 * without emitting anything back to the main thread).
 *
 * Note: pan/zoom/lasso are *state mutations* on the worker side. The main
 * thread owns the UI mirror (e.g. `useUIStore.selectedNodeIds`); the worker
 * only emits the high-level semantic events needed to drive that store.
 */
export function handleProxiedEvent(evt: ProxiedDomEvent): void {
  switch (evt.type) {
    case "pointer-down": {
      if (evt.button !== 0) return;
      const target = hitTest(evt.x, evt.y, 10);

      // Alt-drag: enter edge-creation mode instead of selecting / dragging.
      if (evt.modifiers.alt) {
        const srcIds = target
          ? selectedNodeIds.has(target.id)
            ? [...selectedNodeIds]
            : [target.id]
          : selectedNodeIds.size > 0
            ? [...selectedNodeIds]
            : null;
        if (srcIds && srcIds.length > 0) {
          altDragAssist = {
            active: true,
            sourceIds: srcIds,
            targetId: null,
            assistPoint: { x: evt.x, y: evt.y },
          };
        }
        return;
      }

      pressedNodeId = target && !evt.modifiers.ctrl && !evt.modifiers.shift
        ? target.id : null;
      // Double-click detection (FIX 1.4)
      const now = Date.now();
      if (target && target.id === lastClickNode && now - lastClickTime < 300) {
        clearSelection();
        setSelectedNodes([target.id]);
        emit({ type: "node:dblclick", nodeId: target.id });
        lastClickTime = 0;
        lastClickNode = null;
        pressedNodeId = null;
        return;
      }
      if (target) {
        lastClickTime = now;
        lastClickNode = target.id;
        // A node press is never part of a canvas double-click sequence.
        lastCanvasClickTime = 0;
        // Track drag origin so click-vs-drag can be distinguished.
        dragMoved = false;
        dragStarted = false;
        dragStartX = evt.x;
        dragStartY = evt.y;
      }
      if (target) {
        if (evt.modifiers.ctrl) return;
        if (evt.modifiers.shift) {
          const next = new Set(selectedNodeIds);
          if (next.has(target.id)) next.delete(target.id);
          else next.add(target.id);
          const idsArr = [...next];
          setSelectedNodes(idsArr);
          for (const id of idsArr) {
            const n = nodeMap.get(id);
            if (n) dragOffsets.set(id, { ox: (n.x ?? 0) - evt.x, oy: (n.y ?? 0) - evt.y });
          }
          emit({ type: "selection:changed", selectedNodeIds: idsArr, selectedEdgeIds: [] });
          return;
        }
        setSelectedNodes([target.id]);
        for (const id of selectedNodeIds) {
          const n = nodeMap.get(id);
          if (n) dragOffsets.set(id, { ox: (n.x ?? 0) - evt.x, oy: (n.y ?? 0) - evt.y });
        }
        emit({ type: "selection:changed", selectedNodeIds: [target.id], selectedEdgeIds: [] });
      } else {
        // No node hit — try edge hit-test before falling back to canvas.
        const edgeTarget = hitTestEdge(evt.x, evt.y, 10);
        if (edgeTarget) {
          lastCanvasClickTime = 0;
          clearSelection();
          setSelectedEdges([edgeTarget.link.id]);
          emit({ type: "edge:click", edgeId: edgeTarget.link.id, modifiers: evt.modifiers });
        } else if (now - lastCanvasClickTime < 300) {
          // Double-click on empty canvas → main thread resets the viewport.
          lastCanvasClickTime = 0;
          clearSelection();
          emit({ type: "canvas:dblclick" });
        } else {
          lastCanvasClickTime = now;
          clearSelection();
          emit({ type: "canvas:pointer-down", x: evt.x, y: evt.y, modifiers: evt.modifiers });
        }
      }
      break;
    }
    case "pointer-move": {
      if (altDragAssist.active) {
        altDragAssist.assistPoint = { x: evt.x, y: evt.y };
        const target = hitTest(evt.x, evt.y);
        altDragAssist.targetId = target?.id ?? null;
        emit({
          type: "alt-drag:update",
          sourceIds: altDragAssist.sourceIds,
          targetId: altDragAssist.targetId,
        });
        return;
      }
      // Only drag when the primary button is held — without this check,
      // clicking a node (press+release) then moving the mouse would
      // continue to drag the selected node.
      if (
        (evt.buttons & 1) !== 0 &&
        selectedNodeIds.size > 0 &&
        !evt.modifiers.alt &&
        !evt.modifiers.ctrl
      ) {
        // Distance threshold (3 simulation-px): ignore hardware noise
        // and distinguish click from drag. Match eventListener.ts pan
        // threshold of 6 device-px scaled down for sim space.
        const dx = evt.x - dragStartX;
        const dy = evt.y - dragStartY;
        if (Math.sqrt(dx * dx + dy * dy) > 3) {
          if (!dragStarted) {
            dragStarted = true;
            lastClickNode = null;
            pressedNodeId = null;
            const primaryId = [...selectedNodeIds][0]!;
            const primary = nodeMap.get(primaryId);
            setNodeFixed(primaryId, true, primary?.x, primary?.y);
            emit({ type: "node:drag-start", nodeId: primaryId, x: primary?.x ?? 0, y: primary?.y ?? 0 });
          }
          dragMoved = true;
          for (const id of selectedNodeIds) {
            const n = nodeMap.get(id);
            if (!n) continue;
            const offset = dragOffsets.get(id) ?? { ox: 0, oy: 0 };
            setNodePositionRaw(id, evt.x + offset.ox, evt.y + offset.oy);
            emit({ type: "node:drag", nodeId: id, x: evt.x + offset.ox, y: evt.y + offset.oy });
          }
          sim?.alpha(0.3).restart();
        }
      }
      // Suppress hover while dragging so the preview doesn't flicker
      // between nodes mid-gesture.
      if (!dragMoved) {
        const target = hitTest(evt.x, evt.y);
        setHoveredNode(target?.id ?? null);
      }
      emit({ type: "canvas:pointer-move", x: evt.x, y: evt.y });
      break;
    }
    case "pointer-up": {
      // Right-click: the context-menu handler owns hit-test + selection.
      // If we emit canvas:click here, it would race with the deferred
      // context menu and close it immediately.
      if (evt.button !== 0) break;

      if (altDragAssist.active) {
        const upTarget = hitTest(evt.x, evt.y);
        emit({
          type: "alt-drag:end",
          sourceIds: altDragAssist.sourceIds,
          targetId: upTarget?.id ?? null,
          clientX: evt.clientX,
          clientY: evt.clientY,
        });
        altDragAssist = {
          active: false,
          sourceIds: [],
          targetId: null,
          assistPoint: { x: 0, y: 0 },
        };
        return;
      }

      const wasDragging = dragMoved;
      const keepFixed = evt.modifiers.ctrl;
      for (const id of selectedNodeIds) {
        setNodeFixed(id, keepFixed);
        const n = nodeMap.get(id);
        emit({
          type: "node:drag-end",
          nodeId: id,
          x: n?.x ?? 0,
          y: n?.y ?? 0,
        });
      }
      emit({ type: "canvas:pointer-up", x: evt.x, y: evt.y });
      if (!wasDragging) {
        const upTarget = hitTest(evt.x, evt.y);
        if (upTarget) {
          // Only an unmodified press/release on the same node is a click.
          // A double-click or drag clears the press before release.
          if (
            upTarget.id === pressedNodeId && upTarget.id === lastClickNode &&
            !evt.modifiers.ctrl && !evt.modifiers.shift && !evt.modifiers.alt
          ) {
            emit({ type: "node:click", nodeId: upTarget.id });
          }
          pressedNodeId = null;
          break;
        }
        // No node hit — check edge before treating as canvas click.
        // Without this, clicking an edge then releasing emits canvas:click,
        // which clears the edge selection we just made in pointer-down.
        const upEdge = hitTestEdge(evt.x, evt.y);
        if (upEdge) break;
        emit({ type: "canvas:click", x: evt.x, y: evt.y });
      }
      dragMoved = false;
      break;
    }
    case "wheel": {
      // Viewport pan/zoom is owned by the main thread (eventListener.ts
      // wheel handler → onViewportChange → api.setViewport). The worker
      // never receives wheel events through this path; the ProxiedDomEvent
      // "wheel" variant exists solely to satisfy the exhaustive union type.
      break;
    }
    case "context-menu": {
      const target = hitTest(evt.x, evt.y, 10);
      if (target) {
        clearSelection();
        setSelectedNodes([target.id]);
        emit({ type: "context-menu:node", nodeId: target.id, clientX: evt.clientX, clientY: evt.clientY });
      } else {
        const edgeHit = hitTestEdge(evt.x, evt.y, 10);
        if (edgeHit) {
          clearSelection();
          setSelectedEdges([edgeHit.link.id]);
          emit({ type: "context-menu:edge", edgeId: edgeHit.link.id, clientX: evt.clientX, clientY: evt.clientY });
        } else {
          clearSelection();
          emit({ type: "context-menu:canvas", clientX: evt.clientX, clientY: evt.clientY });
        }
      }
      break;
    }
    case "key-down":
    case "key-up":
      // No domain semantics for key events in the worker (the main thread
      // owns keyboard handling for mod-key tracking).
      break;
    default: {
      // Exhaustiveness check.
      const _exhaustive: never = evt;
      void _exhaustive;
    }
  }
}

// -----------------------------------------------------------------------
// Event emission
// -----------------------------------------------------------------------

type EventListener = (event: import("../types").WorkerEvent) => void;
let eventHandler: EventListener | null = null;

export function setEventHandler(handler: EventListener | null): void {
  eventHandler = handler;
}

export function emit(event: import("../types").WorkerEvent): void {
  if (eventHandler) {
    try {
      eventHandler(event);
    } catch (err) {
      console.error("[simulation] eventHandler threw:", err);
    }
  }
}

// -----------------------------------------------------------------------
// Frame push (called by force.worker.ts after rAF tick to push a fresh
// ImageBitmap to the main thread).
// -----------------------------------------------------------------------

/**
 * Read-only access to the internal node/link arrays for the canvas
 * renderer. Returns references, not copies — callers must not mutate.
 */
export function readSimulationState() {
  return {
    nodes: nodes as ReadonlyArray<SimNode>,
    links: links as ReadonlyArray<SimLink>,
  };
}

// -----------------------------------------------------------------------
// Alt-drag assist-edge state (read by the canvas renderer)
// -----------------------------------------------------------------------

export interface AltDragAssistRender {
  active: boolean;
  sourcePoints: Array<{ x: number; y: number }>;
  targetPoint: { x: number; y: number };
}

/**
 * Resolve the Alt-drag assist-edge geometry (source node centers + the
 * cursor / hover-target endpoint) for the canvas renderer. Returns an
 * inactive render when no Alt-drag is in progress.
 */
export function readAltDragState(): AltDragAssistRender {
  if (!altDragAssist.active) {
    return { active: false, sourcePoints: [], targetPoint: { x: 0, y: 0 } };
  }
  const sourcePoints: Array<{ x: number; y: number }> = [];
  for (const id of altDragAssist.sourceIds) {
    const n = nodeMap.get(id);
    if (!n) continue;
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sourcePoints.push({ x, y });
  }
  let targetPoint = altDragAssist.assistPoint;
  if (altDragAssist.targetId) {
    const n = nodeMap.get(altDragAssist.targetId);
    if (n) targetPoint = { x: n.x ?? 0, y: n.y ?? 0 };
  }
  return { active: true, sourcePoints, targetPoint };
}

// -----------------------------------------------------------------------
// Status
// -----------------------------------------------------------------------

export function getStatus(): "idle" | "running" | "stopped" {
  if (!sim) return "idle";
  // d3 doesn't expose a clean "stopped" flag; infer from alphaTarget.
  if (sim.alpha() < 0.001) return "stopped";
  return "running";
}

export function ping(): "pong" {
  return "pong";
}
