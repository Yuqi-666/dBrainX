// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The calendar view's toolbar — its one control strip.
 *
 * Layout contract (same as every view): **configuration on the left, functions
 * on the right**, every control a button or a popover panel. The shell's 更多
 * menu is appended to the function group by `ViewToolbar`, so the tab strip
 * stays pure navigation — and the event count lives on the calendar itself
 * (every day cell shows its events), so the function group holds only 更多.
 *
 * The calendar has no `configEditor` in the registry: 字段配置 / 视图 cover every
 * key of `CalendarViewConfig` a user can decide. There is no 交互 panel and no
 * 显示 panel any more — how much may be written is the host's capability
 * (dragging needs cell writes, creating a row needs row inserts) and the
 * presentation is the fixed default set in `core/config.ts`
 * (`CALENDAR_FIXED`), so both panels were switches whose default was always the
 * answer.
 *
 * **字段配置 is the table's field list, not four dropdowns.** A calendar field is
 * a *role* (开始日期 / 结束日期 / 标题 / 颜色) plus "show it in the hover readout",
 * so the panel is the shared `FieldConfigList`
 * (`shared/field-config-list.tsx`) — the same search box, type-icon rows,
 * visibility eye, per-field "…" menu and 新增字段 footer the table's 字段配置
 * uses — with the roles as this view's own "…" items. That also gives the
 * calendar field CRUD for free, which the four pickers never had. Its trigger is
 * the table's: `[FolderTree] 字段配置`, neutral, with no value readout.
 *
 * **Roles are config items; the field list is the fields.** 开始日期 / 结束日期 /
 * 标题 / 颜色 are four labelled `PanelSection`s with a `FieldSelect` each, and the
 * list below only carries the eye (悬浮提示 membership) plus the shared
 * 编辑字段 / 删除字段 / 新增字段 tail. A role is **never** set from a field row's
 * "…" menu — the rows annotate the role a field holds (行尾的 开始 / 结束 / 标题 /
 * 颜色 注解，开始日期带锁), which is how the mapping stays readable at a glance.
 * The same "one config item per role" shape is what the kanban's and the gallery's
 * 卡片配置 use for 标题 / 封面.
 *
 * 视图 keeps the two decisions the panel still owns — which view buttons appear
 * and 一周起始. The 今天 button is **fixed chrome** (`prev,next today`): its switch
 * was one more option whose default was the only right answer, so it is normalized
 * into the toolbar the surface gets rather than configured (`core/config.ts`).
 *
 * Each panel is a `Popover` rather than a `DropdownMenu` because its body is a
 * *form* (selects, a field list, toggles) rather than a list of commands. No panel
 * carries a caption, and the only prose left is the guidance a control needs when
 * it cannot work (no date field, no select field to colour by).
 */
import { CalendarDays, FolderTree } from "lucide-react";
import { Separator } from "@workspace/ui/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/ui/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/ui/toggle-group";
import type {
  CalendarViewConfig,
  DatabaseField,
  DataRow,
  DataViewSource,
} from "@workspace/interfaces";

import {
  FieldConfigList,
  type FieldConfigRow,
} from "../../../shared/field-config-list";
import type { FieldEditResult } from "../../../shared/field-editor";
import { FieldSelect } from "../../../shared/field-select";
import {
  CheckboxOptionList,
  PanelSection,
  SettingsPanel,
} from "../../../shared/settings-panel";
import { ViewToolbar } from "../../../shared/view-toolbar";
import { deleteFieldSchema, editFieldSchema } from "../../../source/row-utils";
import {
  CALENDAR_VIEW_OPTIONS,
  colorableFields,
  readCalendarToolbarLayout,
  resolveColorField,
  resolveEndField,
  resolveStartField,
  resolveTitleField,
  writeCalendarToolbarLayout,
} from "../core/config";

/** Week-start choices; FullCalendar numbers days from Sunday. */
const FIRST_DAY_OPTIONS = [
  {
    value: 1,
    get label() {
      return translate("周一");
    },
  },
  {
    value: 0,
    get label() {
      return translate("周日");
    },
  },
  {
    value: 6,
    get label() {
      return translate("周六");
    },
  },
];

export interface CalendarToolbarProps {
  source: DataViewSource;
  /** The host allows view management → every config write needs this. */
  canConfigure: boolean;
  /** Every `date` field in the schema (for the missing-field guidance). */
  dateFields: readonly DatabaseField[];
  config: CalendarViewConfig;
  onConfigChange?: (config: CalendarViewConfig) => void;
  /** Schema write → 字段配置 offers field CRUD (database hosts). */
  onFieldsChange?: (fields: DatabaseField[], rows?: DataRow[]) => void;
  className?: string;
}

