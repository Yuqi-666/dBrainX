// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The **one card** every card-shaped view draws.
 *
 * Kanban and gallery show the same record the same way — a cover, the title,
 * one tinted `Badge` per 单选/多选 value and a line per other field — so the card
 * body lives here and each view only owns the arrangement around it (the
 * gallery's measured grid/masonry/list geometry, the kanban's drag handle and
 * lane). A view never invents its own chip or its own value row: the values come
 * from `shared/field-value.tsx`, and the cover from `shared/card-cover.tsx`.
 *
 * **What a card shows.** `fields` is the list `shared/card-ops.ts` resolved for
 * the card's config — field + cell, in card order. 单选/多选 become chips, every
 * other type a value line. A value line deliberately carries **no field name**
 * (the design's card look): the value is what the card is for, and the field's
 * name is on the `title` attribute, in the record editor and in the table.
 * Empty cells never reach here — `cardFieldValues` drops them.
 *
 * **Layouts.** `grid` fixes the card's height (the tile height is owned by the
 * caller) and lets the cover take whatever the footer leaves; `masonry` lets the
 * cover take the image's own ratio, which is what makes a column stack read as a
 * masonry; `list` puts the cover in a thumbnail box and the values in a
 * right-hand column (or under the title when the pane is narrow); `board` is the
 * kanban card — a fixed-ratio cover over a self-sizing body. A card with no cover
 * source at all (`cover === undefined`) simply has no cover box in any of them.
 *
 * **展示模式 (紧凑) is the config's, not the caller's.** It tightens the spacing
 * and cuts how many values and chips a card carries.
 */
import type { ReactNode } from "react";
import type { NodeData, NodeId } from "@workspace/interfaces";
import { cn } from "@workspace/ui/lib/utils";

import { displayText } from "../source/cell-resolver";
import { CardCoverBox } from "./card-cover";
import { FieldValue, OptionBadge, cellOptionBadges } from "./field-value";
import type { CardCover, CardFieldValue } from "./card-ops";

/** How a card arranges its cover and its values. */
export type DataCardLayout = "grid" | "masonry" | "list" | "board";

/** Chips / value lines a card carries per layout (常规 mode). */
const LIMITS: Record<DataCardLayout, { chips: number; rows: number }> = {
  grid: { chips: 3, rows: 2 },
  masonry: { chips: 3, rows: 2 },
  list: { chips: 3, rows: 2 },
  board: { chips: 4, rows: 3 },
};

/** 紧凑 mode: fewer values, so a dense board stays scannable. */
const COMPACT_LIMITS = { chips: 2, rows: 1 };

/** Width of a 列表 row's right-hand value column. */
const LIST_VALUE_COLUMN = "w-52";

/** A "+N" tail saying how many values the card had no room for. */
function OverflowTail({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="w-fit rounded-md bg-muted/70 px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
      +{count}
    </span>
  );
}

export function isCardChipField(entry: CardFieldValue): boolean {
  return entry.field.type === "select" || entry.field.type === "multiSelect";
}

/** One tinted badge per selected option, with a "+N" tail for the rest. */
function CardChips({
  fields,
  limit,
}: {
  fields: readonly CardFieldValue[];
  limit: number;
}) {
  const chips = fields.flatMap((entry) =>
    cellOptionBadges(entry.cell, entry.field).map((badge) => ({
      ...badge,
      fieldName: entry.field.name,
    })),
  );
  if (chips.length === 0) return null;
  const shown = chips.slice(0, limit);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((badge) => (
        <OptionBadge
          key={badge.id}
          label={badge.label}
          color={badge.color}
          title={`${badge.fieldName}：${badge.label}`}
        />
      ))}
      <OverflowTail count={chips.length - shown.length} />
    </div>
  );
}

/**
 * One value line per non-chip field.
 *
 * The field name is the line's tooltip rather than its label: a card is a
 * glance, and five `名称 值` pairs turn it into a form. A value that needs its
 * name to mean anything (a bare number) still has it one hover away, and the
 * record editor shows the full mapping.
 */
function CardValueRows({
  fields,
  limit,
  resolveNodeTitle,
  onOpenNode,
  className,
}: {
  fields: readonly CardFieldValue[];
  limit: number;
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined;
  onOpenNode?: (nodeId: NodeId) => void;
  className?: string;
}) {
  if (fields.length === 0) return null;
  const shown = fields.slice(0, limit);

  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      {shown.map((entry) => (
        <div
          key={entry.field.id}
          title={`${entry.field.name}：${displayText(entry.cell, entry.field, resolveNodeTitle)}`}
          className="flex min-w-0 text-[11px] text-foreground/80"
        >
          <FieldValue
            cell={entry.cell}
            field={entry.field}
            resolveNodeTitle={resolveNodeTitle}
            onOpenNode={onOpenNode}
            className="truncate"
          />
        </div>
      ))}
      <OverflowTail count={fields.length - shown.length} />
    </div>
  );
}

