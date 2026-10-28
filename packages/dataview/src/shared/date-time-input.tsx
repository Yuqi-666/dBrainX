// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { Input } from "@workspace/ui/components/ui/input";
import { useI18n } from "@workspace/ui/lib/i18n";

export function DateTimeInput({
  date,
  onChange,
}: {
  date: Date | null;
  onChange: (date: Date) => void;
}) {
  const { t } = useI18n();
  const time = date
    ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
    : "00:00";
  return (
    <div className="flex items-center gap-3 border-t p-3">
      <span className="text-xs text-muted-foreground">{t("时间")}</span>
      <Input
        type="time"
        step={60}
        aria-label={t("时间")}
        disabled={!date}
        value={time}
        className="h-8 flex-1 text-xs"
        onChange={(event) => {
          if (!date || !event.target.value) return;
          const [hours, minutes] = event.target.value.split(":").map(Number);
          const next = new Date(date);
          next.setHours(hours!, minutes!, 0, 0);
          onChange(next);
        }}
      />
    </div>
  );
}
