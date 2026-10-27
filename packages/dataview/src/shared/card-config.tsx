// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * 卡片配置 — the one card settings menu the kanban and the gallery share.
 *
 * **Roles are config items; the field list is just the fields.** 标题 and 封面 are
 * one `PanelSection` + `FieldSelect` each — the same "one labelled config item per
 * role" shape the calendar's 字段配置 uses for 开始日期 / 结束日期 / 标题 / 颜色 — and
 * the list below answers only "which fields are on the card" (the eye) plus the
 * shared 编辑字段 / 删除字段 / 新增字段 tail from `shared/field-config-list.tsx`.
 * A role is **never** set from a field row's "…" menu: the rows only *annotate*
 * the role a field holds (the 标题 / 封面 badge, and the lock on the title), so
 * the mapping stays readable while every setter looks the same.
 *
 * A 封面 that is not a field role at all (a collection row's node preview) has no
 * item to set — the control stays, disabled, and says where the cover comes from,
 * because the card still draws one.
 *
 * The control is a `SettingsPanel` (a `Popover`, not a `DropdownMenu`): its body
 * is a *form* — selects, a `ToggleGroup` and a searchable field list. The list's
 * own per-field "…" menus are dropdowns *inside* the popover, exactly like the
 * table's.
 *
 * The view owns the config type, so this component speaks in
 * {@link CardSettings} and never writes: `onChange` reports the next settings
 * (which the view merges into its own config) and `onFieldsChange` reports a
 * schema change, both of which the shell persists.
 */
import { useMemo } from "react";
import { IdCard } from "lucide-react";
import { Separator } from "@workspace/ui/components/ui/separator";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/ui/toggle-group";
import type {
  DatabaseField,
  DataRow,
  DataViewSource,
} from "@workspace/interfaces";

import {
  applyCardFieldEdit,
  coverableFields,
  deleteCardField,
  reorderCardFields,
  resolveCardCoverField,
  resolveCardFields,
  resolveCardTitleField,
  setCardCoverField,
  setCardFieldVisible,
  setCardTitleField,
  type CardSettings,
} from "./card-ops";
import { FieldConfigList, type FieldConfigRow } from "./field-config-list";
import { FieldSelect } from "./field-select";
import { PanelSection, SettingsPanel } from "./settings-panel";

export interface CardConfigMenuProps {
  source: DataViewSource;
  /** The live settings, normalized by `readCardSettings`. */
  settings: CardSettings;
  /** Config write. Absence disables every control. */
  onChange?: (settings: CardSettings) => void;
  /** Schema write (database hosts). Absence disables field CRUD. */
  onFieldsChange?: (fields: DatabaseField[], rows?: DataRow[]) => void;
  className?: string;
}

export function CardConfigMenu({
  source,
  settings,
  onChange,
  onFieldsChange,
  className,
}: CardConfigMenuProps) {
  const { t } = useI18n();

  const canConfigure = Boolean(onChange);
  const coverable = coverableFields(source.fields);
  const coverField = resolveCardCoverField(source.fields, settings);
  const titleField = resolveCardTitleField(source.fields, settings);
  /**
   * A collection row *is* a graph node, so its own preview is the cover and no
   * field holds that role.
   */
  const coverByField = source.kind === "database";

  /**
   * The list order: the title row, then the fields on the card in card order,
   * then everything else in schema order. A hidden field keeps its schema place,
   * so showing it again does not move it to the end.
   *
   * The role annotation follows the calendar's rule: a field can hold several
   * roles, and the row states the strongest one.
   */
  const rows: FieldConfigRow[] = useMemo(() => {
    const title = resolveCardTitleField(source.fields, settings);
    const shown = resolveCardFields(source.fields, settings);
    const shownIds = new Set(shown.map((field) => field.id));
    const badge = (field: DatabaseField) =>
      field.id === title?.id
        ? t("标题")
        : coverByField && field.id === coverField?.id
          ? t("封面")
          : undefined;

    const list: FieldConfigRow[] = [];
    if (title) {
      list.push({ field: title, locked: true, badge: badge(title) });
    }
    for (const field of shown) {
      if (field.id === title?.id) continue;
      list.push({ field, visible: true, badge: badge(field) });
    }
    for (const field of source.fields) {
      if (field.id === title?.id || shownIds.has(field.id)) continue;
      list.push({ field, visible: false, badge: badge(field) });
    }
    return list;
  }, [coverByField, coverField?.id, settings, source.fields, t]);

  return (
    <SettingsPanel
      label={t("卡片配置")}
      icon={IdCard}
      width="w-80"
      disabled={!canConfigure}
      className={className}
    >
      <PanelSection label={t("标题")}>
        <FieldSelect
          fields={source.fields}
          value={titleField?.id ?? ""}
          placeholder={t("选择字段")}
          disabled={!canConfigure}
          onValueChange={(fieldId) =>
            onChange?.(setCardTitleField(settings, fieldId || undefined))
          }
        />
      </PanelSection>

      <PanelSection
        label={t("封面")}
        hint={
          !coverByField
            ? t("集合的每一行就是一个节点，卡片直接用它自己的预览作封面。")
            : coverable.length === 0
              ? t(
                  "需要一个「链接」字段（指向图片），或用「关联」字段指向图片／视频节点。",
                )
              : undefined
        }
      >
        {coverByField ? (
          <FieldSelect
            fields={coverable}
            value={coverField?.id ?? ""}
            placeholder={t("无封面")}
            noneLabel={t("无封面")}
            disabled={!canConfigure || coverable.length === 0}
            onValueChange={(fieldId) =>
              onChange?.(setCardCoverField(settings, fieldId || undefined))
            }
          />
        ) : (
          <FieldSelect
            fields={[]}
            value=""
            placeholder={t("使用节点预览")}
            disabled
            onValueChange={() => {}}
          />
        )}
      </PanelSection>

      <Separator />

      <PanelSection label={t("展示模式")}>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={settings.compact ? "compact" : "default"}
          disabled={!canConfigure}
          onValueChange={(next) => {
            if (!next) return;
            onChange?.({ ...settings, compact: next === "compact" });
          }}
        >
          <ToggleGroupItem value="default" className="h-7 px-3 text-xs">
            {t("常规")}{" "}
          </ToggleGroupItem>
          <ToggleGroupItem value="compact" className="h-7 px-3 text-xs">
            {t("紧凑")}{" "}
          </ToggleGroupItem>
        </ToggleGroup>
      </PanelSection>

      <Separator />

      <PanelSection label={t("卡片字段")}>
        <FieldConfigList
          fields={source.fields}
          rows={rows}
          onToggleVisible={
            canConfigure
              ? (field, visible) =>
                  onChange?.(setCardFieldVisible(settings, field.id, visible))
              : undefined
          }
          onReorder={
            canConfigure
              ? (fromId, toId) =>
                  onChange?.(
                    reorderCardFields(
                      settings,
                      rows.map((row) => row.field.id),
                      fromId,
                      toId,
                    ),
                  )
              : undefined
          }
          onSubmitField={
            onFieldsChange && onChange
              ? (result) => {
                  const next = applyCardFieldEdit(
                    settings,
                    source.fields,
                    source.rows,
                    result.field,
                    result.seed
                      ? { fieldId: result.field.id, cell: result.seed }
                      : undefined,
                  );
                  onChange(next.settings);
                  onFieldsChange(next.fields, next.rows);
                }
              : undefined
          }
          onDeleteField={
            onFieldsChange && onChange
              ? (field) => {
                  const next = deleteCardField(
                    settings,
                    source.fields,
                    source.rows,
                    field.id,
                  );
                  onChange(next.settings);
                  onFieldsChange(next.fields, next.rows);
                }
              : undefined
          }
        />
      </PanelSection>
    </SettingsPanel>
  );
}