export interface DataCardProps {
  title: string;
  /**
   * `undefined` draws **no cover area at all** (no cover source at all — no
   * cover field configured, and not a collection row); `null` draws the monogram
   * placeholder (a board that *has* a cover whose cell is empty, or a cover that
   * failed to load). Both the kanban and the gallery follow this rule, so a
   * coverless card looks the same on a board and on a wall.
   */
  cover: CardCover | null | undefined;
  fields: readonly CardFieldValue[];
  layout: DataCardLayout;
  /** 展示模式：紧凑. */
  compact?: boolean;
  /** 列表: the caller's own card-size geometry for the thumbnail box. */
  coverClassName?: string;
  /** 列表 under a narrow pane: the values fold under the title. */
  folded?: boolean;
  resolveNode?: (nodeId: string) => NodeData | undefined;
  resolveNodeTitle?: (nodeId: NodeId) => string | undefined;
  onOpenNode?: (nodeId: NodeId) => void;
  className?: string;
  /** Extra layers painted over the card (the gallery's open button / checkbox). */
  children?: ReactNode;
}

export function DataCard({
  title,
  cover,
  fields,
  layout,
  compact,
  coverClassName,
  folded,
  resolveNode,
  resolveNodeTitle,
  onOpenNode,
  className,
  children,
}: DataCardProps) {
  const chips = fields.filter(isCardChipField);
  const values = fields.filter((entry) => !isCardChipField(entry));
  const limits = compact ? COMPACT_LIMITS : LIMITS[layout];

  const coverBox =
    cover === undefined ? null : (
      <CardCoverBox
        cover={cover}
        title={title}
        naturalAspect={layout === "masonry"}
        resolveNode={resolveNode}
        className={coverClassName}
      />
    );

  const titleClass = cn(
    "min-w-0 leading-snug font-medium",
    layout === "list" || layout === "board" ? "truncate" : "line-clamp-2",
    compact ? "text-xs" : "text-[13px]",
  );

  const valueBox = (limit: number) => (
    <CardValueRows
      fields={values}
      limit={limit}
      resolveNodeTitle={resolveNodeTitle}
      onOpenNode={onOpenNode}
    />
  );

  const shell = cn(
    "relative flex overflow-hidden rounded-xl border border-border bg-card text-card-foreground",
    className,
  );

  if (layout === "list") {
    return (
      <div className={cn(shell, "h-full flex-row items-center gap-3 p-2")}>
        {cover !== undefined && (
          <div
            className={cn(
              "shrink-0 overflow-hidden rounded-lg bg-muted/60",
              coverClassName,
            )}
          >
            {/* The thumbnail box is the caller's size; the cover fills it. */}
            <CardCoverBox
              cover={cover ?? null}
              title={title}
              resolveNode={resolveNode}
            />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className={titleClass} title={title}>
            {title}
          </p>
          <CardChips fields={chips} limit={limits.chips} />
          {folded && valueBox(limits.rows)}
        </div>
        {!folded && values.length > 0 && (
          <div
            className={cn(
              "shrink-0 self-center border-l border-border/60 pl-3",
              LIST_VALUE_COLUMN,
            )}
          >
            {valueBox(limits.rows)}
          </div>
        )}
        {children}
      </div>
    );
  }

  return (
    <div className={cn(shell, "flex-col", layout !== "masonry" && "h-full")}>
      {cover !== undefined && (
        <div
          className={cn(
            "relative min-h-0 overflow-hidden bg-muted/50",
            // A grid tile is a fixed height, so the cover fills whatever the
            // footer leaves. A masonry card sizes itself from the image's own
            // ratio — that variance *is* the layout. A board card takes a fixed
            // ratio, because a lane has no height to hand it.
            layout === "grid" && "flex-1",
            layout === "board" && "aspect-[3/2] shrink-0",
          )}
        >
          {coverBox}
        </div>
      )}
      <div
        className={cn(
          "flex min-w-0 flex-col",
          compact ? "gap-1 p-2" : "gap-1.5 p-2.5",
        )}
      >
        <p className={titleClass} title={title}>
          {title}
        </p>
        <CardChips fields={chips} limit={limits.chips} />
        {valueBox(limits.rows)}
      </div>
      {children}
    </div>
  );
}
