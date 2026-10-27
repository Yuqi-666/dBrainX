// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode, Ref } from "react";

import type { IslandExpandedPanel, IslandPanel } from "@workspace/interfaces";

export type { IslandExpandedPanel, IslandPanel };

/** One destination in the island's navigation row. */
export interface IslandNavItem {
  key: string;
  label: string;
  icon: ReactNode;
  /** The current destination. Independent of {@link enabled}: a form can be the
   * current one and still be routed to a page that does not exist yet. */
  active: boolean;
  /** False renders the item inert, explaining itself through `disabledReason`. */
  enabled: boolean;
  onSelect: () => void;
  disabledReason?: string;
  /**
   * Keyboard hints for this destination, drawn as `Kbd` chips after the label in
   * the item's tooltip. The host owns the strings: this package knows neither the
   * app's routes nor its shortcuts. Empty/absent renders the label alone.
   */
  shortcuts?: readonly string[];
  /** Draw the 1px hairline *before* this item. Decided by the host, which owns
   * the list — never inferred from a `key`. */
  separator?: boolean;
}

export interface DynamicIslandProps {
  /** Controlled: the host owns the state, the island renders it. */
  panel: IslandPanel;
  onPanelChange: (panel: IslandPanel) => void;

  nav: readonly IslandNavItem[];

  /** One body per expanded form. A form without one draws its own placeholder,
   * and a form the host supplies is responsible for its own chrome. */
  content?: Partial<Record<IslandExpandedPanel, ReactNode>>;
  /** Preferred content width; the viewport gutter remains the upper bound. */
  contentWidths?: Partial<Record<IslandExpandedPanel, number>>;

  /** Pinned under an expanded body (a preview's 「打开节点」, say). */
  actions?: ReactNode;

  /**
   * Whether the capsule may paint a `backdrop-filter`.
   *
   * `"auto"` blurs, except for a user who asked for reduced transparency. Pass
   * `"opaque"` when the *backdrop* is animating — the island cannot see what is
   * behind it, and a blur over a canvas that repaints every frame is re-sampled
   * every frame, which is the one cost this component must not hide.
   */
  backdrop?: "auto" | "opaque";

  className?: string;

  /** The capsule element, for a host that has to lay out around it. */
  ref?: Ref<HTMLDivElement>;
}
