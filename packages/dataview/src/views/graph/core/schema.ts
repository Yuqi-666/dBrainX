// SPDX-License-Identifier: AGPL-3.0-only

import { translate } from "@workspace/ui/lib/i18n/runtime";
/**
 * The graph view's data mapping: the *normalized source + this view's config*
 * become the one thing `@workspace/graph` consumes — a throwaway `View`.
 *
 * That is the whole trick of this view, and it is why the file is so small: a
 * collection's rows are graph nodes, so there is no per-row projection to build.
 * The library filters the workspace's own nodes and edges with the view's
 * `filterConfig`, and rows / fields are never read at all (see
 * `docs/dataview/graph.md` §3).
 */
import type {
  DataViewSource,
  GraphViewConfig,
  View,
} from "@workspace/interfaces";

import type { DataViewThemeTokens } from "../../../shared/theme-tokens";
import { resolveGraphViewType, resolveGraphVisualConfig } from "./config";

/**
 * The throwaway view's id.
 *
 * Two things make it load-bearing:
 *
 * 1. **It must be stable.** `@workspace/graph` reads and writes node positions
 *    under `stateData.client.position[viewId]`, so a fresh id per render would
 *    throw the layout away on every re-render and litter every node's state with
 *    one entry per frame. It is derived from the host node, so the same
 *    collection always seeds the same layout.
 * 2. **It must not collide with a persisted workspace view.** The `dataview:`
 *    namespace keeps a synthetic id out of the id space real views live in, so a
 *    position stored for an embedded graph can never be mistaken for a
 *    workspace view's layout.
 */
export function graphViewId(nodeId: string | undefined): string {
  return `dataview:graph:${nodeId ?? "collection"}`;
}

export interface BuildGraphViewInput {
  source: DataViewSource;
  /** The resolved layout (`core/config.ts`). */
  viewType: View["viewType"];
  /** The resolved visual config (`core/config.ts`, theme tokens applied). */
  visualConfig: View["visualConfig"];
}

/** Builds the synthetic `View` handed to `<Graph view={…} />`. */
export function buildGraphView({
  source,
  viewType,
  visualConfig,
}: BuildGraphViewInput): View {
  return {
    id: graphViewId(source.nodeId),
    // The graph's internal view name follows the **collection node**, like the
    // gantt's 表头: it names the set, and the set is the node. The tab already
    // names the view itself, so no config key duplicates this.
    name: source.nodeTitle?.trim() || translate("节点图"),
    viewType,
    visualConfig,
    // The collection's filter, passed through untouched: the library applies it
    // (README §4.2), and this view must not hold a second copy — the collection's
    // content is its only writer.
    filterConfig: source.filterConfig ?? {},
  };
}

/** Convenience wrapper: source + config + theme tokens → the `View`. */
export function resolveGraphView(
  source: DataViewSource,
  config: GraphViewConfig,
  tokens: DataViewThemeTokens,
): View {
  return buildGraphView({
    source,
    viewType: resolveGraphViewType(config.viewType),
    visualConfig: resolveGraphVisualConfig(config.visualConfig, tokens),
  });
}

/**
 * What the mounted `<Graph />` is keyed on — i.e. **when the library has to be
 * rebuilt rather than updated**.
 *
 * This is load-bearing, not an optimisation. `ForceGraph` re-reads the whole
 * node / edge set only when the *view id* changes; a changed `View` object with
 * the same id merely updates its style and its diff predicate. A different
 * `filterConfig` is therefore invisible to a live instance — and its diff path
 * can only add or update, so a node that the new filter excludes is never taken
 * off the canvas. Measured in a browser: 14 nodes → a filter selecting 4 → the
 * canvas kept drawing all 14 until the view was remounted.
 *
 * The id is the *stable* one (`graphViewId`) precisely so a remount after a
 * filter edit re-reads the positions the previous instance persisted under that
 * id — the layout survives, only the pipeline is rebuilt.
 *
 * `visualConfig` is deliberately **not** part of the key: a background or theme
 * change is pushed to the running instance (`updateStyle`) and must not restart
 * the simulation. Same shape as the chart's `structureKey` and the gantt's
 * `structureKey`: data changes update in place, structure changes remount.
 */
export function graphStructureKey(view: View): string {
  return [
    view.id,
    view.viewType,
    // Key order is whatever the editor wrote; equal filters stringify equally.
    JSON.stringify(view.filterConfig ?? {}),
  ].join("|");
}
