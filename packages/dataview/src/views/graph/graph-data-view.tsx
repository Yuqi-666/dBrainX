// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * Graph data view — a collection's nodes and edges drawn by `@workspace/graph`
 * (graph.md).
 *
 * This is the one view that **integrates an existing component instead of a
 * library**: `<Graph />` already owns the force simulation in a worker, the
 * `OffscreenCanvas` renderer, pan / zoom / drag, selection, the hover preview,
 * the canvas context menu, Alt-drag edge creation and position persistence. The
 * shell therefore owns exactly three things:
 *
 * - **the synthetic `View`** (`core/schema.ts`): the collection's `filterConfig`
 *   plus this view's config, memoized so its identity only changes when the
 *   graph really changes. A stable id matters — the library keys node positions
 *   by it;
 * - **the structure key** the library instance is keyed on, because a filter
 *   edit changes what is drawn without changing the view id (see below);
 * - **the guidance**: an empty collection is a different situation from a
 *   filter that matches nothing, and the view says which.
 *
 * It renders data and nothing else. The collection's **filter editor is the
 * host's**: `filterConfig` is the collection node's content, so the entry that
 * opens its editor sits in `collection-node-content.tsx`, next to the write path
 * — a view never asks a host to edit its content (README §3.4). Canvas gestures
 * write to the graph through the library's own handlers (README §8 — those are
 * graph operations, not collection ones).
 *
 * It consumes neither `fields` nor `rows`: a collection's rows *are* nodes, and
 * the library filters the data store itself.
 */
import { useMemo } from "react";
import { Network } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

import { DataViewEmptyState } from "../../shared/empty-state";
import { useDataViewThemeTokens } from "../../shared/theme-tokens";
import type {
  DataViewRendererProps,
  GraphViewConfig,
} from "../../source/types";
import { GraphSurface } from "./board/graph-surface";
import { hasActiveFilter } from "./core/config";
import { graphStructureKey, resolveGraphView } from "./core/schema";
import { GraphToolbar } from "./toolbar/graph-toolbar";

export function GraphDataView({
  source,
  config,
  onConfigChange,
  className,
}: DataViewRendererProps<GraphViewConfig>) {
  const { t } = useI18n();

  const tokens = useDataViewThemeTokens("auto");

  /**
   * The view handed to `@workspace/graph`.
   *
   * Every dependency is either a primitive or a value whose identity only
   * changes when the graph should be redrawn, because this object is what
   * `graphStructureKey` is derived from: a memo that re-ran on every host render
   * would remount the library (and restart its worker) constantly. The deps are
   * exactly the fields the `View` is built from — `source` itself is not one,
   * because the host rebuilds it whenever any of its rows change while only the
   * id, the name and the filter matter here.
   */
  const view = useMemo(
    () => resolveGraphView(source, config, tokens),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above: `source` is read for its nodeId / nodeTitle / filterConfig only.
    [
      source.nodeId,
      source.nodeTitle,
      source.filterConfig,
      config.viewType,
      config.visualConfig,
      tokens,
    ],
  );

  /**
   * The library instance is **keyed on the drawn structure** ("this view id,
   * this layout, this filter") — a filter edit has to rebuild it, because a live
   * `ForceGraph` only re-reads its data when the view *id* changes and its diff
   * path cannot remove a node the new filter excludes. `core/schema.ts`'s
   * `graphStructureKey` documents the measurement; a background change is not
   * part of it (that one is pushed in place).
   */
  const structureKey = graphStructureKey(view);

  const canConfigure = Boolean(onConfigChange);

  /**
   * Nothing to draw. The rows are the collection's projection, so an empty
   * projection means the library would have no node to render — and an empty
   * canvas would not say *why* it is empty.
   */
  const guidance =
    source.rows.length > 0
      ? null
      : hasActiveFilter(source.filterConfig)
        ? {
            title: t("没有节点匹配当前的过滤条件"),
            description: t(
              "节点图画的是这个 collection 筛选出的子图，当前条件没有选中任何节点。",
            ),
          }
        : {
            title: t("这个工作区还没有节点"),
            description: t(
              "节点图画的是图谱里的节点与连边，先创建一些节点再回到这个视图。",
            ),
          };

  return (
    <div
      data-dataview-graph
      className={cn(
        // The shell's renderer box never scrolls; this view clips itself.
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background",
        className,
      )}
    >
      <GraphToolbar
        config={config}
        canConfigure={canConfigure}
        onConfigChange={onConfigChange}
      />

      {/**
       * The canvas box: a definite height is load-bearing — `<Graph />` fills
       * `100%` of its parent and an `OffscreenCanvas` sized from a zero-height
       * box draws nothing (graph.md §0).
       */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {guidance ? (
          <DataViewEmptyState
            icon={Network}
            title={guidance.title}
            description={guidance.description}
            className="absolute inset-0"
          />
        ) : (
          <GraphSurface
            key={structureKey}
            view={view}
            className="h-full w-full"
          />
        )}
      </div>
    </div>
  );
}
