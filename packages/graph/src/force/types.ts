// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Force mode PRIVATE types
 *
 * Authoritative definitions for the Comlink RPC surface between the main
 * thread orchestrator (`force/ForceGraph.tsx`) and the WebWorker
 * (`force/worker/force.worker.ts`). The worker exposes `WorkerInbound` and
 * pushes `WorkerEvent`s back to the main thread.
 *
 * Cross-document contract: method names + signatures here MUST match
 * `force/worker/api.ts` exactly.
 *
 * Architectural rule (PRIVATE module): this module DEFINES its own
 * force-specific types and USES shared types imported from `../types`.
 * `flow/*` MUST NOT import from this module.
 */

import type {
  EdgeDirection,
  EdgeId,
  EdgeWeight,
  NodeDataType,
  NodeId,
} from "@workspace/interfaces";
import type { Modifiers } from "../types";

// -----------------------------------------------------------------------
// ProxiedDomEvent
// -----------------------------------------------------------------------

/**
 * Serialized DOM events forwarded from the main thread orchestrator to the
 * worker. The worker has no DOM access so all pointer/wheel/contextmenu/key
 * events are first captured by the main thread `eventListener.ts`, then
 * converted into a `ProxiedDomEvent` and shipped through the Comlink RPC.
 */
export type ProxiedDomEvent =
  | {
      type: "pointer-down";
      x: number;
      y: number;
      button: number;
      clientX: number;
      clientY: number;
      modifiers: Modifiers;
    }
  | {
      type: "pointer-move";
      x: number;
      y: number;
      buttons: number;
      clientX: number;
      clientY: number;
      modifiers: Modifiers;
    }
  | {
      type: "pointer-up";
      x: number;
      y: number;
      button: number;
      clientX: number;
      clientY: number;
      modifiers: Modifiers;
    }
  | {
      type: "wheel";
      deltaX: number;
      deltaY: number;
      modifiers: Modifiers;
    }
  | {
      type: "context-menu";
      x: number;
      y: number;
      clientX: number;
      clientY: number;
      modifiers: Modifiers;
    }
  | {
      type: "key-down";
      key: string;
      code: string;
      modifiers: Modifiers;
    }
  | {
      type: "key-up";
      key: string;
      code: string;
      modifiers: Modifiers;
    };

// -----------------------------------------------------------------------
// Render state (worker-internal interaction state)
// -----------------------------------------------------------------------

/**
 * Interaction state computed by the worker after processing pointer events.
 * Maps to visual adjustments defined by `*_RENDER_RULES` in `styleConfig.ts`.
 *
 * PRIVATE to `force/*`. Not used by flow mode.
 */
export type RenderState =
  | "default"
  | "hover"
  | "selected"
  | "active"
  | "neighbor"
  | "inactive";

// -----------------------------------------------------------------------
// Force seeds (main → worker transport DTOs)
// -----------------------------------------------------------------------

/**
 * Lightweight DTO for shipping node data from main → worker.
 *
 * All visual properties are fully resolved on the main thread before
 * transmission — the worker paints exactly what it receives. No theme
 * lookup or style-config join happens inside the worker.
 *
 * - `x` / `y` are initial coordinates read from
 *   `stateData.client.position[currentViewId]` (cross-mode position backfill).
 *   When absent, d3-force uses phyllotaxis fallback.
 * - `fx` / `fy` are *pin coordinates* — set only when actively dragging.
 * - `radius` is the visual radius, also reused for forceCollide.
 * - d3 runtime fields (`vx`,`vy`,`index`) are filled by the worker internally.
 */
export interface ForceNodeSeed {
  id: NodeId;

  // --- Visual (fully resolved on main thread) ---
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  label: string;
  labelColor: string;
  labelSize: number;
  radius: number;

  // --- Layout ---
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;

  // --- Identity (for future rendering / edge weight) ---
  nodeType?: NodeDataType;
  viewId?: string;
}

/**
 * Lightweight DTO for shipping edge data from main → worker.
 *
 * `source` / `target` are NodeId strings — the worker resolves them
 * against its internal node map after d3 builds the simulation.
 */
export interface ForceLinkSeed {
  id: EdgeId;
  source: NodeId;
  target: NodeId;

  // --- Visual (fully resolved on main thread) ---
  label: string;
  labelColor: string;
  labelSize: number;
  shape: "straight" | "curve" | "s-curve";
  strokeType: "solid" | "dotted" | "dashed";
  strokeColor: string;
  strokeWidth: number;

  // --- Data ---
  direction: EdgeDirection;
  weight?: EdgeWeight;
}

// -----------------------------------------------------------------------
// Configs, diffs, payloads
// -----------------------------------------------------------------------

/** d3-force simulation configuration (worker → d3 force factories). */
export interface ForceConfig {
  strength?: number;
  collisionRadius?: number;
  linkDistance?: number;
  centerX?: number;
  centerY?: number;
  /**
   * Node density of the soft circular boundary, in nodes per px².
   * The boundary radius is `r = sqrt(n / boundaryDensity)`, where `n` is
   * the node count. `n = 150, density = 1e-5` gives `r ~= 3873px`.
   *
   * Only the node count and this parameter decide the radius: it never
   * looks at node positions, so the boundary cannot be dragged outward
   * by a drifting node, and no connectivity analysis is needed. Raise
   * the density for a tighter boundary, lower it for a looser one.
   * Ignored when `boundaryRadius` is set.
   */
  boundaryDensity?: number;
  /**
   * Explicit boundary radius, in simulation px. When set it replaces the
   * density-derived radius, so the frame stays fixed while nodes are
   * added or removed. `0` or undefined keeps the density formula.
   */
  boundaryRadius?: number;
  /**
   * Stiffness of the spring a node feels beyond the boundary, in
   * px/tick² per px of overshoot:
   * `v += -r̂ * boundaryStrength * (r - boundaryDensityRadius) * alpha`.
   * A node inside the boundary feels nothing. `0` disables the boundary.
   */
  boundaryStrength?: number;
  alphaMin?: number;
  alphaDecay?: number;
  velocityDecay?: number;
}

