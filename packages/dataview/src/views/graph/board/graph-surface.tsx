// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The one place `@workspace/graph`'s `<Graph />` is mounted.
 *
 * It is `memo`-wrapped for the same reason the calendar and the gantt wrap their
 * library component: the shell re-renders for reasons that have nothing to do
 * with the graph (a toolbar popover opening, the host's own state), and every
 * such re-render would otherwise walk the library's tree — `Graph` subscribes to
 * the data store and rebuilds two wrapper callbacks per render.
 *
 * The `view` it receives is memoized by the shell and only its identity matters:
 * the same id keeps the running simulation, a changed object re-filters the
 * graph through `ForceGraph`'s `performFullSync`.
 *
 * Everything else about the graph — the worker, the canvas, the event handler,
 * selection, the context menu — is the library's, untouched (README §7: this
 * view is a wrapper, not a re-implementation).
 */
import { memo } from "react";
import { Graph } from "@workspace/graph";
import type { View } from "@workspace/interfaces";

export interface GraphSurfaceProps {
  /** The synthetic view built by `core/schema.ts` (stable per node + config). */
  view: View;
  className?: string;
}

export const GraphSurface = memo(function GraphSurface({
  view,
  className,
}: GraphSurfaceProps) {
  return <Graph view={view} className={className} />;
});