export function CalendarToolbar({
  source,
  canConfigure,
  dateFields,
  config,
  onConfigChange,
  onFieldsChange,
  className,
}: CalendarToolbarProps) {
  const { t } = useI18n();

  const patch = (next: Partial<CalendarViewConfig>) =>
    onConfigChange?.({ ...config, ...next });

  const startField = resolveStartField(source.fields, config.startField);
  const endField = resolveEndField(
    source.fields,
    config.endField,
    config.startField,
  );
  const titleField = resolveTitleField(source.fields, config.titleField);
  const colorChoices = colorableFields(source.fields);
  const colorField = resolveColorField(source.fields, config.colorField);

  const layout = readCalendarToolbarLayout(config.headerToolbar);

  const canEditFields = canConfigure && Boolean(onFieldsChange);

  /**
   * The role a field currently holds, shown as the row's annotation. **The rows
   * only annotate** — every role is set from its own config item above the list
   * (开始日期 / 结束日期 / 标题 / 颜色), like the kanban's and the gallery's
   * 卡片配置. A field can hold several roles (a date field is often also the
   * title), so the row states the strongest one in role order.
   */
  const roleBadge = (field: DatabaseField): string | undefined => {
    if (field.id === startField?.id) return t("开始");
    if (field.id === endField?.id) return t("结束");
    if (field.id === titleField?.id) return t("标题");
    if (field.id === colorField?.id) return t("颜色");
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
   * field must not stay the start date, and a new date field with no start date
   * yet becomes it (otherwise the calendar keeps asking for one after the user
   * just created the field it wanted).
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
      config.colorField === field.id ||
      (config.tooltipFields ?? []).includes(field.id);
    if (heldRole) {
      patch({
        startField: config.startField === field.id ? "" : config.startField,
        endField: config.endField === field.id ? undefined : config.endField,
        titleField: config.titleField === field.id ? "" : config.titleField,
        colorField:
          config.colorField === field.id ? undefined : config.colorField,
        tooltipFields: (config.tooltipFields ?? []).filter(
          (fieldId) => fieldId !== field.id,
        ),
      });
    }
  };

  /**
   * Toggles one view button in the calendar header.
   *
   * A list with nothing in it leaves the calendar with no way back to another
   * view, so the last enabled button cannot be switched off; and removing the
   * button of the *open* view also moves the open view onto a remaining one in
   * the same config write. Only the open view moves — every other button stays.
   */
  const toggleViewButton = (
    value: CalendarViewConfig["defaultView"],
    checked: boolean,
  ) => {
    const views = checked
      ? [...layout.views, value]
      : layout.views.filter((view) => view !== value);
    if (views.length === 0) return;
    const moveOpenView = !checked && config.defaultView === value;
    patch({
      headerToolbar: writeCalendarToolbarLayout({ ...layout, views }),
      ...(moveOpenView ? { defaultView: views[0]! } : {}),
    });
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
              ? t("这张表还没有「日期」字段，日历无法定位事件。")
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
                // The old end may now equal the new start; the resolver drops it,
                // but clearing it keeps the config honest.
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
            placeholder={t("不使用")}
            noneLabel={t("不使用")}
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
          label={t("颜色")}
          hint={
            colorChoices.length === 0
              ? t("需要一个「单选」或「多选」字段，按它的选项颜色着色。")
              : undefined
          }
        >
          <FieldSelect
            fields={colorChoices}
            value={colorField?.id ?? ""}
            placeholder={t("不按字段着色")}
            noneLabel={t("不按字段着色")}
            disabled={!canConfigure || colorChoices.length === 0}
            onValueChange={(fieldId) =>
              patch({ colorField: fieldId || undefined })
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
        icon={CalendarDays}
        value={
          CALENDAR_VIEW_OPTIONS.find(
            (option) => option.value === config.defaultView,
          )?.label
        }
        disabled={!canConfigure}
      >
        <PanelSection label={t("打开视图")}>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={config.defaultView}
            disabled={!canConfigure}
            onValueChange={(next) => {
              if (!next) return;
              patch({ defaultView: next as CalendarViewConfig["defaultView"] });
            }}
          >
            {CALENDAR_VIEW_OPTIONS.map((option) => (
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
        <PanelSection label={t("工具栏按钮")}>
          <CheckboxOptionList
            options={CALENDAR_VIEW_OPTIONS.map((option) => ({
              value: option.value,
              label: option.buttonLabel,
            }))}
            selected={layout.views}
            disabled={!canConfigure}
            onToggle={toggleViewButton}
          />
        </PanelSection>
        <Separator />
        <PanelSection label={t("一周起始")}>
          <Select
            value={String(config.firstDay)}
            disabled={!canConfigure}
            onValueChange={(next) => patch({ firstDay: Number(next) })}
          >
            <SelectTrigger
              size="sm"
              aria-label={t("一周起始")}
              className="w-full text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIRST_DAY_OPTIONS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={String(option.value)}
                  className="text-xs"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PanelSection>
      </SettingsPanel>
    </ViewToolbar>
  );
}
