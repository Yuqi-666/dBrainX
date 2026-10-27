// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { ColorPicker } from "@workspace/ui/components/selector/color-picker";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The chart view's toolbar — its one control strip.
 *
 * Layout contract (same as every view): **configuration on the left, functions
 * on the right**, every control a button or a popover panel. The shell's 更多
 * menu is appended to the function group by `ViewToolbar`, and the only other
 * function is 导出图片 (the chart is the one view whose output is a picture, so
 * a PNG export belongs there). A drill filter, when one is active, is a chip at
 * the left end of the configuration group — the group may wrap and resize, the
 * right-anchored function group may not.
 *
 * The chart has **no** `configEditor` in the registry: 图表 / 字段配置 / 视图
 * cover every key of `ChartViewConfig` a user can decide, exactly like the
 * table's seven menus and the gantt's two panels.
 *
 * **字段配置 is role-driven, because a chart's schema is a set of roles.**
 * A chart type declares which roles it reads (`CHART_TYPES[...].roles`), and the
 * panel draws exactly those — 维度 / 系列 / 度量 for a bar, two 度量 for an
 * interval chart, X·Y for a scatter, 层级 levels for a treemap, 来源·目标 for a
 * sankey. Roles are **config items above the shared field list**, never setters
 * hidden in a field row's "…" menu: the list below only annotates which role a
 * field currently holds and owns the schema CRUD (新增字段 / 编辑字段 / 删除字段).
 */
import { useRef } from "react";
import { ChartPie, FolderTree, ImageDown, X } from "lucide-react";
import { Badge } from "@workspace/ui/components/ui/badge";
import { Button } from "@workspace/ui/components/ui/button";
import { Input } from "@workspace/ui/components/ui/input";
import { Separator } from "@workspace/ui/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/ui/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/ui/toggle-group";
import type {
  ChartMeasure,
  ChartViewConfig,
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
  PanelSection,
  SettingsPanel,
  SwitchRow,
} from "../../../shared/settings-panel";
import { ViewToolbar } from "../../../shared/view-toolbar";
import { deleteFieldSchema, editFieldSchema } from "../../../source/row-utils";
import {
  CHART_AGGREGATIONS,
  CHART_CLICK_ACTIONS,
  CHART_COUNT_FIELD,
  CHART_GROUPS,
  CHART_LIMITS,
  CHART_PALETTES,
  CHART_THEMES,
  CHART_TYPES,
  type ChartRole,
  type ChartTypeMeta,
  dimensionFields,
  measureFieldChoices,
  resolveHierarchyFields,
  type ResolvedChartFields,
} from "../core/config";

/** The role annotation a field row carries, in role order. */
function roleBadge(
  fieldId: string,
  meta: ChartTypeMeta,
  config: ChartViewConfig,
  resolved: ResolvedChartFields,
  levels: readonly DatabaseField[],
): string | undefined {
  if (meta.roles.includes("dimension") && resolved.dimension?.id === fieldId) {
    return translate("维度");
  }
  if (meta.roles.includes("series") && resolved.series?.id === fieldId) {
    return meta.shape === "heatmap" ? translate("第二维度") : translate("系列");
  }
  if (meta.roles.includes("xy")) {
    if (config.xMeasure === fieldId) return "X";
    if (config.yMeasure === fieldId) return "Y";
  }
  if (meta.roles.includes("flow")) {
    if (config.sourceField === fieldId) return translate("来源");
    if (config.targetField === fieldId) return translate("目标");
  }
  if (meta.roles.includes("hierarchy")) {
    const index = levels.findIndex((level) => level.id === fieldId);
    if (index >= 0) return translate("{value1} 级", { value1: index + 1 });
  }
  if (meta.roles.includes("measures")) {
    const index = resolved.measures.findIndex(
      (measure) => measure.field?.id === fieldId,
    );
    if (index >= 0)
      return translate("度量{value1}", {
        value1: resolved.measures.length > 1 ? index + 1 : "",
      });
  }
  return undefined;
}

