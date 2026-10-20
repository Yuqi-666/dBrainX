// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The graph view's toolbar — its one control strip.
 *
 * Layout contract (same as every view): **configuration on the left, functions
 * on the right**, every control a button or a popover panel. The shell's 更多
 * menu is appended to the function group by `ViewToolbar`, so the tab strip stays
 * pure navigation.
 *
 * Left: 布局 (the two layouts `@workspace/graph` knows, with 流程图 disabled while
 * its implementation is a placeholder shell), 视图 (the three backgrounds the
 * force renderer really paints, plus the background / grid colours and the
 * 与主题同步 toggle) and 节点密度 (the force layout's boundary density, the same
 * preference the graph page's own header exposes). Right: nothing but the
 * shell's 更多 — the graph states its own extent on the canvas, so there is no
 * readout to carry.
 *
 * The collection's filter is deliberately **not** here: it is the node content's,
 * not this view's config, and its entry lives in `collection-node-content.tsx`
 * beside the write path (see `graph-data-view.tsx`). Everything on this strip is
 * `GraphViewConfig`.
 */
import { LayoutGrid, RadiusIcon, Waypoints } from "lucide-react";
import { ColorPicker } from "@workspace/ui/components/selector/color-picker";
import { Slider } from "@workspace/ui/components/ui/slider";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/ui/toggle-group";
import { useViewColors } from "@workspace/ui/hooks/use-view-colors";
import {
  resolveGridThemeColor,
  resolveThemeColor,
} from "@workspace/ui/lib/color-palette";
import type { GraphViewConfig, VisualConfig } from "@workspace/interfaces";

import {
  PanelSection,
  SettingsPanel,
  SwitchRow,
} from "../../../shared/settings-panel";
import { useDataViewThemeTokens } from "../../../shared/theme-tokens";
import { ViewToolbar } from "../../../shared/view-toolbar";
import {
  GRAPH_BACKGROUND_STYLES,
  GRAPH_FLOW_UNAVAILABLE_HINT,
  GRAPH_LAYOUT_MODES,
  resolveGraphBackgroundStyle,
  resolveGraphViewType,
} from "../core/config";
import {
  DENSITY_SLIDER_STEPS,
  NODE_DENSITY,
  densityScaleLabel,
  densityToPosition,
  positionToDensity,
} from "./node-density";

export interface GraphToolbarProps {
  config: GraphViewConfig;
  /** The host allows view management → every config write needs this. */
  canConfigure: boolean;
  onConfigChange?: (config: GraphViewConfig) => void;
  className?: string;
}

export function GraphToolbar({
  config,
  canConfigure,
  onConfigChange,
  className,
}: GraphToolbarProps) {
  const { t } = useI18n();

  const patch = (next: Partial<GraphViewConfig>) =>
    onConfigChange?.({ ...config, ...next });

  const patchVisual = (updates: Partial<VisualConfig>) =>
    patch({ visualConfig: { ...config.visualConfig, ...updates } });

  const viewType = resolveGraphViewType(config.viewType);
  const backgroundStyle = resolveGraphBackgroundStyle(config.visualConfig);

  /**
   * The colours actually drawn. `useViewColors` is the graph package's own
   * resolver (it reaches the canvas through `<Graph>`), so the swatches show
   * what the renderer shows. This view's theme tokens pre-fill the unset case
   * rather than the hook's generic defaults, to match `core/config.ts`.
   */
  const tokens = useDataViewThemeTokens("auto");
  const { backgroundColor, gridColor, colorsSyncTheme, theme } = useViewColors({
    ...config.visualConfig,
    backgroundColor: config.visualConfig.backgroundColor ?? tokens.background,
    gridColor: config.visualConfig.gridColor ?? tokens.border,
  });

  /** 与主题同步: pin both colours to the current theme, like the graph header. */
  const handleThemeSyncChange = (checked: boolean) => {
    patchVisual({
      colorsSyncTheme: checked,
      backgroundColor:
        checked && theme
          ? resolveThemeColor(
              config.visualConfig.backgroundColor ?? tokens.background,
              theme,
            )
          : config.visualConfig.backgroundColor,
      gridColor:
        checked && theme
          ? resolveGridThemeColor(
              config.visualConfig.gridColor ?? tokens.border,
              theme,
            )
          : config.visualConfig.gridColor,
    });
  };

  /** 未设置时滑杆停在渲染器的默认密度上。 */
  const nodeDensity = config.visualConfig.nodeDensity ?? NODE_DENSITY.default;
  const densityPosition = densityToPosition(nodeDensity);

  return (
    <ViewToolbar className={className}>
      {/* ——————— 布局 ——————— */}
      <SettingsPanel
        label={t("布局")}
        icon={Waypoints}
        value={
          GRAPH_LAYOUT_MODES.find((mode) => mode.value === viewType)?.label
        }
        disabled={!canConfigure}
      >
        <PanelSection
          label={t("布局模式")}
          hint={t(GRAPH_FLOW_UNAVAILABLE_HINT)}
        >
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={viewType}
            disabled={!canConfigure}
            onValueChange={(next) => {
              if (!next) return;
              patch({ viewType: next as GraphViewConfig["viewType"] });
            }}
          >
            {GRAPH_LAYOUT_MODES.map((mode) => (
              <ToggleGroupItem
                key={mode.value}
                value={mode.value}
                disabled={mode.disabled}
                className="h-7 px-2 text-xs"
              >
                {mode.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </PanelSection>
      </SettingsPanel>

      {/* ——————— 视图 ——————— */}
      <SettingsPanel
        label={t("视图")}
        icon={LayoutGrid}
        value={
          GRAPH_BACKGROUND_STYLES.find(
            (style) => style.value === backgroundStyle,
          )?.label
        }
        disabled={!canConfigure}
      >
        <PanelSection label={t("背景样式")}>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={backgroundStyle}
            disabled={!canConfigure}
            onValueChange={(next) => {
              if (!next) return;
              patchVisual({
                backgroundStyle: next as NonNullable<
                  GraphViewConfig["visualConfig"]["backgroundStyle"]
                >,
              });
            }}
          >
            {GRAPH_BACKGROUND_STYLES.map((style) => (
              <ToggleGroupItem
                key={style.value}
                value={style.value}
                className="h-7 px-2 text-xs"
              >
                {style.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </PanelSection>

        <PanelSection label={t("背景颜色")}>
          <ColorPicker
            value={backgroundColor}
            onChange={(color) =>
              patchVisual({
                backgroundColor:
                  colorsSyncTheme && theme
                    ? resolveThemeColor(color, theme)
                    : color,
              })
            }
            disabled={!canConfigure}
            aria-label={t("背景颜色")}
            className="p-0"
          />
        </PanelSection>

        <PanelSection label={t("网格颜色")}>
          <ColorPicker
            value={gridColor}
            onChange={(color) =>
              patchVisual({
                gridColor:
                  colorsSyncTheme && theme
                    ? resolveGridThemeColor(color, theme)
                    : color,
              })
            }
            onClear={() => patchVisual({ gridColor: undefined })}
            clearLabel={t("默认颜色")}
            disabled={!canConfigure}
            aria-label={t("网格颜色")}
            className="p-0"
          />
        </PanelSection>

        <SwitchRow
          label={t("与主题同步")}
          checked={colorsSyncTheme}
          disabled={!canConfigure}
          onCheckedChange={handleThemeSyncChange}
        />
      </SettingsPanel>

      {/* ——————— 节点密度 ——————— */}
      <SettingsPanel
        label={t("节点密度")}
        icon={RadiusIcon}
        value={densityScaleLabel(nodeDensity)}
        disabled={!canConfigure}
      >
        <PanelSection label={t("节点密度")} hint={t("仅「力导向」布局生效")}>
          <div className="px-1 py-1.5">
            <div className="mb-1 text-center text-xs text-muted-foreground">
              {densityScaleLabel(nodeDensity)}
            </div>
            <Slider
              aria-label={t("节点密度")}
              min={0}
              max={DENSITY_SLIDER_STEPS}
              step={1}
              value={[densityPosition]}
              disabled={!canConfigure}
              onValueChange={([position]) => {
                if (position === undefined) return;
                patchVisual({ nodeDensity: positionToDensity(position) });
              }}
              className="min-h-7"
            />
          </div>
        </PanelSection>
      </SettingsPanel>
    </ViewToolbar>
  );
}
