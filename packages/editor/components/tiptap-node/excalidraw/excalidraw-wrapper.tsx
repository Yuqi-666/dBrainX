// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { lazy, Suspense, useSyncExternalStore } from "react";
import "@excalidraw/excalidraw/index.css";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

// This shared editor works in both Next.js and the desktop static bundle.
// Excalidraw reads browser globals; load it only after client hydration.
const Excalidraw = lazy(async () => ({
  default: (await import("@excalidraw/excalidraw")).Excalidraw,
}));
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function ExcalidrawWrapper(props: {
  excalidrawAPI: (api: ExcalidrawImperativeAPI) => void;
  initialData: ExcalidrawInitialDataState;
}) {
  const mounted = useSyncExternalStore(
    subscribe,
    clientSnapshot,
    serverSnapshot,
  );
  return (
    <div style={{ width: "100%", height: "100%", display: "flex" }}>
      {mounted && (
        <Suspense fallback={null}>
          <Excalidraw {...props} />
        </Suspense>
      )}
    </div>
  );
}
