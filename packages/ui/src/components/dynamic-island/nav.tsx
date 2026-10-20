// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import * as React from "react";
import { LayoutGroup, motion, useAnimationControls } from "motion/react";

import { Kbd } from "@workspace/ui/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/ui/tooltip";
import { cn } from "@workspace/ui/lib/utils";

import { useIslandEnvironment } from "./environment";
import type { IslandNavItem } from "./types";
import { useIslandMotion } from "./use-tuning";

export interface IslandNavProps {
  nav: readonly IslandNavItem[];
  /**
   * Render each item's label beside its icon. A pointer-based affordance, so it
   * is ignored where there is no hover — a label that only appears on hover is
   * useless on the device that needs the label most.
   */
  labels?: boolean;
  className?: string;
  /**
   * The row element itself, which is what the collapsed pill is measured from.
   *
   * It has to be *this* element rather than a box around it: `w-fit` plus
   * shrink-proof items give the row a minimum content size, so its width is
   * intrinsic and no ancestor can squeeze it — while a wrapper is only ever as
   * wide as whatever the capsule is currently doing.
   */
  ref?: React.Ref<HTMLElement>;
}

/**
 * The navigation row — the whole of the collapsed form, and the header of an
 * expanded placeholder.
 *
 * It owns no routing and no state: `active` and `enabled` arrive already decided,
 * because a route table written into a shared package would hard-code pages this
 * package cannot know about.
 *
 * **The `TooltipProvider` here is not optional.** Radix's tooltip context has no
 * default value: without a provider, an item's `<Tooltip>` throws, the error
 * leaves the render, and the island renders nothing at all. Nothing in this
 * repository mounts a provider (the app shell has no root one), so it is scoped
 * here — one per rendered row, and the island renders one row at a time. It
 * renders no DOM, so every anchor below is unaffected.
 */
export function IslandNav({
  nav,
  labels = false,
  className,
  ref,
}: IslandNavProps): React.ReactNode {
  const { t } = useI18n();

  const { coarsePointer, reducedMotion } = useIslandEnvironment();
  const feel = useIslandMotion();
  const instant = feel.instant ?? reducedMotion;
  const layoutId = React.useId();

  return (
    <TooltipProvider delayDuration={0}>
      <LayoutGroup id={layoutId}>
        <nav
          ref={ref}
          aria-label={t("主导航")}
          data-island-nav
          // `w-fit` is load-bearing, not cosmetic: the collapsed pill has no
          // authored width, so the framework measures *this row's* natural width
          // and springs the capsule to it. Without it the row would simply inherit
          // whatever box it was put in and the pill would measure itself.
          className={cn("flex w-fit items-center gap-0.5 px-1.5", className)}
        >
          {nav.map((item) => (
            <React.Fragment key={item.key}>
              {item.separator ? (
                <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
              ) : null}
              <IslandNavButton
                item={item}
                label={labels && !coarsePointer}
                coarse={coarsePointer}
                instant={instant}
              />
            </React.Fragment>
          ))}
        </nav>
      </LayoutGroup>
    </TooltipProvider>
  );
}

interface IslandNavButtonProps {
  item: IslandNavItem;
  label: boolean;
  coarse: boolean;
  instant: boolean;
}

function IslandNavButton({
  item,
  label,
  coarse,
  instant,
}: IslandNavButtonProps): React.ReactNode {
  useI18n();

  const disabled = !item.enabled;
  const droplet = useAnimationControls();

  React.useEffect(() => {
    if (!instant) return;
    droplet.stop();
    droplet.set({ scaleX: 1, scaleY: 1 });
  }, [droplet, instant]);

  // Touch has no hover, and a 36px glyph is not a hit area you can reach
  // reliably, so the button grows rather than the icon.
  const sizing = label
    ? coarse
      ? "h-11 min-w-11 px-2.5"
      : "h-9 min-w-9 px-2.5"
    : coarse
      ? "size-11"
      : "size-9";

  const button = (
    <button
      type="button"
      aria-label={item.label}
      aria-current={item.active ? "page" : undefined}
      // Not the `disabled` attribute: that stops firing pointer events on some
      // engines, which would kill the tooltip explaining *why* it is disabled.
      // `aria-disabled` keeps it hoverable, focusable and still inert.
      aria-disabled={disabled ? "true" : undefined}
      data-island-nav-item={item.key}
      data-island-nav-disabled={disabled ? "true" : undefined}
      onClick={() => {
        if (disabled) return;
        item.onSelect();
      }}
      className={cn(
        "relative isolate inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full text-sm transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        sizing,
        item.active ? "text-foreground" : "text-muted-foreground",
        !disabled && !item.active && "hover:bg-accent/60 hover:text-foreground",
        disabled && "opacity-40",
      )}
    >
      {item.active ? (
        <motion.span
          aria-hidden
          // Each row scopes its shared droplet, including overlapping island layers.
          layoutId={instant ? undefined : "nav-selection"}
          initial={false}
          transition={{
            layout: { type: "spring", stiffness: 500, damping: 28, mass: 0.7 },
          }}
          onLayoutAnimationStart={() => {
            if (instant) return;
            void droplet.start({
              scaleX: [1, 1.22, 1],
              scaleY: [1, 0.84, 1],
              transition: {
                duration: 0.38,
                times: [0, 0.35, 1],
                ease: "easeOut",
              },
            });
          }}
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ borderRadius: 9999 }}
        >
          <motion.span
            animate={droplet}
            className="absolute inset-0 rounded-full bg-accent"
          />
        </motion.span>
      ) : null}
      {item.icon}
      {label ? <span className="hidden md:inline">{item.label}</span> : null}
    </button>
  );

  // Every item explains itself on hover — always, not only when disabled: the
  // collapsed pill is glyphs alone, so the tooltip is where a destination is
  // *named*, where a disabled one says why, and where the host's keyboard hints
  // (the keys that walk the navigation order) are drawn.
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top">
        {disabled && item.disabledReason ? (
          item.disabledReason
        ) : (
          <>
            <span>{item.label}</span>
            {item.shortcuts?.map((shortcut) => (
              <Kbd key={shortcut}>{shortcut}</Kbd>
            ))}
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
