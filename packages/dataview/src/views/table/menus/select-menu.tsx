// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * 单选 / 多选 — the option dropdown a capsule cell opens.
 *
 * The cell itself is canvas (VTable `customRender`, `canvas/pill.ts`): the active
 * cell draws its capsules plus a "×" on each and a chevron at its right edge,
 * and the chevron (or a second click on the cell) opens this panel, anchored —
 * through an invisible trigger placed at the cell's viewport rect — directly
 * under the cell it belongs to.
 *
 * Contents, top to bottom: the 查找或创建选项 box (a real input, so the list
 * filters as the user types) and the option rows, each showing the option as the
 * same colour capsule the cell draws. A name the field does not have yet offers
 * a 创建 row (database hosts only).
 *
 * Two behaviours the design pins down:
 *
 * - **单选 closes after a pick, 多选 stays open.** The panel is controlled by the
 *   shell, and the shell is also the one that decided `optionIds` — this file
 *   only reports the pick.
 * - **The panel is a `Popover` + `Command`, never a hand-positioned panel.**
 *   `Command` brings the roving highlight (the first row is highlighted on open,
 *   which is what the design's grey row is), the pointer-move highlight, keyboard
 *   navigation and `scrollIntoView`; the input drives its own filtering through
 *   `shouldFilter={false}` because the panel also has to inject the 创建 row.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus } from "lucide-react";
import { Input } from "@workspace/ui/components/ui/input";
import { cn } from "@workspace/ui/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/ui/popover";
import type { DatabaseField, DatabaseFieldOption } from "@workspace/interfaces";

import { contrastTextColor } from "../../../shared/color";
import { matchesText, resolveOptionColor } from "../../../shared/field-meta";

/** Viewport rect of the cell the panel hangs off. */
export interface SelectMenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The cell a request opens the panel for. */
export interface SelectMenuRequest {
  /** Bumped per request so asking for the same cell twice re-opens the panel. */
  id: number;
  rowId: string;
  fieldId: string;
  anchor: SelectMenuAnchor;
}

export interface TableSelectMenuProps {
  /** The open request, or `null` when the panel is closed. */
  request: SelectMenuRequest | null;
  /** The field the cell belongs to; absent while nothing is open. */
  field?: DatabaseField;
  /** Option ids the cell holds right now (drives the trailing check marks). */
  selectedIds: readonly string[];
  /** A brand-new option may be appended to the field (database hosts only). */
  canCreateOption: boolean;
  onDismiss: () => void;
  onSelectOption: (optionId: string) => void;
  onCreateOption: (name: string) => void;
  className?: string;
}

/**
 * One option as the cell paints it: a capsule in the option's own colour with a
 * derived contrasting label (the same pairing `canvas/pill.ts` uses on canvas).
 */
function OptionCapsule({
  option,
  index,
}: {
  option: DatabaseFieldOption;
  index: number;
}) {
  useI18n();

  const color = resolveOptionColor(option, index);
  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center rounded-full px-2 py-1 text-xs leading-none font-medium"
      style={{ backgroundColor: color, color: contrastTextColor(color) }}
    >
      <span className="truncate">{option.name || option.id}</span>
    </span>
  );
}

