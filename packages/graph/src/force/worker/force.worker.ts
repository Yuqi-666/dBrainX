// SPDX-License-Identifier: AGPL-3.0-only

/**
 * d3-force WebWorker entry point.
 *
 * Loaded via `new Worker(new URL('./force.worker.ts', import.meta.url), { type: 'module' })`
 * from the main thread (`ForceGraph.tsx`). Responsibilities:
 *
 *   1. Expose the `WorkerInbound` API to the main thread via Comlink.
 *   2. Listen for raw `postMessage` events carrying `ImageBitmap` frames
 *      (push them to the OffscreenCanvas owner).
 *   3. Handle worker-level lifecycle (init canvas from a one-time
 *      Comlink.transfer call).
 *
 * The worker creates its own detached OffscreenCanvas internally from
 * dimensions sent via a separate `postMessage` (see `createCanvas`
 * in `canvas.ts`). The canvas is **not** part of the Comlink
 * surface because Comlink cannot transfer it by default (issue #512).
 *
 * Cross-document contract: worker/design.md §1, §2.
 */

import * as Comlink from "comlink";
import { api } from "./api";
import { createCanvasFromMain } from "./canvas";

// -----------------------------------------------------------------------
// Global error traps — surface worker crashes to the main thread so it
// can tear down and report instead of hanging on a dead worker.
// -----------------------------------------------------------------------

self.addEventListener("error", (ev) => {
  console.error("[force-worker] Uncaught error:", ev.message);
});
self.addEventListener("unhandledrejection", (ev) => {
  console.error("[force-worker] Unhandled rejection:", ev.reason);
  self.postMessage({ type: "__ERROR__", message: String(ev.reason) });
});

// -----------------------------------------------------------------------
// 1. Expose the Comlink API surface.
// -----------------------------------------------------------------------

Comlink.expose(api);

// -----------------------------------------------------------------------
// 2. Raw message channel — handles one distinct message shape:
//    (a) { type: "__PING__" } — health check from the main thread.
// -----------------------------------------------------------------------

const ctx = self as unknown as Worker;

ctx.addEventListener("message", (ev: MessageEvent) => {
  const data = ev.data;
  if (!data || typeof data !== "object") return;

  switch (data.type) {
    case "__PING__": {
      ctx.postMessage({ type: "__PONG__" });
      break;
    }
    case "__SET_CANVAS__": {
      try {
        createCanvasFromMain(
          data.canvas as OffscreenCanvas,
          data.width as number,
          data.height as number,
          (data.dpr as number) ?? 1,
        );
      } catch (err) {
        self.postMessage({
          type: "__ERROR__",
          message: `Canvas init from main failed: ${String(err)}`,
        });
      }
      break;
    }
    default:
      // Comlink handles everything else internally.
      break;
  }
});

// -----------------------------------------------------------------------
// 3. Notify readiness so the main thread knows the worker booted.
// -----------------------------------------------------------------------

ctx.postMessage({ type: "__READY__" });
