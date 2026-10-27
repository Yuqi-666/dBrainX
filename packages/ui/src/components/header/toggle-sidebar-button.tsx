// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useUIStore } from "@workspace/store";
import { Button } from "../ui/button";
import { PanelLeftIcon } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

interface ToggleSidebarButtonProps {
  className?: string;
}

export function ToggleSidebarButton({ className }: ToggleSidebarButtonProps) {
  const { sidebarMode, toggleSidebar, convertTempToFixed, showTempSidebar } =
    useUIStore();

  const handleClick = () => {
    if (sidebarMode === "closed" || sidebarMode === "temp") {
      if (sidebarMode === "temp") {
        convertTempToFixed();
      } else {
        toggleSidebar();
      }
    } else {
      toggleSidebar();
    }
  };

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={handleClick}
      className={cn(className)}
    >
      <PanelLeftIcon />
    </Button>
  );
}
