// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useState } from "react";
import { GlobeIcon } from "lucide-react";
import type { MediaSite } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/ui/button";
import { useDialogContentContainer } from "@workspace/ui/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/ui/popover";
import { cn } from "@workspace/ui/lib/utils";

/** One site row of the server's catalog; the shape the capsules render. */
export type MediaSiteCapsule = MediaSite;

/** How a capsule should draw its status dot. */
type CapsuleStatus = "guest" | "connected" | "expired";

function capsuleStatus(site: MediaSiteCapsule): CapsuleStatus {
  if (!site.loggedIn) return "guest";
  return site.status === "expired" ? "expired" : "connected";
}

const STATUS_DOT: Record<CapsuleStatus, string> = {
  guest: "bg-muted-foreground/50",
  connected: "bg-emerald-500",
  expired: "bg-amber-500",
};

interface MediaSiteCapsulesProps {
  /** The kind's site list, best first as the server returns it. */
  sites: readonly MediaSiteCapsule[];
  /** Site the pasted URL belongs to; its capsule is outlined. */
  matchedSiteKey?: string | null;
  /** Site that answered `login_required`; its capsule is outlined as an error. */
  loginRequiredSiteKey?: string | null;
  /** Click on a site without a saved login: open the login sheet for it. */
  onSelectLoggedOut: (site: MediaSiteCapsule) => void;
  /** Re-check one saved login. */
  onVerify: (site: MediaSiteCapsule) => void;
  /** Replace one saved login (opens the same sheet). */
  onReplace: (site: MediaSiteCapsule) => void;
  /** Forget one saved login. */
  onDisconnect: (site: MediaSiteCapsule) => void;
  className?: string;
}

/**
 * The site capsule row both media dialogs share.
 *
 * One capsule per listed site, with a status dot: grey means "no saved login,
 * public content still works", green "saved / verified", amber "the saved login
 * stopped working". The row does not decide anything itself — the dialog owns
 * the login sheet and the parse — it only reports which site was clicked.
 *
 * A logged-in capsule opens a small menu instead of the sheet: the useful
 * actions then are verifying, replacing and disconnecting the saved login.
 */
export function MediaSiteCapsules({
  sites,
  matchedSiteKey = null,
  loginRequiredSiteKey = null,
  onSelectLoggedOut,
  onVerify,
  onReplace,
  onDisconnect,
  className,
}: MediaSiteCapsulesProps) {
  const { t } = useI18n();
  /**
   * The dialog content element, so a capsule menu opened inside the import
   * dialog is portalled into it. A menu portalled to `document.body` would sit
   * outside the modal dialog's pointer-events shard and could not be clicked.
   */
  const dialogContainer = useDialogContentContainer();
  /** Key of the capsule whose login menu is open; one menu at a time. */
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);

  if (sites.length === 0) return null;

  return (
    <div
      className={cn(
        // Design: a row that wraps on a wide dialog and scrolls horizontally on
        // a narrow one, so five capsules never squeeze their labels.
        "flex w-full flex-wrap items-center gap-1.5",
        className,
      )}
    >
      {sites.map((site) => {
        const status = capsuleStatus(site);
        const matched = matchedSiteKey === site.key;
        const loginRequired = loginRequiredSiteKey === site.key;
        const statusLabel =
          status === "connected"
            ? t("已登录")
            : status === "expired"
              ? t("登录已失效")
              : t("未登录");

        const capsule = (
          <span
            className={cn(
              "flex h-9 items-center gap-2 rounded-full border border-border/70 bg-background px-3 text-[13px] transition-colors",
              "hover:border-border hover:bg-muted/40",
              matched && "border-primary bg-primary/5",
              loginRequired && "border-destructive/70 bg-destructive/5",
            )}
          >
            <GlobeIcon
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="max-w-32 truncate">{t(site.name)}</span>
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                STATUS_DOT[status],
              )}
              title={statusLabel}
              aria-label={statusLabel}
            />
          </span>
        );

        if (!site.loggedIn) {
          return (
            <button
              key={site.key}
              type="button"
              onClick={() => onSelectLoggedOut(site)}
              className="rounded-full text-left outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40"
              title={t(site.loginHint)}
            >
              {capsule}
            </button>
          );
        }

        const menuItemClassName =
          "w-full justify-start px-2 text-left text-sm font-normal";
        return (
          <Popover
            key={site.key}
            open={openMenuKey === site.key}
            onOpenChange={(next) => setOpenMenuKey(next ? site.key : null)}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className="rounded-full text-left outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40"
                title={
                  site.accountLabel
                    ? `${site.accountLabel} · ${statusLabel}`
                    : statusLabel
                }
              >
                {capsule}
              </button>
            </PopoverTrigger>
            <PopoverContent
              container={dialogContainer}
              align="start"
              className="flex w-44 flex-col gap-0.5 p-1"
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={menuItemClassName}
                onClick={() => {
                  setOpenMenuKey(null);
                  onVerify(site);
                }}
              >
                {t("重新验证")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={menuItemClassName}
                onClick={() => {
                  setOpenMenuKey(null);
                  onReplace(site);
                }}
              >
                {t("更换登录")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className={menuItemClassName}
                onClick={() => {
                  setOpenMenuKey(null);
                  onDisconnect(site);
                }}
              >
                {t("退出登录")}
              </Button>
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );
}
