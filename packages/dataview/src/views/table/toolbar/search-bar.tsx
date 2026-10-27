// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The table's search bar — a **second row** under the view toolbar, shown only
 * while the 搜索 button in the function group is engaged.
 *
 * Why it is not inside the toolbar's function group any more: that group is
 * right-anchored, so in a flex row an item's x position depends only on the
 * widths of the items *after* it — a control whose own content changes size on
 * every re-render moves itself and everything to its left. The query box is
 * exactly such a control: its inner addon (match counter + prev/next/clear)
 * appears and grows/shrinks on every keystroke, so the caret area jumped ~100px
 * on the first character and ~20px per counter change while the whole function
 * area shifted with it. Keeping the toolbar's function group to fixed-size
 * buttons and giving the search box its own row removes that class of jitter
 * (`docs/dataview/table.md` §5.3.1).
 *
 * The row is left-aligned and independent: nothing in it can move the toolbar
 * above, only the table below (which is the expected cost of opening search).
 *
 * **Esc has to be taken away from the surrounding dialog.** The table is edited
 * inside a node-editor `Dialog`, and Radix dismisses a layer from a `keydown`
 * listener on `document` **in the capture phase**, registered when the dialog
 * mounted — long before this row. So a handler on the input cannot keep Esc
 * local: by the time React's listener runs, `document`'s capture has already
 * fired and the dialog is on its way out (measured: Esc in the search box closed
 * the whole node editor). `window` is the one node earlier in the capture path,
 * so the veto lives there — see the effect below.
 */
import { useEffect, useRef, type FocusEvent } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/ui/input-group";

/**
 * True for Escape in each shape it arrives in: `key` is the modern spelling,
 * `code` still names the physical key when a remap or an input method reports
 * the keystroke without a usable `key`.
 */
function isEscapeKey(event: { key?: string; code?: string }): boolean {
  return event.key === "Escape" || event.code === "Escape";
}

export interface TableSearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** Number of matches in the current data. */
  matchCount: number;
  /** Zero-based index of the highlighted match, `-1` when there is none. */
  index: number;
  onStep: (direction: 1 | -1) => void;
  /** Closes the bar — the shell also clears the query so no highlight lingers. */
  onClose: () => void;
  className?: string;
}

export function TableSearchBar({
  query,
  onQueryChange,
  matchCount,
  index,
  onStep,
  onClose,
  className,
}: TableSearchBarProps) {
  const { t } = useI18n();

  const rowRef = useRef<HTMLDivElement>(null);
  /** `onClose` is an inline arrow upstream; the veto listener mounts once. */
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  /**
   * Esc closes the search, not the node editor it lives in.
   *
   * Radix's dismissable layers handle Escape from `document` in the **capture**
   * phase and dismiss unless the event is already default-prevented. The dialog
   * registered that listener before this row existed, so preventing the event
   * from the input is too late — `window` capture is the only earlier stop. The
   * veto is scoped to the row (a keystroke aimed anywhere else keeps its normal
   * meaning, so an open menu still closes on Esc), and this listener — not the
   * input — owns the close, so Esc works with focus on the counter buttons too.
   *
   * `keyup` is listened to as well: the close is idempotent, and an environment
   * that hands the app only the release of the key (an IME, a host page, an
   * extension) otherwise leaves the row open with nothing to close it. The
   * input's own React handler is a third path — it cannot stop the dialog on
   * its own, but if the row is still mounted when it runs, the capture listener
   * never fired.
   */
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (!isEscapeKey(event)) return;
      if (!rowRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", handleEscape, true);
    window.addEventListener("keyup", handleEscape, true);
    return () => {
      window.removeEventListener("keydown", handleEscape, true);
      window.removeEventListener("keyup", handleEscape, true);
    };
  }, []);

  /**
   * The Esc that never arrives — see {@link handleRowBlur}.
   *
   * Timestamped: the `focusout` a press causes fires inside the `pointerdown`
   * dispatch itself, so "a press just happened" is what tells a click apart
   * from a key — and unlike a boolean it cannot get stuck when a `pointerup`
   * never reaches the window.
   */
  const pointerAt = useRef(0);

  /**
   * Closes the row when the caret is dropped without a destination — which is
   * what Escape looks like from inside the page when something else owns the
   * key.
   *
   * Keyboard-driven browser extensions in "insert mode" (Vimium and friends),
   * some input methods and some hosts consume Escape **only while a text field
   * has focus**: they blur the field and stop the event, so no listener of ours
   * ever sees a key. The observable remainder is this exact shape — a
   * `focusout` whose new target is nothing (`null`/body), with no pointer press
   * behind it. A click always leaves a destination (the canvas, a button, the
   * rows' focus control) or is preceded by `pointerdown`, and Tab moves to a
   * real element, so those keep the row open exactly as before.
   */
  const handleRowBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next && rowRef.current?.contains(next as Node)) return;
    if (next) return;
    if (Date.now() - pointerAt.current < 300) return;
    closeRef.current();
  };

  useEffect(() => {
    const markPointer = () => {
      pointerAt.current = Date.now();
    };
    window.addEventListener("pointerdown", markPointer, true);
    return () => window.removeEventListener("pointerdown", markPointer, true);
  }, []);

  return (
    <div
      ref={rowRef}
      data-dataview-table-search
      onBlur={handleRowBlur}
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-2",
        className,
      )}
    >
      <InputGroup className="h-7 w-80 rounded-md bg-background">
        <InputGroupAddon align="inline-start" className="py-0 pr-0 pl-2">
          <Search className="size-3.5" />
        </InputGroupAddon>
        <InputGroupInput
          autoFocus
          value={query}
          placeholder={t("搜索表格")}
          aria-label={t("搜索表格")}
          className="h-7 text-xs"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (matchCount > 0) onStep(event.shiftKey ? -1 : 1);
              return;
            }
            if (isEscapeKey(event)) {
              // The capture listener above normally closed the row before this
              // handler runs; still being here means it never fired (a stopped
              // event, a stale listener), so close from the React path too.
              event.preventDefault();
              onClose();
            }
          }}
        />
        <InputGroupAddon align="inline-end" className="gap-0.5 py-0 pr-1 pl-0">
          {query && (
            <span
              className={cn(
                "px-1 text-[11px] tabular-nums",
                matchCount === 0 ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {matchCount === 0 ? t("无结果") : `${index + 1}/${matchCount}`}
            </span>
          )}
          <InputGroupButton
            size="icon-xs"
            aria-label={t("上一个匹配")}
            disabled={matchCount === 0}
            onClick={() => onStep(-1)}
          >
            <ChevronUp className="size-3.5" />
          </InputGroupButton>
          <InputGroupButton
            size="icon-xs"
            aria-label={t("下一个匹配")}
            disabled={matchCount === 0}
            onClick={() => onStep(1)}
          >
            <ChevronDown className="size-3.5" />
          </InputGroupButton>
          <InputGroupButton
            size="icon-xs"
            aria-label={t("关闭搜索")}
            onClick={onClose}
          >
            <X className="size-3.5" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