export function TableSelectMenu({
  request,
  field,
  selectedIds,
  canCreateOption,
  onDismiss,
  onSelectOption,
  onCreateOption,
  className,
}: TableSelectMenuProps) {
  const { t } = useI18n();

  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * The anchor outlives the request on purpose.
   *
   * Radix keeps the content mounted through its exit animation (`data-closed:
   * animate-out`), but the trigger below is rendered only while a request is
   * live — so the moment the panel closed, floating-ui measured a node that was
   * no longer in the document (every edge zero) and parked the panel in the
   * page's top-left corner for ~130 ms before fading it out (measured: the panel
   * jumped from `588,231` to `0,0`). Remembering the last rect keeps the
   * trigger — and therefore the panel — exactly where it was for the fade.
   */
  const anchorRef = useRef<SelectMenuAnchor | null>(null);
  useEffect(() => {
    if (request) anchorRef.current = request.anchor;
  }, [request]);
  const anchor = request?.anchor ?? anchorRef.current;

  const options = useMemo(() => field?.options ?? [], [field]);
  const multi = field?.type === "multiSelect";
  const trimmed = query.trim();
  const matches = useMemo(
    () =>
      options
        .map((option, index) => ({ option, index }))
        .filter(({ option }) => matchesText(option.name || option.id, trimmed)),
    [options, trimmed],
  );
  const canCreate =
    canCreateOption &&
    trimmed.length > 0 &&
    !options.some(
      (option) =>
        (option.name || option.id).trim().toLocaleLowerCase() ===
        trimmed.toLocaleLowerCase(),
    );

  // A request is a fresh panel: never inherit the previous cell's search.
  useEffect(() => {
    setQuery("");
  }, [request?.id]);

  /**
   * 多选 picks leave the panel open for the next one, so the caret goes back to
   * the search box: pick, type, pick again — without clicking the input again.
   */
  const idsKey = selectedIds.join("\u0001");
  useEffect(() => {
    if (!request || !multi) return;
    inputRef.current?.focus();
  }, [idsKey, multi, request]);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <Popover
      open={Boolean(request)}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      {anchor &&
        typeof document !== "undefined" &&
        createPortal(
          /**
           * A canvas cell has no DOM node to hang a panel off, so the trigger is
           * an invisible box pinned to the cell's viewport rect.
           */
          <PopoverTrigger asChild>
            <span
              data-dataview-select-anchor
              aria-hidden
              style={{
                position: "fixed",
                left: anchor.x,
                top: anchor.y,
                width: anchor.width,
                height: anchor.height,
              }}
            />
          </PopoverTrigger>,
          document.body,
        )}
      <PopoverContent
        data-dataview-select-menu={request?.id ?? "closed"}
        side="bottom"
        align="start"
        sideOffset={0}
        collisionPadding={8}
        // The search box owns the caret; Radix would otherwise focus the panel.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        className={cn(
          "w-[var(--radix-popover-trigger-width)] max-w-[20rem] min-w-56 gap-0 overflow-hidden p-0",
          className,
        )}
      >
        {/**
         * The search box lives **inside** `Command`: cmdk binds ↑/↓/Home/End/Enter
         * to its own root's keydown, so an input rendered as its sibling would
         * filter the list but leave the keyboard dead (`Command` brings no
         * `CommandInput` of its own here — the panel needs the design's
         * borderless box, and the create row is injected around cmdk's filtering,
         * hence `shouldFilter={false}`).
         */}
        <Command
          shouldFilter={false}
          className={cn("rounded-none! bg-transparent p-0")}
        >
          <div className="flex items-center gap-1 border-b border-border px-2.5">
            <Input
              ref={inputRef}
              data-dataview-select-search
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                canCreateOption ? t("查找或创建选项") : t("查找选项")
              }
              aria-label={t("查找或创建选项")}
              className="h-8 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </div>
          <CommandList aria-multiselectable={multi} className="max-h-64 p-1">
            <CommandEmpty className="py-4 text-xs text-muted-foreground">
              {t("没有匹配的选项")}{" "}
            </CommandEmpty>
            {matches.map(({ option, index }) => (
              <CommandItem
                key={option.id}
                value={option.id}
                // Radix-free checked styling: the shadcn item draws its trailing
                // check off this attribute (cmdk itself only tracks the
                // highlighted item).
                data-checked={selected.has(option.id) ? true : undefined}
                className="gap-2 rounded-md px-1.5 py-1"
                onSelect={() => onSelectOption(option.id)}
              >
                <OptionCapsule option={option} index={index} />
              </CommandItem>
            ))}
            {canCreate && (
              <CommandItem
                value={`__create__${trimmed}`}
                className="gap-2 rounded-md px-1.5 py-1.5 text-xs"
                onSelect={() => onCreateOption(trimmed)}
              >
                <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {t("创建「")}
                  {trimmed}」
                </span>
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
