// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@workspace/ui/components/ui/button";
import { useUIStore } from "@workspace/store";

interface FullscreenButtonProps {
  className?: string;
}

export function FullscreenButton({ className }: FullscreenButtonProps) {
  const { t } = useI18n();

  const mainViewType = useUIStore((state) => state.mainViewType);
  const setMainViewType = useUIStore((state) => state.setMainViewType);

  const toggleFullscreen = () => {
    if (mainViewType === "editor") {
      setMainViewType(useUIStore.getState().editorReturnViewType);
    } else {
      setMainViewType("editor");
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleFullscreen}
      className={className}
      aria-label={mainViewType === "editor" ? t("退出全屏") : t("进入全屏")}
    >
      {mainViewType === "editor" ? <Minimize2 /> : <Maximize2 />}
    </Button>
  );
}
