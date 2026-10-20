// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The kanban view's toolbar — its one control strip.
 *
 * Layout contract (same as every view): **configuration on the left, functions
 * on the right**, every control a button or a dropdown/popover. The shell's 更多
 * menu is appended to the function group by `ViewToolbar`, so the tab strip
 * stays pure navigation — and since the board shows its own counts on the lanes
 * themselves, the function group holds nothing but 更多.
 *
 * The kanban has no `configEditor` in the registry: 分组 / 卡片配置 / 排序 are its
 * own panels and two of them are shared — the card half is the **shared 卡片配置**
 * menu (`shared/card-config.tsx`, the same control the gallery draws over the same
 * persisted `DataCardConfig`) and 排序 is the **shared condition menu**
 * (`shared/condition-menu.tsx`, the table's own 排序: `字段 + 方向` levels with
 * 添加条件). A settings panel is a `Popover` rather than a `DropdownMenu` because
 * its body is a *form* (a `Select`, a field list, switches) rather than a list of
 * commands.
 *
 * There is no 显示 panel any more: 泳道计数 / 允许拖拽 / 允许新建卡片 were three
 * switches whose defaults were always the right answer, so the board just behaves
 * like the default — the host's capabilities are the whole rule (see
 * `kanban-data-view.tsx`). Every trigger is neutral chrome.
 */
import { ArrowUpDown, Columns3 } from "lucide-react";
import { Separator } from "@workspace/ui/components/ui/separator";
import type {
  DatabaseField,
  DataRow,
  DataViewSource,
  KanbanViewConfig,
  TableCondition,
} from "@workspace/interfaces";

import { CardConfigMenu } from "../../../shared/card-config";
import type { CardSettings } from "../../../shared/card-ops";
import {
  ConditionMenu,
  conditionReadout,
} from "../../../shared/condition-menu";
import { FieldSelect } from "../../../shared/field-select";
import {
  PanelSection,
  SettingsPanel,
  SwitchRow,
} from "../../../shared/settings-panel";
import { ViewToolbar } from "../../../shared/view-toolbar";
import { groupableFields, resolveKanbanSort } from "../core/config";

export interface KanbanToolbarProps {
  source: DataViewSource;
  config: KanbanViewConfig;
  /** The card half of the config, normalized (`readCardSettings`). */
  settings: CardSettings;
  /** The host allows view-management → every config write needs this. */
  canConfigure: boolean;
  onConfigChange?: (config: KanbanViewConfig) => void;
  /** Schema write → 卡片配置 offers field CRUD (database hosts). */
  onFieldsChange?: (fields: DatabaseField[], rows?: DataRow[]) => void;
  onSettingsChange?: (settings: CardSettings) => void;
  className?: string;
}

export function KanbanToolbar({
  source,
  config,
  settings,
  canConfigure,
  onConfigChange,
  onFieldsChange,
  onSettingsChange,
  className,
}: KanbanToolbarProps) {
  const { t } = useI18n();

  const patch = (next: Partial<KanbanViewConfig>) =>
    onConfigChange?.({ ...config, ...next });

  const groupable = groupableFields(source.fields);
  const groupField =
    source.fields.find((field) => field.id === config.groupByField) ?? null;
  const sortConditions = resolveKanbanSort(source.fields, config);
  const sortReadout = conditionReadout(sortConditions, source.fields);

  const writeSortConditions = (next: TableCondition[]) =>
    patch({ sortState: next, sortBy: undefined });

  return (
    <ViewToolbar className={className}>
      {/* ——————— 分组 ——————— */}
      <SettingsPanel
        label={t("分组")}
        icon={Columns3}
        value={groupField?.name}
        disabled={!canConfigure}
      >
        <PanelSection
          label={t("分组字段")}
          hint={
            groupable.length === 0
              ? t("这张表还没有「单选」或「多选」字段，看板无法分列。")
              : undefined
          }
        >
          <FieldSelect
            fields={groupable}
            value={config.groupByField}
            placeholder={t("选择字段")}
            disabled={groupable.length === 0}
            onValueChange={(fieldId) =>
              // A different field has its own options, so a stale lane order
              // would be meaningless: reset it with the field.
              patch({ groupByField: fieldId, laneOrder: [] })
            }
          />
        </PanelSection>
        <Separator />
        <SwitchRow
          label={t("显示未分组")}
          checked={config.showUnassigned}
          onCheckedChange={(checked) => patch({ showUnassigned: checked })}
        />
      </SettingsPanel>

      {/* ——————— 卡片配置 ——————— */}
      <CardConfigMenu
        source={source}
        settings={settings}
        onChange={canConfigure ? onSettingsChange : undefined}
        onFieldsChange={onFieldsChange}
      />

      {/* ——————— 排序 ——————— */}
      {/* The table's own 排序 menu: the same trigger, the same `字段 + 方向`
          levels and 添加条件. A board only ever sorted by one field before, so
          the levels are the whole change — the cards keep this order inside
          every lane (`core/board.ts`). */}
      <ConditionMenu
        label={t("排序")}
        title={t("设置排序条件")}
        icon={ArrowUpDown}
        value={sortReadout}
        conditions={sortConditions}
        fields={source.fields}
        disabled={!canConfigure}
        onChange={writeSortConditions}
      />
    </ViewToolbar>
  );
}
