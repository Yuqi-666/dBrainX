// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The gantt view's toolbar — its one control strip.
 *
 * Layout contract (same as every view): **configuration on the left, functions
 * on the right**, every control a button or a popover panel. The shell's 更多
 * menu is appended to the function group by `ViewToolbar`, so the tab strip
 * stays pure navigation — and a timeline states its own extent (the axis does),
 * so the function group holds only 更多.
 *
 * The gantt has **no** `configEditor` in the registry: 字段配置 / 视图 cover every
 * key of `GanttViewConfig` a user can decide. There is no 显示 panel and no
 * write-permission switch — dragging needs cell writes, so the host decides
 * (`gantt-data-view.tsx` derives it), and the rest of the presentation is fixed
 * in `core/config.ts` (`GANTT_FIXED`).
 *
 * **字段配置 is the table's field list, not five dropdowns.** A gantt field is a
 * *role* (开始日期 / 结束日期 / 标题 / 进度 / 分组) plus "show it in the hover
 * readout", so the panel is the shared `FieldConfigList`
 * (`shared/field-config-list.tsx`) — the same search box, icon rows, visibility
 * eye, per-field "…" menu and 新增字段 footer the table's and the calendar's
 * 字段配置 use. Roles are config items above the list; a row only **annotates**
 * the role it holds (开始 / 结束 / 标题 / 进度 / 分组), so one role is always set
 * the same way, in the same place, in every view.
 *
 * 视图 keeps the decisions the view really has: 表头 (what the task list's column
 * is called — empty means "the node's own name", see `core/config.ts`), 时间粒度,
 * 行高, 今日线 and 周末. 周末 only means something on a day-granularity axis (a 周
 * or 月 column contains both), so it says so instead of silently doing nothing.
 */
import { useRef } from "react";
import { ChartGantt, FolderTree } from "lucide-react";
import { Input } from "@workspace/ui/components/ui/input";
import { Separator } from "@workspace/ui/components/ui/separator";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/ui/toggle-group";
import type {
  DatabaseField,
  DataRow,
  DataViewSource,
  GanttViewConfig,
} from "@workspace/interfaces";

import {
  FieldConfigList,
  type FieldConfigRow,
} from "../../../shared/field-config-list";
import type { FieldEditResult } from "../../../shared/field-editor";
import { FieldSelect } from "../../../shared/field-select";
import {
  PanelSection,
  SettingsPanel,
  SwitchRow,
} from "../../../shared/settings-panel";
import { ViewToolbar } from "../../../shared/view-toolbar";
import { deleteFieldSchema, editFieldSchema } from "../../../source/row-utils";
import {
  GANTT_ROW_HEIGHTS,
  GANTT_VIEW_MODES,
  resolveEndField,
  resolveGroupField,
  resolveProgressField,
  resolveStartField,
  resolveTaskColumnTitle,
  resolveTitleField,
} from "../core/config";

/**
 * The 表头 box: reports on blur / Enter, not on every keystroke.
 *
 * The value it writes is a view config, and the host persists that as a whole
 * view (an upsert per keystroke otherwise). Empty is a real value — "name the set
 * after the node" — and the placeholder states what that name currently is, so
 * clearing the box needs no instruction next to it.
 *
 * Escape drops the draft: the popover closes with it and the input never blurs.
 */
function TaskColumnTitleInput({
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  value: string;
  placeholder: string;
  disabled?: boolean;
  onCommit: (next: string) => void;
}) {
  const { t } = useI18n();

  const ref = useRef<HTMLInputElement>(null);

  return (
    <Input
      ref={ref}
      defaultValue={value}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={t("表头名称")}
      className="h-7 text-xs md:text-xs"
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          ref.current?.blur();
        }
        if (event.key === "Escape") {
          if (ref.current) ref.current.value = value;
          ref.current?.blur();
        }
      }}
      onBlur={(event) => {
        const next = event.target.value;
        if (next !== value) onCommit(next);
      }}
    />
  );
}

export interface GanttToolbarProps {
  source: DataViewSource;
  /** The host allows view management → every config write needs this. */
  canConfigure: boolean;
  /** Every `date` field in the schema (for the missing-field guidance). */
  dateFields: readonly DatabaseField[];
  /** Every `number` field (progress). */
  numberFields: readonly DatabaseField[];
  /** Every 单选/多选 field (grouping). */
  groupableFields: readonly DatabaseField[];
  config: GanttViewConfig;
  onConfigChange?: (config: GanttViewConfig) => void;
  /** Schema write → 字段配置 offers field CRUD (database hosts). */
  onFieldsChange?: (fields: DatabaseField[], rows?: DataRow[]) => void;
  className?: string;
}

