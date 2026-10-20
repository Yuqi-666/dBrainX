// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";
import { Input } from "@workspace/ui/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import type {
  DataView,
  DataViewId,
  DataViewSource,
  DataViewType,
} from "@workspace/interfaces";

import {
  getDataViewDescriptorsForKind,
  getDataViewDescriptor,
} from "../registry";

export interface ViewSwitcherProps {
  views: DataView[];
  activeViewId: DataViewId | undefined;
  source: DataViewSource;
  /** Omitted on read-only projections: tabs switch, but nothing is created. */
  onCreateView?: (type: DataViewType) => void;
  onActiveViewChange?: (id: DataViewId) => void;
  /** Omitted on read-only projections: tabs switch, but titles stay fixed. */
  onRenameView?: (id: DataViewId, name: string) => void;
  className?: string;
}

/**
 * Tab strip over the node's views plus the "new view" menu.
 *
 * A tab is renamed inline: double-click it, type, then Enter (or blur) commits
 * and Escape reverts. There is no separate name field — the tab *is* the name
 * field, so the toolbar's left edge belongs to the tab strip.
 *
 * Every tab occupies a FIXED-size slot and both the label and the inline editor
 * fill that slot (`w-full`), so opening the editor cannot resize a tab or
 * reflow the strip — it only swaps what is painted inside.
 *
 * The tabs sit in a recessed segmented track: the active tab is the only one
 * that reads as raised, so "where am I" is answered by shape rather than by
 * color, which stays reserved for state the user has set on the data.
 *
 * The menu only lists view types whose descriptor allows the current source
 * kind, which is how the capability matrix (README §7) is enforced.
 */
export function ViewSwitcher({
  views,
  activeViewId,
  source,
  onCreateView,
  onActiveViewChange,
  onRenameView,
  className,
}: ViewSwitcherProps) {
  const { t } = useI18n();

  const creatableDescriptors = getDataViewDescriptorsForKind(source.kind);

  const [editingId, setEditingId] = useState<DataViewId | null>(null);
  const [draftName, setDraftName] = useState("");
  /** Escape blurs the input; this keeps that blur from committing the draft. */
  const cancelRef = useRef(false);

  const startRename = (view: DataView) => {
    if (!onRenameView) return;
    setDraftName(view.name);
    setEditingId(view.id);
  };

  const commitRename = (view: DataView) => {
    setEditingId(null);
    if (cancelRef.current) {
      cancelRef.current = false;
      setDraftName(view.name);
      return;
    }
    const name = draftName.trim();
    // An empty title is not a valid view name (the domain rejects it), so an
    // empty draft reverts instead of persisting.
    if (!name || name === view.name) {
      setDraftName(view.name);
      return;
    }
    onRenameView?.(view.id, name);
  };

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-lg bg-muted/60 p-0.5",
        className,
      )}
    >
      {views.map((view) => {
        const descriptor = getDataViewDescriptor(view.type);
        const Icon = descriptor.icon;
        const active = view.id === activeViewId;
        const editing = view.id === editingId;

        return (
          // Fixed slot: the tab's size comes from this box, never from its
          // content, so swapping the label for the inline editor is a no-op
          // layout-wise.
          <div key={view.id} className="flex h-6 w-36 shrink-0 items-center">
            {editing ? (
              <Input
                autoFocus
                value={draftName}
                aria-label={t("视图名称")}
                className="h-6 w-full rounded-md px-1.5 text-xs md:text-xs"
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={() => commitRename(view)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRef.current = true;
                    event.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-pressed={active}
                className={cn(
                  "h-6 w-full gap-1.5 rounded-md px-2 text-xs hover:bg-background/70",
                  active
                    ? "bg-background text-foreground shadow-xs hover:bg-background"
                    : "text-muted-foreground",
                )}
                onClick={() => onActiveViewChange?.(view.id)}
                onDoubleClick={() => startRename(view)}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">
                  {view.name}
                </span>
              </Button>
            )}
          </div>
        );
      })}

      {onCreateView && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="shrink-0 text-muted-foreground"
              aria-label={t("新建视图")}
            >
              <Plus className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {creatableDescriptors.map((descriptor) => {
              const Icon = descriptor.icon;
              return (
                <DropdownMenuItem
                  key={descriptor.type}
                  onSelect={() => onCreateView(descriptor.type)}
                >
                  <Icon className="size-4" />
                  {descriptor.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
