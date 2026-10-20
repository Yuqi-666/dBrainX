// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { SearchIcon } from "lucide-react";
import { Button } from "@workspace/ui/components/ui/button";
import { useUIStore } from "@workspace/store";

interface ToggleSearchButtonProps {
  className?: string;
}

/**
 * 打开灵动岛搜索面板的按钮
 */
export function ToggleSearchButton({ className }: ToggleSearchButtonProps) {
  const { t } = useI18n();

  const setIslandPanel = useUIStore((state) => state.setIslandPanel);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setIslandPanel("search")}
      className={className}
      aria-label={t("打开搜索面板")}
    >
      <SearchIcon />
    </Button>
  );
}
