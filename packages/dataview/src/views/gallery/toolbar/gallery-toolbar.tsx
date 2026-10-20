// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The gallery view's toolbar — its one control strip.
 *
 * Layout contract (same as every view): **configuration on the left, functions
 * on the right**, every control a button or a dropdown/popover panel. The
 * shell's 更多 menu is appended to the function group by `ViewToolbar`, so the
 * tab strip stays pure navigation.
 *
 * Left: 添加记录 (every view offers a way to create a record, and in a card wall
 * the record is the unit — so the button sits with the view's config, first),
 * 卡片配置 (the shared card menu the kanban draws too) and 布局. Right: nothing
 * but the shell's 更多 — the wall has no function of its own.
 *
 * The redesign cut three more things: the 字段 panel (a card's title / cover /
 * fields are now the shared 卡片配置), the 批量操作 button and the 导出 menu.
 * Selection is not a mode to switch on — it is Ctrl/Cmd-click, Shift-range,
 * Ctrl+A and Escape — and the one bulk action that needs a surface (删除选中)
 * lives on the right-click menu of a card that is selected. That also keeps the
 * function group free of a control whose width followed the selection count
 * (dataview/AGENTS.md § _UI conventions_).
 */
import { LayoutGrid, Plus } from "lucide-react";
import { Button } from "@workspace/ui/components/ui/button";
import { Separator } from "@workspace/ui/components/ui/separator";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/ui/toggle-group";
import type {
  DatabaseField,
  DataRow,
  DataViewSource,
  GalleryViewConfig,
} from "@workspace/interfaces";

import { CardConfigMenu } from "../../../shared/card-config";
import type { CardSettings } from "../../../shared/card-ops";
import { PanelSection, SettingsPanel } from "../../../shared/settings-panel";
import { ViewToolbar } from "../../../shared/view-toolbar";
import {
  GALLERY_CARD_SIZE_OPTIONS,
  GALLERY_LAYOUT_OPTIONS,
  resolveCardSize,
  resolveLayout,
} from "../core/config";

export interface GalleryToolbarProps {
  source: DataViewSource;
  config: GalleryViewConfig;
  /** The card half of the config, normalized (`readCardSettings`). */
  settings: CardSettings;
  /** The host allows view management → every config write needs this. */
  canConfigure: boolean;
  /** The host allows row inserts → 添加记录 is meaningful. */
  canInsert: boolean;
  /** The host allows schema writes → 卡片配置 offers field CRUD. */
  onConfigChange?: (config: GalleryViewConfig) => void;
  onFieldsChange?: (fields: DatabaseField[], rows?: DataRow[]) => void;
  /** The card settings patch, already merged into the view's config. */
  onSettingsChange?: (settings: CardSettings) => void;
  onAddRecord: () => void;
  className?: string;
}

export function GalleryToolbar({
  source,
  config,
  settings,
  canConfigure,
  canInsert,
  onConfigChange,
  onFieldsChange,
  onSettingsChange,
  onAddRecord,
  className,
}: GalleryToolbarProps) {
  const { t } = useI18n();

  const patch = (next: Partial<GalleryViewConfig>) =>
    onConfigChange?.({ ...config, ...next });

  const layout = resolveLayout(config.layout);
  const cardSize = resolveCardSize(config.cardSize);

  return (
    <ViewToolbar className={className}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!canInsert}
        onClick={onAddRecord}
        className="h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground"
      >
        <Plus className="size-3.5" />
        {t("添加记录")}{" "}
      </Button>

      {/* ——————— 卡片配置 ——————— */}
      <CardConfigMenu
        source={source}
        settings={settings}
        onChange={canConfigure ? onSettingsChange : undefined}
        onFieldsChange={onFieldsChange}
      />

      {/* ——————— 布局 ——————— */}
      <SettingsPanel
        label={t("布局")}
        icon={LayoutGrid}
        value={
          GALLERY_LAYOUT_OPTIONS.find((option) => option.value === layout)
            ?.label
        }
        disabled={!canConfigure}
      >
        <PanelSection label={t("排列方式")}>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={layout}
            disabled={!canConfigure}
            onValueChange={(next) => {
              if (!next) return;
              patch({ layout: next as GalleryViewConfig["layout"] });
            }}
          >
            {GALLERY_LAYOUT_OPTIONS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                className="h-7 px-2 text-xs"
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </PanelSection>
        <Separator />
        <PanelSection label={t("卡片尺寸")}>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={cardSize}
            disabled={!canConfigure}
            onValueChange={(next) => {
              if (!next) return;
              patch({ cardSize: next as GalleryViewConfig["cardSize"] });
            }}
          >
            {GALLERY_CARD_SIZE_OPTIONS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                className="h-7 px-2 text-xs"
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </PanelSection>
      </SettingsPanel>
    </ViewToolbar>
  );
}
