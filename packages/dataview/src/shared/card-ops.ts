// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The pure card layer: one record as a card, and the 卡片配置 settings behind it.
 *
 * Kanban and gallery both draw records as cards, so everything that answers
 * "what does this card show" lives here instead of twice in the two views:
 *
 * - the **persisted fragment** is `DataCardConfig` (interfaces) — title field,
 *   cover field, card fields, 展示模式 — and {@link CardSettings} is its
 *   normalized in-memory form (no `undefined` list, `compact` always a boolean);
 * - the **resolvers** answer "what does this id mean against the *live*
 *   schema", degrading to `null` / `[]` instead of throwing, exactly like the
 *   other `core/config.ts` layers (README §5.1). A view config outlives its
 *   schema: a field can be deleted, retyped or renamed between two openings;
 * - {@link cardFieldValues} is the only place "which fields does this row put on
 *   a card, and is a cell worth drawing" is decided — a card carries **field +
 *   cell**, never pre-rendered text, so the card component draws each value with
 *   the shared `FieldValue` (badges for 单选/多选, a date, a link, a relation
 *   chip);
 * - {@link resolveRowCover} is the only place "where does a cover come from" is
 *   decided.
 *
 * This module is also the config's **migration boundary**: the first gallery
 * stored two separate lists (`badgeFields` for chips, `metaFields` for the
 * name/value rows) plus a `columns` cap, a `virtualized` switch and a
 * `showEmptyCover` switch. Those keys are no longer part of the type, but a
 * config written by that build is still read here and folded into `cardFields`,
 * so an existing node does not lose its card contents on upgrade.
 *
 * Pure module: no React, no third-party library.
 */
import type {
  DataCardConfig,
  DatabaseCell,
  DatabaseField,
  DataRow,
  DataViewSource,
  NodeId,
} from "@workspace/interfaces";

import { displayText } from "../source/cell-resolver";
import { deleteFieldSchema, editFieldSchema } from "../source/row-utils";

// ============================================================================
// Shapes
// ============================================================================

/** Where a card's cover comes from. */
export type CardCover =
  | { kind: "url"; url: string }
  | { kind: "node"; nodeId: NodeId };

/** One field value a card draws. */
export interface CardFieldValue {
  field: DatabaseField;
  cell: DatabaseCell | undefined;
}

/** {@link DataCardConfig} with every key resolved to a usable value. */
export interface CardSettings {
  titleField: string | undefined;
  coverField: string | undefined;
  /** Shown field ids, in card order. */
  cardFields: string[];
  compact: boolean;
}

/**
 * A config that may still carry the pre-redesign gallery keys.
 *
 * Only the gallery ever wrote them, but reading them here keeps one migration
 * boundary for every card-shaped view.
 */
type LegacyCardConfig = DataCardConfig & {
  badgeFields?: string[];
  metaFields?: string[];
};

// ============================================================================
// Settings ⇄ config
// ============================================================================

/** The persisted fragment of a normalized settings object. */
export function cardSettingsPatch(settings: CardSettings): DataCardConfig {
  return {
    titleField: settings.titleField,
    coverField: settings.coverField,
    cardFields: settings.cardFields,
    compact: settings.compact,
  };
}

/**
 * Normalizes a persisted card config.
 *
 * `cardFields` wins when present; a config written before the redesign only has
 * `badgeFields` + `metaFields`, which are concatenated here so the upgrade keeps
 * every value the old card drew.
 */
export function readCardSettings(config: DataCardConfig): CardSettings {
  const legacy = config as LegacyCardConfig;
  const raw =
    config.cardFields && config.cardFields.length > 0
      ? config.cardFields
      : [...(legacy.badgeFields ?? []), ...(legacy.metaFields ?? [])];
  return {
    titleField: config.titleField,
    coverField: config.coverField,
    cardFields: [...new Set(raw)],
    compact: config.compact === true,
  };
}

/** Drops ids the live schema no longer has, so a stale config cannot linger. */
export function pruneCardSettings(
  settings: CardSettings,
  fields: readonly DatabaseField[],
): CardSettings {
  const known = new Set(fields.map((field) => field.id));
  return {
    titleField:
      settings.titleField && known.has(settings.titleField)
        ? settings.titleField
        : undefined,
    coverField:
      settings.coverField && known.has(settings.coverField)
        ? settings.coverField
        : undefined,
    cardFields: settings.cardFields.filter((fieldId) => known.has(fieldId)),
    compact: settings.compact,
  };
}

// ============================================================================
// Resolution against the live schema
// ============================================================================

