// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { ColorPicker } from "@workspace/ui/components/selector/color-picker";

import { translate } from "@workspace/ui/lib/i18n/runtime";
import { useI18n } from "@workspace/ui/lib/i18n";

import { cloneElement, isValidElement, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { NodeIcon } from "@workspace/interfaces";
import { SmilePlus } from "lucide-react";
import { Button } from "@workspace/ui/components/ui/button";
import { CommandList } from "@workspace/ui/components/ui/command";
import { cn } from "@workspace/ui/lib/utils";
import { EMOJI_CATEGORIES } from "@workspace/ui/components/icon/emoji-set";
import { SelectorUploadPane } from "@workspace/ui/components/selector/shared/selector-upload-pane";
import { SelectorGrid } from "@workspace/ui/components/selector/shared/selector-grid";
import type { SelectorGridItem } from "@workspace/ui/components/selector/shared/selector-grid";
import { SelectorPopoverShell } from "@workspace/ui/components/selector/shared/selector-popover-shell";
import type { SelectorPopoverTab } from "@workspace/ui/components/selector/shared/selector-popover-shell";
import { SelectorSearchInput } from "@workspace/ui/components/selector/shared/selector-search-input";
import { SelectorUrlInput } from "@workspace/ui/components/selector/shared/selector-url-input";
import {
  LUCIDE_ICON_ENTRIES,
  IconView,
} from "@workspace/ui/components/icon/icon-view";

/** The three tab ids of sel §5. `url` is not a tab — it is the tail of `upload`. */
type IconSelectorTab = "emoji" | "icon" | "upload";

const TABS: SelectorPopoverTab[] = [
  {
    value: "emoji",
    get label() {
      return translate("Emoji");
    },
  },
  {
    value: "icon",
    get label() {
      return translate("图标");
    },
  },
  {
    value: "upload",
    get label() {
      return translate("上传");
    },
  },
];

const EMOJI_KEY_PREFIX = "emoji:";
const ICON_KEY_PREFIX = "icon:";

export interface IconSelectorPopoverProps {
  /** Required for uploads, which write directly to an existing node. */
  nodeId?: string;
  allowedKinds?: readonly NodeIcon["kind"][];
  showColorPicker?: boolean;
  /** Controlled; `undefined` means "no icon set". */
  value?: NodeIcon;
  /** Discrete picks fire immediately; the URL row fires on Enter / blur. */
  onChange: (next: NodeIcon | undefined) => void;
  /** When given, 「移除」 calls this instead of `onChange(undefined)`. */
  onRemove?: () => void;
  /** Given → disabled trigger (aria-disabled + title), the popover never opens. */
  disabledReason?: string;
  /** Upload `accept`; defaults to `image/*`. */
  accept?: string;
  /** The trigger; a 36×36 button is rendered when absent. */
  children?: ReactNode;
  /** Extra classes for the popover panel. */
  className?: string;
}

export function IconSelectorPopover({
  nodeId,
  allowedKinds = ["emoji", "icon", "image"],
  showColorPicker = true,
  value,
  onChange,
  onRemove,
  disabledReason,
  accept = "image/*",
  children,
  className,
}: IconSelectorPopoverProps): ReactNode {
  const { t } = useI18n();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<IconSelectorTab>("emoji");
  const [urlDraft, setUrlDraft] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const availableTabs = TABS.filter((candidate) =>
    candidate.value === "upload"
      ? Boolean(nodeId) && allowedKinds.includes("image")
      : allowedKinds.includes(candidate.value as "emoji" | "icon"),
  );
  const activeTab = availableTabs.some((candidate) => candidate.value === tab)
    ? tab
    : ((availableTabs[0]?.value as IconSelectorTab | undefined) ?? "icon");

  const disabled = Boolean(disabledReason);

  /** Every glyph pick keeps the current colour (sel §7 「换图但保留底色」). */
  const commit = (icon: NodeIcon) => {
    onChange(value?.color ? { ...icon, color: value.color } : icon);
  };

  /**
   * The grid item's `key` is `<kind>:<payload>` (the Emoji character from
   * `emoji-set.ts`, or the Lucide name from `LUCIDE_ICON_ENTRIES`); the active
   * tab is the discriminant. The tab cannot be `upload` here — that body renders
   * no grid.
   */
  const handleSelect = (item: SelectorGridItem) => {
    if (activeTab === "emoji") {
      commit({
        kind: "emoji",
        value: item.key.slice(EMOJI_KEY_PREFIX.length),
      });
      return;
    }
    commit({ kind: "icon", value: item.key.slice(ICON_KEY_PREFIX.length) });
  };

  /**
   * Rebuilds the whole icon from the live value — never `{ color }` alone.
   *
   * `color` is written **even when clearing** (G2-r1 第 2 条). The host merges the
   * value it receives onto a freshly re-read live icon (`{ ...live, ...next }`,
   * sel §7), so a `next` that merely *omits* the key is indistinguishable from
   * "leave the colour alone" and the old colour survived 无底色 — the key must be
   * present and `undefined` for the write to mean "no background". It
   * serialises away at the PocketBase boundary (`JSON.stringify` drops
   * `undefined` members), and the domain's `clearIcon`/`updateIcon` path is only
   * reached for a real icon, so the wire shape stays `{ kind, value }`.
   */
  const handleColor = (color: string | undefined) => {
    if (!value) return;
    onChange({ kind: value.kind, value: value.value, color });
  };

  const handleUrlSubmit = (url: string) => {
    commit({ kind: "image", value: url });
    setUrlDraft("");
  };

  const handleRemove = () => {
    if (onRemove) onRemove();
    else onChange(undefined);
  };

  const baseTrigger = children ?? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={value ? t("更换图标") : t("设置图标")}
    >
      <IconView
        icon={value}
        className="size-5 text-base"
        fallback={<SmilePlus className="size-5" />}
      />
    </Button>
  );

  const colorRow = (
    <div className="border-t border-border/60 bg-muted/15 p-2">
      <span className="px-1 text-[11px] font-medium text-muted-foreground">
        {t("底色")}
      </span>
      <ColorPicker
        className="p-1"
        value={value?.color}
        onChange={handleColor}
        onClear={() => handleColor(undefined)}
        clearLabel={t("无底色")}
        disabled={!value}
        aria-label={t("底色")}
      />
    </div>
  );

  return (
    <SelectorPopoverShell
      open={open && !disabled}
      onOpenChange={(next) => {
        if (disabled && next) return;
        setOpen(next);
      }}
      trigger={withTriggerDisabledState(baseTrigger, disabled, disabledReason)}
      tabs={availableTabs}
      activeTab={activeTab}
      onTabChange={(next) => setTab(next as IconSelectorTab)}
      width={320}
      bodyMaxHeight="min(280px, 35vh)"
      className={className}
      footer={showColorPicker ? colorRow : undefined}
      actions={
        // Always rendered, merely disabled when empty: a control that appears and
        // disappears pushes its left-hand neighbours around (sel §5 清除).
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("移除图标")}
          disabled={!value}
          onClick={handleRemove}
        >
          {t("移除")}{" "}
        </Button>
      }
    >
      {/* Only the grid tabs filter, so the search row only exists there. `autoFocus`
          is what puts the caret in it when the popover opens (sel §5 keyboard);
          its query belongs to the shell's `Command`, so it survives a tab switch. */}
      {activeTab === "upload" ? null : <SelectorSearchInput autoFocus />}
      {activeTab === "upload" && nodeId ? (
        // No `overflow-y-auto` of its own: the shell caps the body and lets either
        // the body wrapper or the `CommandList` scroll it, so a second viewport in
        // here would either be dead or clip the drop pane.
        <div className="flex flex-col gap-1 p-1">
          <SelectorUploadPane
            nodeId={nodeId}
            variant="icon"
            accept={accept}
            onUploadStart={() => setUploadError(null)}
            onError={(error) => setUploadError(error.message)}
          />
          <SelectorUrlInput
            value={urlDraft}
            onValueChange={setUrlDraft}
            onSubmit={handleUrlSubmit}
          />
          {uploadError ? (
            <p role="alert" className="px-1 text-xs text-destructive">
              {uploadError}
            </p>
          ) : null}
        </div>
      ) : (
        <CommandList>
          <SelectorGrid
            items={activeTab === "emoji" ? EMOJI_ITEMS : ICON_ITEMS}
            onSelect={handleSelect}
            columns={8}
            emptyState={
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("没有匹配的结果")}{" "}
              </p>
            }
          />
        </CommandList>
      )}
    </SelectorPopoverShell>
  );
}