/**
 * The 标题 box: reports on blur / Enter, not on every keystroke.
 *
 * A chart title is a view config, and the host persists a whole view per write —
 * committing per keystroke would be an upsert per character. Escape drops the
 * draft.
 */
function TitleInput({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  onCommit: (next: string) => void;
}) {
  const { t } = useI18n();

  const ref = useRef<HTMLInputElement>(null);

  return (
    <Input
      ref={ref}
      defaultValue={value}
      placeholder={t("不写标题")}
      disabled={disabled}
      aria-label={t("图表标题")}
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

/** One 度量 row: the field, its aggregation, and a remove button. */
function MeasureRow({
  measure,
  index,
  fields,
  defaultAggregation,
  removable,
  disabled,
  onChange,
  onRemove,
}: {
  measure: ChartMeasure;
  index: number;
  fields: readonly DatabaseField[];
  defaultAggregation: ChartViewConfig["aggregation"];
  removable: boolean;
  disabled?: boolean;
  onChange: (next: ChartMeasure) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();

  const isCount = measure.fieldId === CHART_COUNT_FIELD;
  return (
    <div className="flex items-center gap-1">
      <FieldSelect
        fields={[...fields]}
        value={measure.fieldId}
        placeholder={t("选择字段")}
        disabled={disabled}
        className="min-w-0 flex-1"
        onValueChange={(fieldId) =>
          onChange({
            ...measure,
            fieldId,
            // 计数 has no aggregation of its own; dropping the key keeps the
            // persisted shape honest when a user switches back and forth.
            aggregation:
              fieldId === CHART_COUNT_FIELD ? undefined : measure.aggregation,
          })
        }
      />
      {!isCount && (
        <Select
          value={measure.aggregation ?? defaultAggregation}
          disabled={disabled}
          onValueChange={(next) =>
            onChange({
              ...measure,
              aggregation: next as ChartMeasure["aggregation"],
            })
          }
        >
          <SelectTrigger
            size="sm"
            aria-label={translate("度量 {value1} 聚合", { value1: index + 1 })}
            className="w-20 shrink-0 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHART_AGGREGATIONS.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="text-xs"
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label={translate("删除度量 {value1}", { value1: index + 1 })}
        disabled={disabled || !removable}
        className="shrink-0 text-muted-foreground"
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

export interface ChartToolbarProps {
  source: DataViewSource;
  config: ChartViewConfig;
  meta: ChartTypeMeta;
  resolved: ResolvedChartFields;
  /** The scatter's two measures, resolved. */
  xy: { x: DatabaseField | null; y: DatabaseField | null };
  /** The sankey's two endpoints, resolved. */
  flow: { source: DatabaseField | null; target: DatabaseField | null };
  /** The host allows view management → every config write needs this. */
  canConfigure: boolean;
  /** The active drill filter, if any. */
  drill: { dimension: string; series?: string } | null;
  onClearDrill: () => void;
  onConfigChange?: (config: ChartViewConfig) => void;
  /** Schema write → 字段配置 offers field CRUD (database hosts). */
  onFieldsChange?: (fields: DatabaseField[], rows?: DataRow[]) => void;
  /** 导出图片 — the surface holds the instance, so the shell does the work. */
  onExport: () => void;
  className?: string;
}

export function ChartToolbar({
  source,
  config,
  meta,
  resolved,
  xy,
  flow,
  canConfigure,
  drill,
  onClearDrill,
  onConfigChange,
  onFieldsChange,
  onExport,
  className,
}: ChartToolbarProps) {
  const { t } = useI18n();

  const patch = (next: Partial<ChartViewConfig>) =>
    onConfigChange?.({ ...config, ...next });

  const dimensions = dimensionFields(source.fields);
  const numberFields = source.fields.filter((field) => field.type === "number");
  const measureFields = measureFieldChoices(source.fields);
  const canEditFields = canConfigure && Boolean(onFieldsChange);

  /**
   * The hierarchy levels the panel edits: the explicit list when there is one,
   * the smart fallback otherwise — so a fresh 树图 shows the level it is
   * actually drawing instead of an empty list.
   */
  const levels = config.hierarchyFields?.length
    ? config.hierarchyFields
        .map((fieldId) => source.fields.find((field) => field.id === fieldId))
        .filter((field): field is DatabaseField => field !== undefined)
    : resolveHierarchyFields(
        source.fields,
        config.hierarchyFields,
        resolved.dimension,
      );

  const hasRole = (role: ChartRole) => meta.roles.includes(role);

  const rows: FieldConfigRow[] = source.fields.map((field) => ({
    field,
    // A chart has no "which fields are on it" decision the way a card does —
    // every field is either encoded or ignored — so there is no eye here; the
    // rows annotate the role a field holds.
    badge: roleBadge(field.id, meta, config, resolved, levels),
  }));

  const measures: ChartMeasure[] =
    config.measures && config.measures.length > 0
      ? config.measures
      : [{ fieldId: CHART_COUNT_FIELD }];

  const canAddMeasure = measures.length < meta.maxMeasures;
  const measureCount = Number.isFinite(meta.maxMeasures)
    ? meta.maxMeasures
    : undefined;

  /**
   * 新增字段 / 编辑字段: the schema write plus this view's config.
   *
   * A deleted field must not stay a role, and a newly created field takes over
   * the role the chart is still missing — the same rule the calendar and the
   * gantt follow, so creating the column a chart is asking for wires it up.
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

    const numberMeasures = resolved.measures.filter(
      (measure) => measure.field !== null,
    ).length;
    if (result.field.type === "number" && numberMeasures === 0) {
      // The chart is running on the synthetic 计数 measure; the new number
      // column is exactly what it was waiting for.
      patch({
        measures: [{ fieldId: result.field.id, aggregation: "sum" }],
      });
      return;
    }
    if (hasRole("dimension") && !config.dimensionField) {
      patch({ dimensionField: result.field.id });
      return;
    }
    if (hasRole("xy") && !xy.x) {
      patch({ xMeasure: result.field.id });
      return;
    }
    if (hasRole("xy") && !xy.y) {
      patch({ yMeasure: result.field.id });
    }
  };

  const handleDeleteField = (field: DatabaseField) => {
    if (!canEditFields) return;
    const schema = deleteFieldSchema(source.fields, source.rows, field.id);
    onFieldsChange?.(schema.fields, schema.rows);

    const next: Partial<ChartViewConfig> = {};
    if (config.dimensionField === field.id) next.dimensionField = undefined;
    if (config.seriesField === field.id) next.seriesField = undefined;
    if (config.xMeasure === field.id) next.xMeasure = undefined;
    if (config.yMeasure === field.id) next.yMeasure = undefined;
    if (config.sourceField === field.id) next.sourceField = undefined;
    if (config.targetField === field.id) next.targetField = undefined;
    if (config.hierarchyFields?.includes(field.id)) {
      next.hierarchyFields = config.hierarchyFields.filter(
        (fieldId) => fieldId !== field.id,
      );
    }
    if (measures.some((measure) => measure.fieldId === field.id)) {
      const kept = measures.filter((measure) => measure.fieldId !== field.id);
      next.measures = kept.length > 0 ? kept : [{ fieldId: CHART_COUNT_FIELD }];
    }
    if (Object.keys(next).length > 0) patch(next);
  };

  const patchMeasure = (index: number, next: ChartMeasure) => {
    patch({
      measures: measures.map((measure, position) =>
        position === index ? next : measure,
      ),
    });
  };

  const removeMeasure = (index: number) => {
    const kept = measures.filter((_, position) => position !== index);
    patch({
      measures: kept.length > 0 ? kept : [{ fieldId: CHART_COUNT_FIELD }],
    });
  };

  const addMeasure = () => {
    // A second measure starts from the first one's field: "the same number,
    // averaged as well" is the common intent, and 度量 rows are cheap to change.
    const previous = measures[measures.length - 1];
    patch({
      measures: [
        ...measures,
        {
          fieldId: previous?.fieldId ?? CHART_COUNT_FIELD,
          aggregation: previous?.aggregation ?? "sum",
        },
      ],
    });
  };

  const patchLevel = (index: number, fieldId: string) => {
    const next = levels.map((field, position) =>
      position === index ? fieldId : field.id,
    );
    patch({ hierarchyFields: next });
  };

  const removeLevel = (index: number) => {
    if (levels.length <= 1) return;
    patch({
      hierarchyFields: levels
        .filter((_, position) => position !== index)
        .map((field) => field.id),
    });
  };

  const addLevel = (fieldId: string) => {
    patch({ hierarchyFields: [...levels.map((field) => field.id), fieldId] });
  };

  const showLabels = meta.shape !== "wordCloud" && meta.shape !== "single";
  const showLegend = meta.shape !== "single" && meta.shape !== "hierarchy";
  const showRanking =
    meta.shape === "cartesian" ||
    meta.shape === "polar" ||
    meta.shape === "heatmap" ||
    meta.shape === "wordCloud" ||
    meta.shape === "hierarchy";

  return (
    <ViewToolbar
      className={className}
      actions={
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground"
          onClick={onExport}
        >
          <ImageDown className="size-3.5" />
          {t("导出图片")}{" "}
        </Button>
      }
    >
      {drill && (
        <Badge
          variant="secondary"
          className="h-7 shrink-0 gap-1 rounded-md pr-1 text-xs font-normal"
        >
          <span
            className="max-w-40 truncate"
            title={drill.series ?? drill.dimension}
          >
            {drill.series
              ? `${drill.dimension} · ${drill.series}`
              : drill.dimension}
          </span>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={t("清除下钻")}
            className="size-5"
            onClick={onClearDrill}
          >
            <X className="size-3" />
          </Button>
        </Badge>
      )}

      {/* ——————— 图表 ——————— */}
      <SettingsPanel
        label={t("图表")}
        icon={ChartPie}
        value={meta.label}
        disabled={!canConfigure}
        width="w-64"
      >
        <PanelSection label={t("类型")}>
          <Select
            value={meta.id}
            disabled={!canConfigure}
            onValueChange={(next) => {
              const target = CHART_TYPES.find((type) => type.id === next);
              if (!target) return;
              // Switching type prunes what the new type cannot read, so the
              // persisted config never carries a role the type has no field
              // for (a 饼图 with two measures, a 散点 with a dimension).
              patch({
                chartType: target.id,
                measures: target.roles.includes("measures")
                  ? measures.slice(0, Math.max(1, target.maxMeasures))
                  : [],
                dimensionField: target.roles.includes("dimension")
                  ? (config.dimensionField ?? resolved.dimension?.id)
                  : undefined,
                seriesField: target.roles.includes("series")
                  ? config.seriesField
                  : undefined,
              });
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={t("图表类型")}
              className="w-full text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {CHART_GROUPS.map((group) => (
                <SelectGroup key={group}>
                  <SelectLabel className="text-[11px]">{t(group)}</SelectLabel>
                  {CHART_TYPES.filter((type) => type.group === group).map(
                    (type) => (
                      <SelectItem
                        key={type.id}
                        value={type.id}
                        className="text-xs"
                      >
                        {type.label}
                      </SelectItem>
                    ),
                  )}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </PanelSection>
      </SettingsPanel>

      {/* ——————— 字段配置 ——————— */}
      <SettingsPanel
        label={t("字段配置")}
        icon={FolderTree}
        width="w-80"
        disabled={!canConfigure}
      >
        {hasRole("dimension") && (
          <PanelSection
            label={meta.shape === "heatmap" ? t("横轴维度") : t("维度")}
            hint={
              dimensions.length === 0
                ? t("这张表还没有可作维度的字段。")
                : undefined
            }
          >
            <FieldSelect
              fields={dimensions}
              value={resolved.dimension?.id ?? ""}
              placeholder={t("选择字段")}
              disabled={!canConfigure || dimensions.length === 0}
              onValueChange={(fieldId) =>
                patch({
                  dimensionField: fieldId || undefined,
                  ...(config.seriesField === fieldId
                    ? { seriesField: undefined }
                    : {}),
                })
              }
            />
          </PanelSection>
        )}

        {hasRole("series") && (
          <PanelSection
            label={meta.shape === "heatmap" ? t("纵轴维度") : t("系列")}
            hint={
              meta.shape === "heatmap"
                ? t("热力图需要两个维度：横轴、纵轴，颜色表示度量。")
                : resolved.series && hasRole("measures") && measures.length > 1
                  ? t("选了系列字段后只画第一个度量。")
                  : undefined
            }
          >
            <FieldSelect
              fields={dimensions.filter(
                (field) => field.id !== resolved.dimension?.id,
              )}
              value={resolved.series?.id ?? ""}
              placeholder={
                meta.shape === "heatmap" ? t("选择字段") : t("不拆分系列")
              }
              noneLabel={meta.shape === "heatmap" ? undefined : t("不拆分系列")}
              disabled={!canConfigure || dimensions.length < 2}
              onValueChange={(fieldId) =>
                patch({ seriesField: fieldId || undefined })
              }
            />
          </PanelSection>
        )}

        {hasRole("xy") && (
          <>
            <PanelSection
              label={t("X 轴度量")}
              hint={
                numberFields.length < 2
                  ? t("散点图需要两个「数字」字段。")
                  : undefined
              }
            >
              <FieldSelect
                fields={numberFields}
                value={xy.x?.id ?? ""}
                placeholder={t("选择字段")}
                disabled={!canConfigure || numberFields.length === 0}
                onValueChange={(fieldId) =>
                  patch({
                    xMeasure: fieldId || undefined,
                    ...(config.yMeasure === fieldId
                      ? { yMeasure: undefined }
                      : {}),
                  })
                }
              />
            </PanelSection>
            <PanelSection label={t("Y 轴度量")}>
              <FieldSelect
                fields={numberFields.filter((field) => field.id !== xy.x?.id)}
                value={xy.y?.id ?? ""}
                placeholder={t("选择字段")}
                disabled={!canConfigure || numberFields.length < 2}
                onValueChange={(fieldId) =>
                  patch({ yMeasure: fieldId || undefined })
                }
              />
            </PanelSection>
          </>
        )}

        {hasRole("flow") && (
          <>
            <PanelSection
              label={t("来源")}
              hint={flow.source ? undefined : t("桑基图需要两个字段表示流向。")}
            >
              <FieldSelect
                fields={dimensions}
                value={flow.source?.id ?? ""}
                placeholder={t("选择字段")}
                disabled={!canConfigure || dimensions.length === 0}
                onValueChange={(fieldId) =>
                  patch({
                    sourceField: fieldId || undefined,
                    ...(config.targetField === fieldId
                      ? { targetField: undefined }
                      : {}),
                  })
                }
              />
            </PanelSection>
            <PanelSection label={t("目标")}>
              <FieldSelect
                fields={dimensions.filter(
                  (field) => field.id !== flow.source?.id,
                )}
                value={flow.target?.id ?? ""}
                placeholder={t("选择字段")}
                disabled={!canConfigure || dimensions.length < 2}
                onValueChange={(fieldId) =>
                  patch({ targetField: fieldId || undefined })
                }
              />
            </PanelSection>
          </>
        )}

        {hasRole("hierarchy") && (
          <PanelSection
            label={t("层级")}
            hint={levels.length >= 3 ? t("最多三层。") : undefined}
          >
            <div className="flex flex-col gap-1">
              {levels.map((level, index) => (
                <div
                  key={`${level.id}-${index}`}
                  className="flex items-center gap-1"
                >
                  <span className="w-7 shrink-0 text-[11px] text-muted-foreground">
                    {index + 1} {translate("级")}{" "}
                  </span>
                  <FieldSelect
                    fields={dimensions}
                    value={level.id}
                    placeholder={t("选择字段")}
                    disabled={!canConfigure}
                    className="min-w-0 flex-1"
                    onValueChange={(fieldId) => patchLevel(index, fieldId)}
                  />
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={translate("删除第 {value1} 级", {
                      value1: index + 1,
                    })}
                    disabled={!canConfigure || levels.length <= 1}
                    className="shrink-0 text-muted-foreground"
                    onClick={() => removeLevel(index)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
              {levels.length < 3 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!canConfigure}
                  className="h-7 justify-start gap-1.5 px-1.5 text-xs font-normal text-muted-foreground"
                  onClick={() => {
                    const next = dimensions.find(
                      (field) => !levels.some((level) => level.id === field.id),
                    );
                    if (next) addLevel(next.id);
                  }}
                >
                  {t("添加层级")}{" "}
                </Button>
              )}
            </div>
          </PanelSection>
        )}

        {hasRole("measures") && (
          <PanelSection
            label={t("度量")}
            hint={
              numberFields.length === 0
                ? t("这张表还没有「数字」字段，先按记录数统计。")
                : measureCount === 2
                  ? t("区间图用两个度量作为区间的上下界。")
                  : undefined
            }
          >
            <div className="flex flex-col gap-1">
              {measures.map((measure, index) => (
                <MeasureRow
                  key={index}
                  measure={measure}
                  index={index}
                  fields={measureFields}
                  defaultAggregation={
                    config.aggregation === "count" ? "sum" : config.aggregation
                  }
                  removable={measures.length > 1}
                  disabled={!canConfigure}
                  onChange={(next) => patchMeasure(index, next)}
                  onRemove={() => removeMeasure(index)}
                />
              ))}
              {canAddMeasure && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!canConfigure}
                  className="h-7 justify-start gap-1.5 px-1.5 text-xs font-normal text-muted-foreground"
                  onClick={addMeasure}
                >
                  {t("添加度量")}{" "}
                </Button>
              )}
            </div>
          </PanelSection>
        )}

        <Separator />

        <PanelSection label={t("字段")}>
          <FieldConfigList
            fields={source.fields}
            rows={rows}
            searchPlaceholder={t("搜索字段")}
            onSubmitField={canEditFields ? handleSubmitField : undefined}
            onDeleteField={canEditFields ? handleDeleteField : undefined}
          />
        </PanelSection>
      </SettingsPanel>

      {/* ——————— 视图 ——————— */}
      <SettingsPanel
        label={t("视图")}
        icon={ChartPie}
        disabled={!canConfigure}
        width="w-72"
      >
        <PanelSection label={t("标题")}>
          <TitleInput
            value={config.title ?? ""}
            disabled={!canConfigure}
            onCommit={(next) => patch({ title: next.trim() || undefined })}
          />
        </PanelSection>

        {showRanking && (
          <>
            <Separator />
            <PanelSection label={t("排序")}>
              <div className="flex items-center gap-1">
                <Select
                  value={
                    config.sortBy ? String(config.sortBy.measureIndex) : "none"
                  }
                  disabled={!canConfigure}
                  onValueChange={(next) =>
                    patch({
                      sortBy:
                        next === "none"
                          ? undefined
                          : {
                              measureIndex: Number(next),
                              order: config.sortBy?.order ?? "desc",
                            },
                    })
                  }
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={t("排序字段")}
                    className="min-w-0 flex-1 text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-xs">
                      {t("不排序")}{" "}
                    </SelectItem>
                    {resolved.measures.map((measure, index) => (
                      <SelectItem
                        key={`${measure.label}-${index}`}
                        value={String(index)}
                        className="text-xs"
                      >
                        {measure.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ToggleGroup
                  type="single"
                  size="sm"
                  variant="outline"
                  value={config.sortBy?.order ?? "desc"}
                  disabled={!canConfigure || !config.sortBy}
                  onValueChange={(next) => {
                    if (!next || !config.sortBy) return;
                    patch({
                      sortBy: {
                        ...config.sortBy,
                        order: next as "asc" | "desc",
                      },
                    });
                  }}
                >
                  <ToggleGroupItem value="desc" className="h-7 px-2 text-xs">
                    {t("降序")}{" "}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="asc" className="h-7 px-2 text-xs">
                    {t("升序")}{" "}
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </PanelSection>

            <Separator />
            <PanelSection label={t("前 N 条")}>
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={config.limit ? String(config.limit) : "all"}
                disabled={!canConfigure}
                onValueChange={(next) => {
                  if (!next) return;
                  patch({ limit: next === "all" ? undefined : Number(next) });
                }}
              >
                <ToggleGroupItem value="all" className="h-7 px-2 text-xs">
                  {t("全部")}{" "}
                </ToggleGroupItem>
                {CHART_LIMITS.map((limit) => (
                  <ToggleGroupItem
                    key={limit}
                    value={String(limit)}
                    className="h-7 px-2 text-xs"
                  >
                    {limit}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </PanelSection>
          </>
        )}

        <Separator />
        <PanelSection label={t("点击行为")}>
          <Select
            value={config.clickAction}
            disabled={!canConfigure}
            onValueChange={(next) =>
              patch({ clickAction: next as ChartViewConfig["clickAction"] })
            }
          >
            <SelectTrigger
              size="sm"
              aria-label={t("点击行为")}
              className="w-full text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHART_CLICK_ACTIONS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="text-xs"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PanelSection>

        <Separator />
        {showLegend && (
          <SwitchRow
            label={t("图例")}
            checked={config.showLegend}
            disabled={!canConfigure}
            onCheckedChange={(checked) => patch({ showLegend: checked })}
          />
        )}
        {showLabels && (
          <SwitchRow
            label={t("数据标签")}
            checked={config.showLabel}
            disabled={!canConfigure}
            onCheckedChange={(checked) => patch({ showLabel: checked })}
          />
        )}
        <SwitchRow
          label={t("悬浮提示")}
          checked={config.showTooltip}
          disabled={!canConfigure}
          onCheckedChange={(checked) => patch({ showTooltip: checked })}
        />

        <Separator />
        <PanelSection label={t("主题")}>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={config.theme}
            disabled={!canConfigure}
            onValueChange={(next) => {
              if (!next) return;
              patch({ theme: next as ChartViewConfig["theme"] });
            }}
          >
            {CHART_THEMES.map((option) => (
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

        <PanelSection label={t("色板")}>
          <ColorPicker
            value={config.colorScheme ?? "default"}
            onChange={(colorScheme) => patch({ colorScheme })}
            disabled={!canConfigure}
            aria-label={t("色板")}
            className="p-0"
            columns={3}
            showLabels
            groups={[
              {
                label: t("色板"),
                colors: CHART_PALETTES.map((palette) => ({
                  value: palette.value,
                  label: palette.label,
                  background: palette.colors.length
                    ? `linear-gradient(90deg, ${palette.colors.join(", ")})`
                    : "var(--muted)",
                })),
              },
            ]}
          />
        </PanelSection>
      </SettingsPanel>
    </ViewToolbar>
  );
}
