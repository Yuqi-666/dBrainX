// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `rows → cards` for the gallery — the data layer behind the card wall.
 *
 * One card per row: a title, a cover, and the field values the config asks for.
 * Everything that decides *what* a card carries lives in `shared/card-ops.ts`,
 * because the kanban builds the same card from the same settings; this module is
 * only the gallery's own row walk (and the one gallery-specific fallback title).
 *
 * A value is carried as **the field and its cell**, not as pre-rendered text, so
 * the card can draw it with the shared `DataCard`/`FieldValue`.
 *
 * Pure module: no React, no third-party library, so the mapping can be reasoned
 * about — and reused by an export — without mounting anything.
 */
import type { DataViewSource, NodeId } from "@workspace/interfaces";

import { displayText } from "../../../source/cell-resolver";
import {
  cardCoverEnabled,
  cardFieldValues,
  cardHiddenFieldIds,
  resolveCardCoverField,
  resolveCardFields,
  resolveCardTitleField,
  resolveRowCover,
  type CardCover,
  type CardFieldValue,
  type CardSettings,
} from "../../../shared/card-ops";

/** Title shown when a row has no value in the title field. */
export const GALLERY_FALLBACK_TITLE = "未命名";

export interface GalleryCard {
  rowId: string;
  /** The graph node behind the row (collection hosts). */
  nodeId?: NodeId;
  title: string;
  /**
   * `undefined` → the card draws **no cover region at all** (no cover field
   * configured), the same contract the kanban follows; `null` is a coverless row
   * of a board that *does* have a cover, which wears the monogram placeholder.
   */
  cover: CardCover | null | undefined;
  /** The card fields that carry a value, in card order. */
  fields: CardFieldValue[];
  /** Fields the card does not show → folded into the record editor. */
  hiddenFieldIds: string[];
}

/** Builds the cards for a source under the (already normalized) card settings. */
export function rowsToCards(
  source: DataViewSource,
  settings: CardSettings,
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined,
): GalleryCard[] {
  const titleField = resolveCardTitleField(source.fields, settings);
  const coverField = resolveCardCoverField(source.fields, settings);
  const coverEnabled = cardCoverEnabled(source, coverField);
  const cardFields = resolveCardFields(source.fields, settings);
  const hiddenFieldIds = cardHiddenFieldIds(source.fields, [
    titleField?.id,
    ...cardFields.map((field) => field.id),
  ]);

  return source.rows.map((row, index) => {
    const title = titleField
      ? displayText(
          row.cells[titleField.id],
          titleField,
          resolveNodeTitle,
        ).trim()
      : "";

    return {
      rowId: row.id,
      nodeId:
        source.kind === "collection"
          ? (source.nodeIds?.[index] ?? row.id)
          : undefined,
      title: title || GALLERY_FALLBACK_TITLE,
      cover: coverEnabled
        ? resolveRowCover(source, row, index, coverField)
        : undefined,
      fields: cardFieldValues(row, cardFields, resolveNodeTitle),
      hiddenFieldIds,
    };
  });
}