/**
 * Global canvas style. Only contains properties that are NOT per-element
 * (background and grid). Per-node/per-edge visuals are embedded in the
 * seed data directly.
 *
 * `backgroundStyle` controls how the grid layer is rendered:
 * - `"grid"`: evenly spaced grid lines
 * - `"dots"`: dots at grid intersections
 * - `"none"` / `undefined`: grid layer hidden
 */
export interface ForceStyle {
  backgroundColor: string;
  gridColor?: string;
  backgroundStyle?: "grid" | "dots" | "none";
}

/**
 * Incremental diff payload (main → worker) for hot-reload of node/link sets.
 * Flattens the orchestrator-level `Diff` into 4 typed fields suitable for
 * serialization over Comlink.
 */
export interface ForceDiffPayload {
  nodeUpserts?: ForceNodeSeed[];
  nodeRemovals?: NodeId[];
  linkUpserts?: ForceLinkSeed[];
  linkRemovals?: EdgeId[];
}

// -----------------------------------------------------------------------
// WorkerEvent (worker → main)
// -----------------------------------------------------------------------

/**
 * Events emitted by the worker to the main thread. Forwarded via Comlink
 * `proxy` callback (registered with `setEventHandler`) **except** for
 * `frame`, which uses the raw `postMessage` channel because ImageBitmap
 * is not a default Comlink Transferable.
 */
export type WorkerEvent =
  | { type: "node:click"; nodeId: NodeId }
  | { type: "node:dblclick"; nodeId: NodeId }
  | { type: "node:pointer-enter"; nodeId: NodeId }
  | { type: "node:pointer-leave"; nodeId: NodeId }
  | { type: "node:drag-start"; nodeId: NodeId; x: number; y: number }
  | { type: "node:drag"; nodeId: NodeId; x: number; y: number }
  | { type: "node:drag-end"; nodeId: NodeId; x: number; y: number }
  | { type: "edge:click"; edgeId: EdgeId; modifiers: Modifiers }
  | { type: "canvas:click"; x: number; y: number }
  | { type: "canvas:dblclick" }
  | { type: "canvas:pointer-down"; x: number; y: number; modifiers: Modifiers }
  | { type: "canvas:pointer-move"; x: number; y: number }
  | { type: "canvas:pointer-up"; x: number; y: number }
  | {
      type: "canvas:wheel";
      deltaX: number;
      deltaY: number;
      modifiers: Modifiers;
    }
  | {
      type: "selection:changed";
      selectedNodeIds: NodeId[];
      selectedEdgeIds: EdgeId[];
    }
  | { type: "frame"; bitmap: ImageBitmap }
  | { type: "tick"; alpha: number }
  | { type: "status"; status: "idle" | "running" | "stopped" }
  | {
      type: "simulation:stopped";
      positions: { id: NodeId; x: number; y: number }[];
    }
  | {
      type: "context-menu:node";
      nodeId: NodeId;
      clientX: number;
      clientY: number;
    }
  | {
      type: "context-menu:edge";
      edgeId: EdgeId;
      clientX: number;
      clientY: number;
    }
  | { type: "context-menu:canvas"; clientX: number; clientY: number }
  | { type: "alt-drag:update"; sourceIds: NodeId[]; targetId: NodeId | null }
  | {
      type: "alt-drag:end";
      sourceIds: NodeId[];
      targetId: NodeId | null;
      clientX: number;
      clientY: number;
    };

// -----------------------------------------------------------------------
// WorkerInbound (Comlink.expose surface — main → worker)
// -----------------------------------------------------------------------

/**
 * The authoritative set of methods exposed by the worker via
 * `Comlink.expose`. Method names, parameters, and return types MUST match
 * `force/worker/api.ts` line-for-line.
 */
export interface WorkerInbound {
  initData(
    nodes: ForceNodeSeed[],
    links: ForceLinkSeed[],
    dims: { width: number; height: number },
  ): Promise<void>;

  applyDiff(diff: ForceDiffPayload): Promise<void>;

  updateConfig(config: ForceConfig): Promise<void>;

  updateStyle(style: ForceStyle): Promise<void>;

  setNodeFixed(
    nodeId: NodeId,
    fixed: boolean,
    x?: number,
    y?: number,
  ): Promise<void>;

  setNodePosition(nodeId: NodeId, x: number, y: number): Promise<void>;

  reheat(): Promise<void>;

  stop(): Promise<void>;

  resume(): Promise<void>;

  setViewport(x: number, y: number, scale: number): Promise<void>;

  setDimensions(width: number, height: number): Promise<void>;

  setEventHandler(
    handler: ((event: WorkerEvent) => void) | null,
  ): Promise<void>;

  proxyEvent(event: ProxiedDomEvent): Promise<void>;
}

// -----------------------------------------------------------------------
// Viewport + canvas types
// -----------------------------------------------------------------------

export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

export interface Dimensions {
  width: number;
  height: number;
}