/** The live title field: the configured one, else the primary column. */
export function resolveCardTitleField(
  fields: readonly DatabaseField[],
  settings: Pick<CardSettings, "titleField">,
): DatabaseField | null {
  return (
    fields.find((field) => field.id === settings.titleField) ??
    fields.find((field) => field.type === "text") ??
    fields[0] ??
    null
  );
}

/**
 * A value a cover may be drawn from.
 *
 * `url` is the declared case; `text` is accepted because pasting an image
 * address into a text field is common, and the value is only used when it
 * actually looks like one; `relation` lets a row point at an image / video / PDF
 * node, whose own preview becomes the cover.
 */
export function isCoverableField(
  field: Pick<DatabaseField, "type"> | undefined,
): boolean {
  return (
    field?.type === "url" ||
    field?.type === "text" ||
    field?.type === "relation"
  );
}

/** Every field the 封面 config item offers, in schema order. */
export function coverableFields(
  fields: readonly DatabaseField[],
): DatabaseField[] {
  return fields.filter(isCoverableField);
}

/** The live cover field, or `null` when nothing usable is configured. */
export function resolveCardCoverField(
  fields: readonly DatabaseField[],
  settings: Pick<CardSettings, "coverField">,
): DatabaseField | null {
  if (!settings.coverField) return null;
  const field = fields.find(
    (candidate) => candidate.id === settings.coverField,
  );
  return isCoverableField(field) ? (field ?? null) : null;
}

/**
 * `true` when a text-ish cell plausibly holds an image address.
 *
 * Deliberately loose: an absolute/relative URL with no whitespace. Anything that
 * survives this check but is not an image fails at load time and falls back to
 * the placeholder — a broken `<img>` is never left on screen.
 */
export function looksLikeImageUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  return /^(https?:\/\/|data:image\/|blob:|\/)/i.test(trimmed);
}

/** Live card fields, in the order the card should draw them. */
export function resolveCardFields(
  fields: readonly DatabaseField[],
  settings: Pick<CardSettings, "cardFields">,
): DatabaseField[] {
  const byId = new Map(fields.map((field) => [field.id, field]));
  return settings.cardFields
    .map((fieldId) => byId.get(fieldId))
    .filter((field): field is DatabaseField => field !== undefined);
}

/**
 * The fields one row puts on a card.
 *
 * A card carries the field *and* its cell so the card component can render it
 * with the shared `FieldValue`. An empty cell is noise on a card — it is dropped
 * rather than drawn as a placeholder, which is the one rule the kanban board had
 * before the two card implementations were merged.
 */
export function cardFieldValues(
  row: DataRow,
  fields: readonly DatabaseField[],
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined,
): CardFieldValue[] {
  const values: CardFieldValue[] = [];
  for (const field of fields) {
    const cell = row.cells[field.id];
    if (displayText(cell, field, resolveNodeTitle).trim() === "") continue;
    values.push({ field, cell });
  }
  return values;
}

/**
 * The fields a card does **not** show, in schema order — what the record editor
 * folds into its 隐藏字段 block. `shown` may contain `undefined` (an unmapped
 * role) and stale ids; both are ignored.
 */
export function cardHiddenFieldIds(
  fields: readonly DatabaseField[],
  shown: ReadonlyArray<string | undefined>,
): string[] {
  const visible = new Set(shown.filter((id): id is string => Boolean(id)));
  return fields
    .filter((field) => !visible.has(field.id))
    .map((field) => field.id);
}

/** The cover a single cell yields. */
function coverFromCell(
  cell: DatabaseCell | undefined,
  field: DatabaseField,
): CardCover | null {
  if (!cell) return null;
  switch (field.type) {
    case "url":
      return cell.type === "url" && cell.url
        ? { kind: "url", url: cell.url }
        : null;
    case "text": {
      const text = cell.type === "text" ? cell.text.trim() : "";
      return looksLikeImageUrl(text) ? { kind: "url", url: text } : null;
    }
    case "relation": {
      if (cell.type !== "relation") return null;
      const [nodeId] = cell.nodeIds ?? [];
      return nodeId ? { kind: "node", nodeId } : null;
    }
    default:
      return null;
  }
}

/**
 * Whether a card of this source draws a **cover region at all**.
 *
 * A collection row *is* a graph node, so its preview is always available; a
 * database card draws a cover only when a cover field resolves against the live
 * schema. `false` makes the card drop the box entirely rather than reserve empty
 * space for the monogram placeholder — the group field `DataCard`'s `cover` prop
 * documents. The kanban and the gallery both ask this, so a coverless card looks
 * the same on a board and on a wall.
 */
