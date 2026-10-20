// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useDataStore, useUIStore } from "@workspace/store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import { Button } from "@workspace/ui/components/ui/button";
import { viewDisplayName } from "@workspace/ui/lib/default-instance-name";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  LayoutDashboardIcon,
} from "lucide-react";

interface ViewSelectDropdownMenuProps {
  className?: string;
}

/**
 * 视图选择下拉菜单
 */
export function ViewSelectDropdownMenu({
  className,
}: ViewSelectDropdownMenuProps) {
  const { t } = useI18n();

  const views = useDataStore((state) => state.views);
  const currentViewId = useUIStore((state) => state.currentViewId);
  const setCurrentViewId = useUIStore((state) => state.setCurrentViewId);

  const viewList = Array.from(views.values());
  const currentView = currentViewId ? views.get(currentViewId) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="lg" className={className}>
          <LayoutDashboardIcon className="size-4 mr-1" />
          <span>
            {currentView ? viewDisplayName(currentView, t) : t("选择视图")}
          </span>
          <div className="flex flex-col items-center ml-1 leading-none">
            <ChevronUpIcon className="size-3" />
            <ChevronDownIcon className="size-3 -mt-1" />
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel>{t("视图列表")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {viewList.length === 0 ? (
          <DropdownMenuItem disabled>{t("暂无视图")}</DropdownMenuItem>
        ) : (
          viewList.map((view) => (
            <DropdownMenuItem
              key={view.id}
              onClick={() => setCurrentViewId(view.id)}
              data-active={view.id === currentViewId}
            >
              {view.isPinned && <span className="mr-1">📌</span>}
              {viewDisplayName(view, t)}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
