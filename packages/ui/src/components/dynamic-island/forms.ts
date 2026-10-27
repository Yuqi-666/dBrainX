// SPDX-License-Identifier: AGPL-3.0-only

import { translate } from "@workspace/ui/lib/i18n/runtime";
import type { Transition } from "motion/react";

import type { IslandPanel } from "@workspace/interfaces";

import type { Box, BoxSpec, HandoverPair } from "./geometry";

/**
 * The island as **data**: a form is an entry in `ISLAND_FORMS`, and adding one
 * is meant to be an edit to this file plus a branch in the host — never a new
 * choreography.
 *
 * The *feel* is deliberately not here: the springs, the rate they run at and the
 * threshold a collapse hands the capsule back at are `tuning.ts`, together with
 * the runtime override that moves them while the app runs. What is left in this
 * file is the shape of the island — the four forms — and the three ways a move
 * can hand the capsule over.
 */

/** A form's authored geometry, plus the copy its built-in body falls back to. */
export interface IslandForm extends BoxSpec {
  /** Body drawn when the host injects none. Absent ⇒ the form needs content. */
  readonly placeholder?: string;
}

export const ISLAND_FORMS: Record<IslandPanel, IslandForm> = {
  // `"content"` on the width, and the height is a **floor** rather than the size:
  // the pill is whatever the row measures (a coarse pointer's items are 44px
  // touch targets, not 36), and 40 is the fine-pointer reading it must never go
  // below. See `resolveGeometry`.
  idle: { width: "content", height: 40, maxHeightRatio: null, radius: 9999 },
  preview: {
    width: 360,
    height: 340,
    maxHeightRatio: 0.44,
    radius: 28,
    get placeholder() {
      return translate("选择节点以预览");
    },
  },
  search: {
    width: 560,
    height: 440,
    maxHeightRatio: 0.52,
    radius: 28,
    get placeholder() {
      return translate("搜索");
    },
  },
  agent: {
    width: 400,
    height: 440,
    maxHeightRatio: 0.52,
    radius: 28,
    get placeholder() {
      return translate("Agent");
    },
  },
};

/** The collapsed pill before it has ever been measured (first paint only). */
export const UNMEASURED_PILL: Box = { w: 152, h: 40 };

/** Reduced motion: a hard cut. The island stays fully functional. */
export const INSTANT: Transition = { duration: 0 };

/** The three ways content can change hands. */
export type SwapKind = "grow" | "shrink" | "swap";

/**
 * One hand-over per side, per kind of move — the table `handoverFor` chooses a
 * row from, built from the tunable numbers by `timingOf` in `tuning.ts`.
 */
export type SwapTiming = Readonly<Record<SwapKind, HandoverPair>>;

/**
 * Which timing a move from `from` to `to` uses.
 *
 * `from` is the form the user was looking at a moment ago — the layer the swap
 * state machine has just demoted — and `undefined` means there was nothing to
 * hand over *from*: a body standing on its own, or an island mounted already
 * open. The order matters: collapsing into the pill is answered before anything
 * else, because that is the one move that ends with the pill on screen.
 *
 * `timing` is the table the shell resolved for this frame (`IslandMotion.timing`),
 * passed in rather than imported so a tuned island and a committed one run the
 * same code. Pure, so the cases that are easy to get wrong — a swap *retargeted*
 * mid-flight is still a panel-to-panel dissolve, and a body on its own never
 * fades — are pinned by a test rather than by a comment.
 */
export function handoverFor(
  from: IslandPanel | undefined,
  to: IslandPanel,
  timing: SwapTiming,
): HandoverPair {
  if (from === undefined) return timing.grow;
  if (to === "idle") return timing.shrink;
  if (from === "idle") return timing.grow;
  return timing.swap;
}

/**
 * How long an outgoing layer may stay mounted after it has been asked to leave.
 *
 * A spring cannot finish while the frame loop is paused (a backgrounded tab
 * stops `requestAnimationFrame`), and a layer that is only waiting for an
 * opacity to reach zero must never become permanent state. The visual exit is
 * always the opacity; this is only the guarantee.
 */
export const MAX_EXIT_MS = 1500;
