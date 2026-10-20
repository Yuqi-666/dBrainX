// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useMemo, useState } from "react";
import type { Workspace } from "@workspace/interfaces";
import { WorkspaceService } from "@workspace/services";
import { useAuthStore, useUIStore, useWorkspaceStore } from "@workspace/store";
import { Button } from "@workspace/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import { Separator } from "@workspace/ui/components/ui/separator";
import {
  Check,
  ChevronDownIcon,
  ChevronUpIcon,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  DeleteWorkspaceDialog,
  EditWorkspaceDialog,
} from "@workspace/ui/components/dialog/workspace-dialog";
import { WorkspaceIcon } from "@workspace/ui/components/icon/workspace-icon";
import { workspaceDisplayName } from "@workspace/ui/lib/default-instance-name";
import { cn } from "@workspace/ui/lib/utils";

export interface WorkSpaceSelectorProps {
  /**
   * Edge of the trigger the menu opens from. Defaults to `right`: the sidebar
   * panel is narrower than the menu, so dropping it downward would cover the
   * list it sits next to. A wide host such as the dashboard header passes
   * `bottom`.
   */
  side?: "top" | "right" | "bottom" | "left";
  /**
   * Gap in px between trigger and menu. Defaults to 12 for `side="right"` —
   * enough to clear the sidebar's right border — and 4 otherwise, matching the
   * other header menus.
   */
  sideOffset?: number;
}

/**
 * Workspace picker that owns its whole dropdown, trigger and manage dialogs.
 *
 * Reads the workspace list from the store, switches through
 * `WorkspaceService.open`, creates through the global workspace dialog and
 * edits/deletes through the two local dialogs. Only the owner of a workspace
 * sees the edit and delete entries: a shared workspace cannot be changed or
 * removed by a member.
 *
 * Every host can mount it without props. Styles use the sidebar tokens, which
 * resolve globally — the sidebar and the dashboard header both mount it as is.
 */
export function WorkSpaceSelector({
  side = "right",
  sideOffset,
}: WorkSpaceSelectorProps) {
  const { t } = useI18n();

  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const currentWorkspaceId = useWorkspaceStore(
    (state) => state.currentWorkspaceId,
  );
  const openCreateWorkspaceDialog = useUIStore(
    (state) => state.openWorkspaceCreateDialog,
  );
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Workspace | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);

  const workspaceList = useMemo(
    () => Array.from(workspaces.values()),
    [workspaces],
  );
  const currentWorkspace = workspaceList.find(
    (w) => w.id === currentWorkspaceId,
  );

  const handleSelect = async (workspace: Workspace) => {
    if (workspace.id === currentWorkspaceId) return;
    try {
      await WorkspaceService.open(workspace.id);
    } catch (err) {
      console.error("[WorkSpaceSelector] switch workspace failed:", err);
    }
  };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-between px-2.5 h-10 rounded-lg hover:bg-sidebar-accent transition-colors duration-200 group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <WorkspaceIcon
                icon={currentWorkspace?.icon}
                className="size-4 text-sidebar-primary"
                glyphClassName="size-4"
              />
              <span className="text-[13px] font-medium text-sidebar-foreground truncate">
                {currentWorkspace
                  ? workspaceDisplayName(currentWorkspace, t)
                  : t("Select workspace")}
              </span>
            </div>
            <div className="flex items-center text-sidebar-foreground/40 group-hover:text-sidebar-foreground/60 transition-colors">
              <div className="flex flex-col items-center ml-1 leading-none">
                <ChevronUpIcon className="size-3" />
                <ChevronDownIcon className="size-3 -mt-1" />
              </div>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side={side}
          sideOffset={sideOffset ?? (side === "right" ? 12 : 4)}
          className="w-56 rounded-xl border-sidebar-border bg-sidebar p-1.5 shadow-lg"
        >
          {workspaceList.length > 0 ? (
            workspaceList.map((workspace) => {
              const isCurrent = workspace.id === currentWorkspaceId;
              const canManage =
                currentUserId !== null && workspace.ownerId === currentUserId;

              return (
                // Same row geometry as the sidebar's node and view items: the
                // row owns the hover/selection background, the icon and title
                // sit on the left, and the actions appear on hover on the right.
                <div
                  key={workspace.id}
                  className={cn(
                    "group flex items-center justify-between rounded-lg px-2.5 py-2 transition-colors duration-150 cursor-pointer",
                    isCurrent
                      ? "bg-sidebar-accent/70"
                      : "hover:bg-sidebar-accent",
                    "has-[[data-highlighted]]:bg-sidebar-accent",
                  )}
                >
                  <DropdownMenuItem
                    onSelect={() => void handleSelect(workspace)}
                    className="min-w-0 flex-1 gap-2.5 rounded-none bg-transparent p-0 text-[13px] text-sidebar-foreground focus:bg-transparent focus:text-sidebar-foreground cursor-pointer"
                  >
                    <WorkspaceIcon
                      icon={workspace.icon}
                      className="size-3.5 text-sidebar-foreground/30"
                      glyphClassName="size-3.5"
                    />
                    <span className="truncate">
                      {workspaceDisplayName(workspace, t)}
                    </span>
                  </DropdownMenuItem>
                  <div className="flex h-7 items-center gap-0.5">
                    {isCurrent && (
                      <Check className="size-3.5 shrink-0 text-sidebar-primary" />
                    )}
                    {canManage && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger
                          aria-label={t("工作区操作")}
                          title={t("工作区操作")}
                          className="size-7 justify-center rounded-md p-0 text-sidebar-foreground/30 opacity-0 pointer-events-none transition-opacity duration-150 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100 [&_svg:not([class*=size-])]:size-3"
                        >
                          <MoreHorizontal />
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-52 rounded-xl border-sidebar-border bg-sidebar p-1.5 shadow-lg">
                          <DropdownMenuItem
                            onSelect={() => setEditTarget(workspace)}
                            className="rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus:bg-sidebar-accent focus:text-sidebar-accent-foreground transition-colors cursor-pointer"
                          >
                            <Pencil className="mr-2 size-4" />
                            {t("编辑")}
                          </DropdownMenuItem>
                          {/* The default workspace is structural: it is what a
                              new user always has and cannot be removed. Hide the
                              delete entry instead of failing after a confirm. */}
                          {!workspace.isDefault && (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setDeleteTarget(workspace)}
                              className="rounded-lg px-2.5 py-2 text-[13px]"
                            >
                              <Trash2 className="mr-2 size-4" />
                              {t("删除")}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="px-2.5 py-2.5 text-[12px] text-sidebar-foreground/40 italic">
              {t("No workspaces")}{" "}
            </p>
          )}
          <Separator className="my-1.5 bg-sidebar-border" />
          <DropdownMenuItem
            onSelect={() => openCreateWorkspaceDialog()}
            className="gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-sidebar-primary hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors cursor-pointer"
          >
            <Plus className="size-3.5" />
            {t("Create new workspace")}{" "}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditWorkspaceDialog
        workspace={editTarget}
        onClose={() => setEditTarget(null)}
      />
      <DeleteWorkspaceDialog
        workspace={deleteTarget}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}
