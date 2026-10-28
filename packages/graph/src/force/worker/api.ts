// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WorkerInbound implementation.
 *
 * This module exposes the `WorkerInbound` methods that the main thread
 * calls via Comlink. Each method delegates to `simulation.ts` and
 * `canvas.ts` — the routing table matches worker/design.md §3.1.
 *
 * IMPORTANT: every method signature MUST match `force/types.ts` →
 * `WorkerInbound` exactly.
 */

import type { NodeId } from "@workspace/interfaces";
import type {
  ForceConfig,
  ForceDiffPayload,
  ForceLinkSeed,
  ForceNodeSeed,
  ForceStyle,
  ProxiedDomEvent,
  WorkerEvent,
  WorkerInbound,
} from "../types";
import {
  applyDiff,
  createOrUpdate,
  emit,
  getStatus,
  handleProxiedEvent,
  onTickListener,
  populateNodeLabels,
  reheat,
  resumeSimulation,
  setEventHandler,
  setNodeFixed,
  setNodePosition,
  stopSimulation,
  updateConfig,
  updateDims,
} from "./simulation";
import {
  clearStyleKeyCaches,
  createCanvas,
  getContext,
  renderFrame,
  resizeCanvas,
  setStyle,
  setViewport as setCanvasViewport,
  truncateLabel,
} from "./canvas";

// -----------------------------------------------------------------------
// Bound viewport (for canvas.ts + event routing)
// -----------------------------------------------------------------------

let canvasViewport = { x: 0, y: 0, scale: 1 };

// -----------------------------------------------------------------------
// Frame loop
// -----------------------------------------------------------------------

/**
 * Request a single render frame. Phase 2: the OffscreenCanvas is
 * transferred from the main thread and composited by the browser
 * GPU — no ImageBitmap copy is needed.
 */
function pushFrame(): void {
  renderFrame();
}

// Throttle frame pushes to at most one per animation frame to avoid
// flooding the main thread. Additionally, skip rendering when the
// simulation is idle (no position changes) and nothing else dirtied the
// frame (no viewport change, no interaction).
let pendingFrame = false;
let isDirty = true;

function scheduleFrame(): void {
  if (pendingFrame) return;
  pendingFrame = true;
  queueMicrotask(() => {
    pendingFrame = false;
    if (isDirty) {
      isDirty = false;
      pushFrame();
    }
  });
}

// Subscribe to simulation ticks so we re-render every step.
onTickListener((alpha: number) => {
  if (alpha > 0.001) isDirty = true;
  scheduleFrame();
});

// -----------------------------------------------------------------------
// WorkerInbound
// -----------------------------------------------------------------------

export const api: WorkerInbound = {
  async initData(
    nodes: ForceNodeSeed[],
    links: ForceLinkSeed[],
    dims: { width: number; height: number },
  ): Promise<void> {
    try {
      createCanvas(dims.width, dims.height);
    } catch (err) {
      postError(`Canvas init failed: ${err}`);
      throw err;
    }
    updateDims(dims.width, dims.height);
    createOrUpdate(nodes, links, dims);
    computeLabels();
    isDirty = true;
    scheduleFrame();
  },

  async applyDiff(diff: ForceDiffPayload): Promise<void> {
    applyDiff(diff);
    const upsertedIds = diff.nodeUpserts?.map((s) => s.id);
    computeLabels(upsertedIds);
    isDirty = true;
    scheduleFrame();
  },

  async updateConfig(config: ForceConfig): Promise<void> {
    updateConfig(config);
    isDirty = true;
    scheduleFrame();
  },

  async updateStyle(style: ForceStyle): Promise<void> {
    setStyle(style);
    isDirty = true;
    scheduleFrame();
  },

  async setNodeFixed(
    nodeId: NodeId,
    fixed: boolean,
    x?: number,
    y?: number,
  ): Promise<void> {
    setNodeFixed(nodeId, fixed, x, y);
    isDirty = true;
    scheduleFrame();
  },

  async setNodePosition(
    nodeId: NodeId,
    x: number,
    y: number,
  ): Promise<void> {
    setNodePosition(nodeId, x, y);
    isDirty = true;
    scheduleFrame();
  },

  async reheat(): Promise<void> {
    reheat();
    isDirty = true;
    scheduleFrame();
  },

  async stop(): Promise<void> {
    stopSimulation();
    emit({ type: "status", status: getStatus() });
  },

  async resume(): Promise<void> {
    resumeSimulation();
    emit({ type: "status", status: getStatus() });
  },

  async setViewport(x: number, y: number, scale: number): Promise<void> {
    if (canvasViewport.x !== x || canvasViewport.y !== y || canvasViewport.scale !== scale) {
      isDirty = true;
    }
    canvasViewport = { x, y, scale };
    setCanvasViewport(canvasViewport);
    scheduleFrame();
  },

  async setDimensions(width: number, height: number): Promise<void> {
    updateDims(width, height);
    try {
      resizeCanvas({ width, height });
    } catch (err) {
      postError(`Canvas resize failed: ${err}`);
      throw err;
    }
    isDirty = true;
    scheduleFrame();
  },

  async setEventHandler(
    handler: ((event: WorkerEvent) => void) | null,
  ): Promise<void> {
    setEventHandler(handler);
  },

  async proxyEvent(event: ProxiedDomEvent): Promise<void> {
    handleProxiedEvent(event);
    // Interaction may change selection/hover state without restarting
    // the d3 simulation. Always push a frame so the canvas stays in
    // sync with the worker's internal UI state.
    clearStyleKeyCaches();
    isDirty = true;
    scheduleFrame();
  },
};

// -----------------------------------------------------------------------
// Label pre-computation
// -----------------------------------------------------------------------

function computeLabels(nodeIds?: NodeId[]): void {
  const c = getContext();
  if (!c) return;
  if (nodeIds && nodeIds.length > 0) {
    // Only recompute labels for the actually upserted nodes.
    populateNodeLabels((title) => truncateLabel(title, 100, c), nodeIds);
  } else {
    // Full recompute (initData path).
    populateNodeLabels((title) => truncateLabel(title, 100, c));
  }
}

// -----------------------------------------------------------------------
// Error reporting
// -----------------------------------------------------------------------

function postError(msg: string): void {
  try {
    self.postMessage({ type: "__ERROR__", message: msg });
  } catch {
    // The message channel may already be gone (worker is shutting down).
  }
}