export function GanttToolbar({
  source,
  canConfigure,
  dateFields,
  numberFields,
  groupableFields,
  config,
  onConfigChange,
  onFieldsChange,
  className,
}: GanttToolbarProps) {
  const { t } = useI18n();

  const patch = (next: Partial<GanttViewConfig>) =>
    onConfigChange?.({ ...config, ...next });

  const startField = resolveStartField(source.fields, config.startField);
  const endField = resolveEndField(
    source.fields,
    config.endField,
    config.startField,
  );
  const titleField = resolveTitleField(source.fields, config.titleField);
  const progressField = resolveProgressField(
    source.fields,
    config.progressField,
  );
  const groupField = resolveGroupField(source.fields, config.groupByField);

  const canEditFields = canConfigure && Boolean(onFieldsChange);

  /**
   * The role a field currently holds, shown as the row's annotation. **The rows
   * only annotate** — every role is set from its own config item above the list.
   * A field can hold several roles (a date field is often also the title), so the
   * row states the strongest one in role order.
   */
  const roleBadge = (field: DatabaseField): string | undefined => {
    if (field.id === startField?.id) return t("开始");
    if (field.id === endField?.id) return t("结束");
    if (field.id === titleField?.id) return t("标题");
    if (field.id === progressField?.id) return t("进度");
    if (field.id === groupField?.id) return t("分组");
    return undefined;
  };

  const rows: FieldConfigRow[] = source.fields.map((field) => ({
    field,
    // The eye is 悬浮提示 membership: which extra fields the hover readout
    // shows.
    visible: (config.tooltipFields ?? []).includes(field.id),
    locked: field.id === startField?.id,
    badge: roleBadge(field),
  }));

  /**
   * 新增字段 / 编辑字段: the schema write, plus this view's config — a deleted
   * field must not stay a role, and a newly created date / number / 单选 field
   * takes over the role the view is still missing (otherwise the gantt keeps
   * asking for a field the user has just created).
   */
  const handleSubmitField = (result: FieldEditResult, isNew: boolean) => {
    if (!canEditFields) return;
    const schema = editFieldSchema(
      source.fields,
      source.rows,
      result.field,
      result.seed ? { fieldId: result.field.id, cell: result.seed } : undefined,
    );
    onFieldsChange?.(schema.fields, schema.rows);
    if (!isNew) return;
    if (result.field.type === "date" && !config.startField) {
      patch({ startField: result.field.id });
    } else if (result.field.type === "number" && !config.progressField) {
      patch({ progressField: result.field.id });
    } else if (
      (result.field.type === "select" || result.field.type === "multiSelect") &&
      !config.groupByField
    ) {
      patch({ groupByField: result.field.id });
    } else if (!config.titleField) {
      patch({ titleField: result.field.id });
    }
  };

  const handleDeleteField = (field: DatabaseField) => {
    if (!canEditFields) return;
    const schema = deleteFieldSchema(source.fields, source.rows, field.id);
    onFieldsChange?.(schema.fields, schema.rows);

    const heldRole =
      config.startField === field.id ||
      config.endField === field.id ||
      config.titleField === field.id ||
      config.progressField === field.id ||
      config.groupByField === field.id ||
      (config.tooltipFields ?? []).includes(field.id);
    if (heldRole) {
      patch({
        startField: config.startField === field.id ? "" : config.startField,
        endField: config.endField === field.id ? undefined : config.endField,
        titleField: config.titleField === field.id ? "" : config.titleField,
        progressField:
          config.progressField === field.id ? undefined : config.progressField,
        groupByField:
          config.groupByField === field.id ? undefined : config.groupByField,
        tooltipFields: (config.tooltipFields ?? []).filter(
          (fieldId) => fieldId !== field.id,
        ),
      });
    }
  };

  return (
    <ViewToolbar className={className}>
      {/* ——————— 字段配置 ——————— */}
      <SettingsPanel
        label={t("字段配置")}
        icon={FolderTree}
        width="w-80"
        disabled={!canConfigure}
      >
        <PanelSection
          label={t("开始日期")}
          hint={
            dateFields.length === 0
              ? t("这张表还没有「日期」字段，甘特图无法定位任务。")
              : undefined
          }
        >
          <FieldSelect
            fields={dateFields}
            value={startField?.id ?? ""}
            placeholder={t("选择字段")}
            disabled={!canConfigure || dateFields.length === 0}
            onValueChange={(fieldId) =>
              patch({
                startField: fieldId,
                // The old end may now equal the new start; the resolver drops
                // it, but clearing it keeps the config honest.
                endField:
                  config.endField === fieldId ? undefined : config.endField,
              })
            }
          />
        </PanelSection>

        <PanelSection label={t("结束日期")}>
          <FieldSelect
            fields={dateFields.filter((field) => field.id !== startField?.id)}
            value={endField?.id ?? ""}
            placeholder={t("单日")}
            noneLabel={t("单日")}
            disabled={!canConfigure || dateFields.length < 2}
            onValueChange={(fieldId) =>
              patch({ endField: fieldId || undefined })
            }
          />
        </PanelSection>

        <Separator />

        <PanelSection label={t("标题")}>
          <FieldSelect
            fields={source.fields}
            value={titleField?.id ?? ""}
            placeholder={t("选择字段")}
            disabled={!canConfigure}
            onValueChange={(fieldId) =>
              patch({ titleField: fieldId || undefined })
            }
          />
        </PanelSection>

        <PanelSection
          label={t("进度")}
          hint={
            numberFields.length === 0
              ? t("需要一个「数字」字段（取值 0–1），条形才会填充进度。")
              : undefined
          }
        >
          <FieldSelect
            fields={numberFields}
            value={progressField?.id ?? ""}
            placeholder={t("不显示进度")}
            noneLabel={t("不显示进度")}
            disabled={!canConfigure || numberFields.length === 0}
            onValueChange={(fieldId) =>
              patch({ progressField: fieldId || undefined })
            }
          />
        </PanelSection>

        <PanelSection
          label={t("分组")}
          hint={
            groupableFields.length === 0
              ? t("需要一个「单选」或「多选」字段，才能按它分组。")
              : undefined
          }
        >
          <FieldSelect
            fields={groupableFields}
            value={groupField?.id ?? ""}
            placeholder={t("不分组")}
            noneLabel={t("不分组")}
            disabled={!canConfigure || groupableFields.length === 0}
            onValueChange={(fieldId) =>
              patch({ groupByField: fieldId || undefined })
            }
          />
        </PanelSection>

        <Separator />

        <PanelSection label={t("字段")}>
          <FieldConfigList
            fields={source.fields}
            rows={rows}
            searchPlaceholder={t("搜索字段")}
            onToggleVisible={
              canConfigure
                ? (field, visible) => {
                    const current = config.tooltipFields ?? [];
                    patch({
                      tooltipFields: visible
                        ? [...current, field.id]
                        : current.filter((fieldId) => fieldId !== field.id),
                    });
                  }
                : undefined
            }
            onSubmitField={canEditFields ? handleSubmitField : undefined}
            onDeleteField={canEditFields ? handleDeleteField : undefined}
          />
        </PanelSection>
      </SettingsPanel>

      {/* ——————— 视图 ——————— */}
      <SettingsPanel
        label={t("视图")}
        icon={ChartGantt}
        value={
          GANTT_VIEW_MODES.find((mode) => mode.value === config.viewMode)?.label
        }
        disabled={!canConfigure}
      >
        <PanelSection label={t("表头")}>
          {/**
           * The task list's column title. The default is the node this view lives
           * in (`DataViewSource.nodeTitle`), which is why the placeholder is not
           * the literal 任务: an empty box means "follow the node", and the node
           * is named in the editor this view is embedded in.
           */}
          <TaskColumnTitleInput
            value={config.taskColumnTitle ?? ""}
            placeholder={resolveTaskColumnTitle(undefined, source.nodeTitle)}
            disabled={!canConfigure}
            onCommit={(next) =>
              patch({ taskColumnTitle: next.trim() || undefined })
            }
          />
        </PanelSection>
        <Separator />
        <PanelSection label={t("时间粒度")}>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={config.viewMode}
            disabled={!canConfigure}
            onValueChange={(next) => {
              if (!next) return;
              patch({ viewMode: next as GanttViewConfig["viewMode"] });
            }}
          >
            {GANTT_VIEW_MODES.map((mode) => (
              <ToggleGroupItem
                key={mode.value}
                value={mode.value}
                className="h-7 px-2 text-xs"
              >
                {mode.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </PanelSection>
        <Separator />
        <PanelSection label={t("行高")}>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={String(config.rowHeight)}
            disabled={!canConfigure}
            onValueChange={(next) => {
              if (!next) return;
              patch({ rowHeight: Number(next) });
            }}
          >
            {GANTT_ROW_HEIGHTS.map((height) => (
              <ToggleGroupItem
                key={height.value}
                value={String(height.value)}
                className="h-7 px-2 text-xs"
              >
                {height.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </PanelSection>
        <Separator />
        <SwitchRow
          label={t("今日线")}
          checked={config.showTodayLine}
          disabled={!canConfigure}
          onCheckedChange={(checked) => patch({ showTodayLine: checked })}
        />
        <SwitchRow
          label={t("周末")}
          hint={
            config.viewMode === "day"
              ? undefined
              : t("只有「日」粒度的时间轴有周末列。")
          }
          checked={config.showWeekends}
          disabled={!canConfigure || config.viewMode !== "day"}
          onCheckedChange={(checked) => patch({ showWeekends: checked })}
        />
      </SettingsPanel>
    </ViewToolbar>
  );
}
