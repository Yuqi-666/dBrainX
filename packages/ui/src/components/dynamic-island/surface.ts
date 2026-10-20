// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { cn } from "@workspace/ui/lib/utils";

/**
 * The capsule's surface, as three stacked layers of box-shadow and one class.
 *
 * **They are all painted on the capsule itself**, and that is load-bearing: the
 * capsule is `overflow-hidden` (it is the island's silhouette), so an ancestor
 * would clip a child's outer shadow completely — and a child layer cannot stay
 * aligned with a capsule whose size is mid-spring anyway.
 *
 * The price is that the 1px rim scales with the box, so for a few frames at the
 * start of a morph it thins to a hairline before the spring catches up. That
 * reads as the rim dissolving into the growing shape rather than as a seam,
 * which is the better of the two failures.
 */

/**
 * Layer 2 — refraction — is a Tailwind `supports-[…]` variant rather than a
 * `style` value, so a browser without `backdrop-filter` never receives the
 * property at all and falls back to layer 1's opaque tone. `blur < 12px` reads
 * as "dirty" rather than glass, hence 20px.
 */
const GLASS_LAYER = [
  "supports-[backdrop-filter:blur(1px)]:bg-popover/85",
  "supports-[backdrop-filter:blur(1px)]:dark:bg-popover/80",
  "supports-[backdrop-filter:blur(1px)]:backdrop-blur-[20px]",
  "supports-[backdrop-filter:blur(1px)]:backdrop-saturate-[180%]",
].join(" ");

/** The "no blur right now" tone: opaque enough to stay readable over the graph. */
const OPAQUE_LAYER = "bg-popover/90";

export function islandSurfaceClass(glass: boolean): string {
  return cn("bg-popover", glass ? GLASS_LAYER : OPAQUE_LAYER);
}

/** The 1px rim, byte-identical to the border colour the rest of the app draws. */
export const ISLAND_RING =
  "inset 0 0 0 1px color-mix(in oklab, var(--border) 60%, transparent)";

/**
 * The top highlight — a static 1px inset line. A self-moving highlight on an
 * always-on component reads as a repaint glitch rather than as life, so the
 * drifting radial wash is deliberately not here.
 */
export const ISLAND_INNER_EDGE = "inset 0 1px 0 rgb(255 255 255 / 0.28)";

/**
 * The outside half: drop shadow plus a 1px cool/warm chromatic edge, which is
 * what separates "glass" from "frosted card" — and is only convincing because it
 * is barely visible. On the capsule for the same reason as everything else here.
 */
export const ISLAND_OUTER_EDGE = [
  "0 8px 24px rgb(0 0 0 / 0.18)",
  "-1px 0 0 rgb(255 100 100 / 0.10)",
  "1px 0 0 rgb(100 150 255 / 0.10)",
].join(", ");

/** Every box-shadow the island wears, in one string for `style`. */
export const ISLAND_SHADOW = [
  ISLAND_OUTER_EDGE,
  ISLAND_RING,
  ISLAND_INNER_EDGE,
].join(", ");
