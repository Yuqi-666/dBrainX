// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useUIStore } from "@workspace/store";
import { cn } from "@workspace/ui/lib/utils";
import { Toaster } from "@workspace/ui/components/ui/toast";
import { useFloatingPanel } from "@workspace/ui/hooks/use-floating-panel";
import { useRef } from "react";

interface CognitiveGraphLayoutProps {
  children: React.ReactNode;
  /**
   * Sidebar content — or `null` for a surface that has no sidebar at all (the
   * dashboard). A `null` sidebar also removes the left hover edge: leaving it
   * armed would let a pointer brushing the rim open an empty floating panel on
   * top of the page. `sidebarMode` itself is left untouched, so a `fixed`
   * sidebar comes back on its own when the graph does.
   */
  sidebar: React.ReactNode;
}

export function MainLayout({ children, sidebar }: CognitiveGraphLayoutProps) {
  const sidebarMode = useUIStore((state) => state.sidebarMode);
  const closeSidebar = useUIStore((state) => state.closeSidebar);
  const showTempSidebar = useUIStore((state) => state.showTempSidebar);
  const sidebarRef = useRef<HTMLDivElement | null>(null);

  const handleMouseEnterEdge = () => {
    if (sidebarMode === "closed") {
      showTempSidebar();
    }
  };

  // The graph sidebar and both dashboard panels share one rule for a floating
  // panel: it stays up while the pointer is on it (or on a menu it opened).
  useFloatingPanel(sidebarMode, sidebarRef, closeSidebar);

  const isFixedMode = sidebarMode === "fixed";
  const isTempMode = sidebarMode === "temp";
  const hasSidebar = Boolean(sidebar);

  return (
    <div className="relative flex h-dvh w-full overflow-hidden">
      {hasSidebar && !isFixedMode && (
        <div
          className="absolute left-0 top-0 z-30 h-full w-3 "
          onMouseEnter={handleMouseEnterEdge}
        />
      )}

      {hasSidebar && (
        <div
          ref={sidebarRef}
          className={cn(
            "h-full shrink-0 transition-all duration-200 ease-in-out",
            isFixedMode && "w-64 relative z-30",
            isTempMode && "fixed left-0 top-0 z-40 w-64 shadow-lg",
            sidebarMode === "closed" && "hidden",
          )}
        >
          {sidebar}
        </div>
      )}

      <main className="relative flex-1">{children}</main>

      {/* One Toaster for the whole shell. It stays mounted while a node
          dialog opens and closes, so an upload that finishes after the dialog
          closed still surfaces its success toast. Both apps inherit this:
          apps/desktop re-exports apps/web's (main) layout, which renders
          WorkspaceShell -> MainLayout. */}
      <Toaster />
    </div>
  );
}
