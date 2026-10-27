// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { Languages } from "lucide-react";
import { Button } from "@workspace/ui/components/ui/button";
import { setLocale, useI18n } from "@workspace/ui/lib/i18n";

export function LanguageSwitcher() {
  const { locale, t } = useI18n();
  return (
    <div className="flex items-center gap-2 px-5 py-2.5">
      <Languages
        className="size-4 text-sidebar-foreground/60"
        aria-hidden="true"
      />
      <span className="flex-1 text-[13px] text-sidebar-foreground/60">
        {t("语言")}
      </span>
      <div
        role="group"
        aria-label={t("语言切换")}
        className="flex items-center gap-1"
      >
        <Button
          variant={locale === "zh-CN" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2"
          lang="zh-CN"
          aria-label="中文"
          aria-pressed={locale === "zh-CN"}
          onClick={() => setLocale("zh-CN")}
        >
          中
        </Button>
        <span className="text-sidebar-foreground/30" aria-hidden="true">
          /
        </span>
        <Button
          variant={locale === "en" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2"
          lang="en"
          aria-label="English"
          aria-pressed={locale === "en"}
          onClick={() => setLocale("en")}
        >
          EN
        </Button>
      </div>
    </div>
  );
}
