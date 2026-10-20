// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * View-level actions — the 更多 menu (设为默认视图 / 复制视图 / 删除视图).
 *
 * The design change moved these out of the **tab strip** and into the **view
 * toolbar's function area**: the strip is navigation (tabs + 新建视图) and
 * nothing else, while 更多 now sits next to the other view functions (导出 /
 * 搜索) where a user looks for "what can I do with this view". The strip's
 * right-hand button pair (tabs + 更多) is what used to make the strip's content
 * jump around; the toolbar's function group is a fixed-size group (see
 * `docs/dataview/table.md` §5.3.1).
 *
 * The menu is built by the shell (`DataViewRoot`), because it mutates the view
 * list, and handed to whichever toolbar the active renderer draws through a
 * slot context. That way every view participates — including the six
 * placeholders, which all render `ViewToolbar` — without the renderer props
 * contract growing a non-serializable React node, and without this file
 * knowing anything about the renderer that shows it.
 */
import { createContext, useContext, type ReactNode } from "react";
import { Copy, MoreHorizontal, Star, Trash2 } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import type { DataView, DataViewId } from "@workspace/interfaces";

import { createDataViewId } from "../defaults";

/** The shell's actions node, `undefined` when the host forbids view CRUD. */
const ViewActionsContext = createContext<ReactNode>(undefined);

/** Publishes the shell's 更多 menu to the active renderer's toolbar. */
export function ViewActionsProvider({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) {
  useI18n();

  return (
    <ViewActionsContext.Provider value={actions}>
      {children}
    </ViewActionsContext.Provider>
  );
}

/**
 * The 更多 menu to render at the end of a toolbar's function group — `null`
 * when the host does not allow view management.
 *
 * A view must render it somewhere in its toolbar to stay feature-complete; the
 * table's own `TableToolbar` and the shared `ViewToolbar` both do.
 */
export function useViewActions(): ReactNode {
  useI18n();

  return useContext(ViewActionsContext);
}

export interface ViewActionsMenuProps {
  views: DataView[];
  activeView: DataView;
  /** Absent when the host does not allow view management. */
  onViewsChange?: (views: DataView[]) => void;
  onActiveViewChange?: (id: DataViewId) => void;
  className?: string;
}

/**
 * 更多 — the per-view actions, rendered in the view toolbar.
 *
 * Every mutation produces a new `DataView[]` handed to `onViewsChange`; the
 * menu never persists anything itself (README §3.4).
 */
export function ViewActionsMenu({
  views,
  activeView,
  onViewsChange,
  onActiveViewChange,
  className,
}: ViewActionsMenuProps) {
  const { t } = useI18n();

  if (!onViewsChange) return null;

  const duplicateActiveView = () => {
    const copy: DataView = {
      ...activeView,
      id: createDataViewId(),
      name: translate("{value1} 副本", { value1: activeView.name }),
      isDefault: false,
    };
    onViewsChange([...views, copy]);
    onActiveViewChange?.(copy.id);
  };

  const deleteActiveView = () => {
    if (views.length <= 1) return;
    const remaining = views.filter((view) => view.id !== activeView.id);
    // Never leave the node without a default view.
    if (activeView.isDefault && remaining[0]) {
      remaining[0] = { ...remaining[0], isDefault: true };
    }
    onViewsChange(remaining);
    onActiveViewChange?.(remaining[0]?.id ?? "");
  };

  const setActiveViewAsDefault = () => {
    onViewsChange(
      views.map((view) => ({
        ...view,
        isDefault: view.id === activeView.id,
      })),
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={t("更多")}
          className={cn(
            "h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground",
            className,
          )}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem
          onSelect={setActiveViewAsDefault}
          disabled={activeView.isDefault}
        >
          <Star className="size-4" />
          {t("设为默认视图")}{" "}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={duplicateActiveView}>
          <Copy className="size-4" />
          {t("复制视图")}{" "}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={deleteActiveView}
          disabled={views.length <= 1}
        >
          <Trash2 className="size-4" />
          {t("删除视图")}{" "}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
