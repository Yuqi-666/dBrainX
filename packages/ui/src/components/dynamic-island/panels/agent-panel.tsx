// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { IslandPanelHeader } from "./panel-header";

export function AgentPanel() {
  const { t } = useI18n();

  return (
    <>
      <IslandPanelHeader title={t("Agent")} />
      <div className="flex flex-1 items-center justify-center py-12 text-sm text-muted-foreground">
        {t("Agent mode coming soon")}{" "}
      </div>
    </>
  );
}