export function cardCoverEnabled(
  source: Pick<DataViewSource, "kind">,
  coverField: DatabaseField | null,
): boolean {
  return source.kind === "collection" || coverField !== null;
}

/**
 * The cover of one row.
 *
 * A collection row *is* a graph node, so its cover is the node itself and the
 * configured `coverField` is ignored — the node preview is richer than any
 * projected cell. A database row draws from its configured cover field.
 */
export function resolveRowCover(
  source: DataViewSource,
  row: DataRow,
  index: number,
  coverField: DatabaseField | null,
): CardCover | null {
  if (source.kind === "collection") {
    const nodeId = source.nodeIds?.[index] ?? row.id;
    return nodeId ? { kind: "node", nodeId } : null;
  }
  if (!coverField) return null;
  return coverFromCell(row.cells[coverField.id], coverField);
}

// ============================================================================
// Settings operations (the 卡片配置 menu)
// ============================================================================

/** Shows / hides one field on the card. */
export function setCardFieldVisible(
  settings: CardSettings,
  fieldId: string,
  visible: boolean,
): CardSettings {
  const next = visible
    ? [...settings.cardFields, fieldId]
    : settings.cardFields.filter((id) => id !== fieldId);
  return {
    ...settings,
    cardFields: [...new Set(next)],
  };
}

/**
 * 设为标题: the field becomes the card's title.
 *
 * It leaves `cardFields` in the same write — the title is drawn as the title, so
 * keeping it in the field list would draw the same value twice.
 */
export function setCardTitleField(
  settings: CardSettings,
  fieldId: string | undefined,
): CardSettings {
  return {
    ...settings,
    titleField: fieldId,
    cardFields: fieldId
      ? settings.cardFields.filter((id) => id !== fieldId)
      : settings.cardFields,
  };
}

/** 设为封面 / 无封面. */
export function setCardCoverField(
  settings: CardSettings,
  fieldId: string | undefined,
): CardSettings {
  return { ...settings, coverField: fieldId };
}

/**
 * Drag reorder inside the 卡片配置 list.
 *
 * `order` is the list's full row order (the locked title row included); only the
 * fields that are *on* the card persist an order, so the result is that order
 * filtered down to the current `cardFields` — dropping one field past another
 * therefore moves it past it among the shown fields, and a hidden field's slot is
 * simply not remembered.
 */
export function reorderCardFields(
  settings: CardSettings,
  order: readonly string[],
  fromId: string,
  toId: string,
): CardSettings {
  const from = order.indexOf(fromId);
  const to = order.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return settings;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  if (!moved) return settings;
  // Dropping downward lands *after* the hovered row, so the anchor's own slot
  // shifts up by one.
  next.splice(from < to ? to - 1 : to, 0, moved);
  const shown = new Set(settings.cardFields);
  return { ...settings, cardFields: next.filter((id) => shown.has(id)) };
}

/**
 * 新增字段 / 编辑字段 from the 卡片配置 list.
 *
 * The schema half is `editFieldSchema` (shared with the table's 字段配置); this
 * adds the card half — a field added from the card menu joins the card, because
 * a new field that is invisible everywhere except the table reads as a failure.
 */
export function applyCardFieldEdit(
  settings: CardSettings,
  fields: readonly DatabaseField[],
  rows: readonly DataRow[],
  field: DatabaseField,
  seed?: { fieldId: string; cell: DatabaseCell },
): { settings: CardSettings; fields: DatabaseField[]; rows?: DataRow[] } {
  const schema = editFieldSchema(fields, rows, field, seed);
  return {
    settings: schema.isNew
      ? { ...settings, cardFields: [...settings.cardFields, field.id] }
      : settings,
    fields: schema.fields,
    ...(schema.rows ? { rows: schema.rows } : {}),
  };
}

/**
 * 删除字段 from the 卡片配置 list: the schema half plus the card half — the
 * field leaves `cardFields` and, if it was the title or the cover, that role is
 * cleared so the resolvers fall back instead of pointing at nothing.
 */
export function deleteCardField(
  settings: CardSettings,
  fields: readonly DatabaseField[],
  rows: readonly DataRow[],
  fieldId: string,
): { settings: CardSettings; fields: DatabaseField[]; rows: DataRow[] } {
  const schema = deleteFieldSchema(fields, rows, fieldId);
  return {
    settings: pruneCardSettings(
      {
        ...settings,
        cardFields: settings.cardFields.filter((id) => id !== fieldId),
      },
      schema.fields,
    ),
    fields: schema.fields,
    rows: schema.rows,
  };
}
