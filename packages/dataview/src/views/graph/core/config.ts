// SPDX-License-Identifier: AGPL-3.0-only

import { translate } from "@workspace/ui/lib/i18n/runtime";
/**
 * The graph view's pure layer: which layout modes exist, which background styles
 * @workspace/graph actually draws, and how a persisted config self-heals.
 *
 * No React and no library import — `@workspace/graph` appears here only as the
 * shared `ViewType` / `VisualConfig` types, exactly like VChart's spec types
 * appear only as types in the chart view's `core/`.
 *
 * **Self-healing is the point of this file.** A view config outlives the schema
 * and the library it was written against, so `resolveGraphViewType` /
 * `resolveGraphBackgroundStyle` take whatever was persisted and return something
 * the renderer can draw (README §5.1).
 */
import type {
  FilterConfig,
  VisualConfig,
  ViewType,
} from "@workspace/interfaces";

import type { DataViewThemeTokens } from "../../../shared/theme-tokens";

/**
 * The layouts the 布局 panel offers.
 *
 * `Flow` is listed but **disabled**: it is a placeholder shell in
 * `@workspace/graph`, so it is not selectable — the panel says so instead of
 * hiding that a second layout is planned (the gantt's 周末 switch states its own
 * "only 日 granularity" the same way).
 */
export const GRAPH_LAYOUT_MODES: ReadonlyArray<{
  value: ViewType;
  label: string;
  disabled?: boolean;
}> = [
  {
    value: "Force",
    get label() {
      return translate("力导向");
    },
  },
  {
    value: "Flow",
    get label() {
      return translate("流程图");
    },
    disabled: true,
  },
];

/** Why 流程图 cannot be picked (the 布局 panel's hint). */
export const GRAPH_FLOW_UNAVAILABLE_HINT =
  "「流程图」布局在 @workspace/graph 里仍是占位壳，重建后即可切换。";

/**
 * The backgrounds `@workspace/graph`'s force renderer can paint.
 *
 * The graph's `VisualConfig` also types `snapToGrid` / `gridSpacing` /
 * `showMinimap`, but its force pipeline reads none of them — offering them would
 * be a control that does nothing, so the 视图 panel offers only these three.
 */
export const GRAPH_BACKGROUND_STYLES = [
  {
    value: "grid",
    get label() {
      return translate("网格");
    },
  },
  {
    value: "dots",
    get label() {
      return translate("点阵");
    },
  },
  {
    value: "none",
    get label() {
      return translate("无");
    },
  },
] as const;

export type GraphBackgroundStyle =
  (typeof GRAPH_BACKGROUND_STYLES)[number]["value"];

/** The layouts this view can actually mount today. */
const IMPLEMENTED_LAYOUTS: readonly ViewType[] = ["Force"];

/**
 * Resolves the persisted layout to one the view can mount.
 *
 * Anything the force pipeline cannot render — `Flow` today, and any future value
 * — falls back to `Force` rather than mounting the library's placeholder. A
 * config is never rewritten by this: the panel still shows what is stored, and
 * the day the flow rebuild lands this function starts honouring it.
 */
export function resolveGraphViewType(viewType: ViewType | undefined): ViewType {
  return viewType && IMPLEMENTED_LAYOUTS.includes(viewType)
    ? viewType
    : "Force";
}

/** Resolves a persisted background style; unknown values fall back to 网格. */
export function resolveGraphBackgroundStyle(
  visualConfig: VisualConfig | undefined,
): GraphBackgroundStyle {
  const style = visualConfig?.backgroundStyle;
  return GRAPH_BACKGROUND_STYLES.some((option) => option.value === style)
    ? (style as GraphBackgroundStyle)
    : "grid";
}

/**
 * The `VisualConfig` handed to `@workspace/graph`.
 *
 * A canvas is not a DOM node and cannot resolve `var(--token)`, so the
 * light/dark background and grid come from the shared theme tokens as literals —
 * the same mapping every other canvas view does (`shared/theme-tokens.ts`).
 * That fallback is why an unset colour needs no config rewrite on a theme
 * switch; a colour the user pinned (with or without `colorsSyncTheme`) is
 * resolved by the graph package's own `useViewColors` over these literals.
 *
 * A colour persisted by an older build (or set by hand) still wins, so nothing
 * a user configured is silently replaced.
 */
export function resolveGraphVisualConfig(
  visualConfig: VisualConfig | undefined,
  tokens: DataViewThemeTokens,
): VisualConfig {
  return {
    ...visualConfig,
    backgroundStyle: resolveGraphBackgroundStyle(visualConfig),
    backgroundColor: visualConfig?.backgroundColor ?? tokens.background,
    gridColor: visualConfig?.gridColor ?? tokens.border,
  };
}

/**
 * Whether the collection narrows the graph at all.
 *
 * A collection with neither an enumeration nor a rule is *global* — it projects
 * every node (`filterByViewFilterConfig`'s semantics, README §4.2) — so this is
 * what tells the empty state apart: "no nodes in this workspace" is a different
 * situation from "nothing matches the filter".
 */
export function hasActiveFilter(
  filterConfig: FilterConfig | undefined,
): boolean {
  return (
    (filterConfig?.selectedNodes?.length ?? 0) > 0 ||
    filterConfig?.ruleGroup !== undefined
  );
}
