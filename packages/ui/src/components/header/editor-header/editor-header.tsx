// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { ToggleSidebarButton } from "../toggle-sidebar-button";
import { DashboardCandidateButton } from "./dashboard-candidate-button";
import { FullscreenButton } from "./fullscreen-button";
import { PinButton } from "./pin-button";
import { NodeTitle } from "./node-title";
import { OptionsMenu } from "./options-menu";
import { Button } from "@workspace/ui/components/ui/button";
import { useDataStore, useUIStore } from "@workspace/store";
import { InfoIcon } from "lucide-react";
import type { NodeDataType } from "@workspace/interfaces";

/**
 * Node types whose **content** draws its own page header — cover, icon, title,
 * summary, semantic pill (`node-content-header.tsx`).
 *
 * For these, the editor header drops its icon and cover buttons: both would
 * render the same `node.icon` / `node.cover`, and the plan requires an explicit
 * choice rather than two live entries (`docs/plan/node-content-ui.md` §M3.2-2
 * 方案 A — G3 第 6 条 judges it). Only `rich-text` is in the set today; `text`
 * keeps its entries, because it has no content header.
 */

interface EditorHeaderProps {
  className?: string;
}

export function EditorHeader({ className }: EditorHeaderProps) {
  const currentEditingNodeId = useUIStore(
    (state) => state.currentEditingNodeId,
  );
  const sidebarMode = useUIStore((state) => state.sidebarMode);
  const mainViewType = useUIStore((state) => state.mainViewType);
  const toggleAttributesSidebar = useUIStore(
    (state) => state.toggleAttributesSidebar,
  );
  const currentNode = useDataStore((state) =>
    currentEditingNodeId ? state.getNode(currentEditingNodeId) : undefined,
  );
  return (
    <header
      className={` z-10 flex flex-shrink-0 items-center justify-between pt-4 pb-2 px-6 ${className || ""}`}
    >
      <div className="flex flex-1 justify-start items-center gap-0">
        <FullscreenButton />
        {mainViewType === "editor" && (
          <div
            className={`flex items-center gap-0 p-0.5 transition-all  bg-background text-foreground z-10 pointer-events-auto ${sidebarMode === "fixed" ? "opacity-0" : ""}`}
          >
            <ToggleSidebarButton />
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 pointer-events-auto">
        <NodeTitle className="text-center border-none" />
      </div>

      <div
        className={`flex flex-1 justify-end items-center gap-0 p-0.5 transition-all rounded-lg border-none z-10 pointer-events-auto text-foreground `}
      >
        <DashboardCandidateButton nodeId={currentEditingNodeId} />
        <PinButton />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => toggleAttributesSidebar()}
        >
          <InfoIcon className="size-4" />
        </Button>
        <OptionsMenu nodeId={currentEditingNodeId} />
      </div>
    </header>
  );
}
