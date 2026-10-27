// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useCallback, useState } from "react";

import type { IslandPanel } from "@workspace/interfaces";

/** One mounted form. `id` is the React key, and it survives a demotion. */
export interface IslandLayer {
  readonly id: number;
  readonly panel: IslandPanel;
  readonly role: "in" | "out";
}

interface LayerStack {
  /** The form the capsule is shaped for. Always present, always last. */
  readonly incoming: IslandLayer;
  /** Forms still leaving, oldest first. */
  readonly outgoing: readonly IslandLayer[];
  /**
   * `[...outgoing, incoming]` — the exact array the stage renders, as **one flat
   * keyed list**. Splitting the two groups into sibling children would put them
   * in different React slots, and an element that moves between slots is
   * remounted, which is the one thing this whole design exists to avoid.
   */
  readonly layers: readonly IslandLayer[];
  readonly nextId: number;
  /** The panel this stack was built for; a mismatch means "rebuild". */
  readonly for: IslandPanel;
}

export type { LayerStack };

/** How many outgoing layers may linger while an even newer one arrives. */
const MAX_OUTGOING = 2;

export interface LayerStackState {
  readonly layers: readonly IslandLayer[];
  readonly incoming: IslandLayer;
  /** Drop a layer that has finished leaving. */
  readonly remove: (id: number) => void;
}

/**
 * The swap, as a state machine: one layer per panel **entry**, never per panel.
 *
 * Two properties carry the whole behaviour, and both are easy to lose:
 *
 * - **A layer is never re-created in order to become outgoing.** Remounting it
 *   (through a key change, or by moving it between two child slots) would start
 *   a fresh opacity spring at its *target* value — and for a panel change with
 *   no size change the outgoing target is already `0`, so the outgoing content
 *   would vanish on its own first frame instead of cross-fading. Demoting the
 *   instance in place, key untouched and only the `role` flipped, is what turns
 *   that swap into an actual cross-fade.
 * - **A demotion keeps older layers.** Retargeting mid-flight (`search` →
 *   `agent` → `preview`) would otherwise unmount a layer that is still
 *   half-visible.
 *
 * The rebuild happens during render rather than in an effect on purpose: the
 * shell needs the demoted list *in this pass* to pick the collapse spring, and a
 * one-frame-late spring is measurable — it squashes the pill on the way down.
 */
export function useLayerStack(panel: IslandPanel): LayerStackState {
  const [stack, setStack] = useState<LayerStack>(() => {
    const incoming: IslandLayer = { id: 0, panel, role: "in" };
    return {
      incoming,
      outgoing: [],
      layers: [incoming],
      nextId: 1,
      for: panel,
    };
  });

  const next = stack.for === panel ? null : promote(stack, panel);
  if (next) setStack(next);

  const remove = useCallback((id: number) => {
    setStack((current) => {
      const outgoing = current.outgoing.filter((layer) => layer.id !== id);
      if (outgoing.length === current.outgoing.length) return current;
      return { ...current, outgoing, layers: [...outgoing, current.incoming] };
    });
  }, []);

  const current = next ?? stack;
  return { layers: current.layers, incoming: current.incoming, remove };
}

/**
 * The pure half of the state machine. Exported so the invariant that makes a
 * cross-fade possible — *the demoted layer keeps its key, so React keeps its
 * instance* — is pinned by a test rather than by a comment.
 */
export function promote(stack: LayerStack, panel: IslandPanel): LayerStack {
  const outgoing = [
    ...stack.outgoing,
    { ...stack.incoming, role: "out" as const },
  ].slice(-MAX_OUTGOING);
  const incoming: IslandLayer = { id: stack.nextId, panel, role: "in" };

  return {
    incoming,
    outgoing,
    layers: [...outgoing, incoming],
    nextId: stack.nextId + 1,
    for: panel,
  };
}