/**
 * Puts the disabled affordances on whatever element is used as the trigger.
 *
 * The trigger comes from `children` (or the default button), and Radix needs a
 * single element — so it is cloned rather than wrapped, which also keeps
 * `Popover`'s "return focus to the trigger on close" pointing at the real
 * button. Opening itself is blocked by the controlled `open` guard above; this
 * only carries `aria-disabled` / `title` / the dimming.
 */
function withTriggerDisabledState(
  node: ReactNode,
  disabled: boolean,
  reason?: string,
): ReactNode {
  if (!isValidElement(node)) return node;
  const props = node.props as { className?: string; title?: string };
  return cloneElement(node as ReactElement<Record<string, unknown>>, {
    "aria-disabled": disabled || undefined,
    title: disabled ? reason : props.title,
    className: cn(props.className, disabled && "aria-disabled:opacity-50"),
  });
}

// ---------------------------------------------------------------------------
// P0 curated sets
// ---------------------------------------------------------------------------

/**
 * W1-A's `emoji-set.ts` (sel §3.1) — the Emoji tab's only data source, consumed
 * the way that module documents (`EMOJI_CATEGORIES` → `SelectorGridItem`), except
 * that its categories are **flattened into one `SelectorGrid`**: the frozen
 * `SelectorGrid` is a flat atom that owns filtering and the empty state, so one
 * grid per `CommandGroup` would draw one empty state per category while
 * searching. Every item still carries its category name as a filter keyword, and
 * the bottom 分类条 anchor bar is deferred with it (sel §2's skeleton).
 */
const EMOJI_ITEMS: SelectorGridItem[] = EMOJI_CATEGORIES.flatMap((category) =>
  category.items.map((item) => ({
    key: `${EMOJI_KEY_PREFIX}${item.emoji}`,
    label: item.name,
    keywords: [category.label, ...item.keywords],
    content: <span className="text-lg leading-none">{item.emoji}</span>,
  })),
);

/**
 * The `图标` tab renders W1-A's `LUCIDE_ICON_ENTRIES` — the **same** table
 * `NodeIconView` resolves persisted names against (sel §3.2 / plan §M2.2-3): a
 * second list here would drift from it and every name missing there would fall
 * back to the type glyph after a pick. Names only; `key` carries a prefix so an
 * icon key can never collide with an Emoji character.
 */
const ICON_ITEMS: SelectorGridItem[] = LUCIDE_ICON_ENTRIES.map((entry) => ({
  key: `${ICON_KEY_PREFIX}${entry.name}`,
  label: entry.name,
  keywords: entry.keywords,
  content: <entry.Icon className="size-4" aria-hidden />,
}));
