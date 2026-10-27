// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useEffect } from "react";
import { motion, useMotionValueEvent } from "motion/react";
import type { MotionValue, Transition } from "motion/react";

import { cn } from "@workspace/ui/lib/utils";

import { ISLAND_FORMS, MAX_EXIT_MS } from "./forms";
import type { IslandForm } from "./forms";
import type { Geometry, Handover, HandoverPair } from "./geometry";
import type { IslandLayer } from "./layers";
import { useLayerMotion, useProximity } from "./motion";
import type { BoxMotion } from "./motion";
import type { IslandPanel } from "@workspace/interfaces";

/** Below this, a layer is not on screen and may be dropped. */
const EXIT_EPSILON = 0.005;

export interface IslandStageProps {
  /** Outgoing first, incoming last — one flat keyed list (see `layers.ts`). */
  layers: readonly IslandLayer[];
  /** The form the capsule is shaped for; its box is the swap's target. */
  incoming: IslandLayer;
  /** Authoring geometry for *any* form — the same resolver the capsule uses. */
  geometryFor: (panel: IslandPanel) => Geometry;
  box: BoxMotion["box"];
  /** When each side takes the capsule over — see `tuning.ts`. */
  handover: HandoverPair;
  crossfade: Transition;
  /** Content of one form. Called for the incoming *and* for every outgoing one. */
  renderPanel: (panel: IslandPanel) => React.ReactNode;
  /** A layer has finished leaving and may be unmounted. */
  onExited: (id: number) => void;
}

/**
 * The content stage: it renders the form the capsule is shaped for, plus every
 * form still on its way out, and it decides *which of them the user sees* from
 * the geometry and the move alone.
 *
 * ```
 * distance = |live box| / |incoming form|   (1 = arrived, either direction)
 * ```
 *
 * Nothing here is timed: a layer's opacity is a function of that distance and of
 * the hand-over the shell picked for this move, so one code path covers a cut, a
 * switch at a point and a dissolve over a window alike — and a new form needs no
 * new choreography. Which hand-over applies is the shell's decision, because only
 * the shell knows what the island is moving *between*.
 */
export function IslandStage({
  layers,
  incoming,
  geometryFor,
  box,
  handover,
  crossfade,
  renderPanel,
  onExited,
}: IslandStageProps): React.ReactNode {
  const distance = useProximity(box, geometryFor(incoming.panel));
  const alone = layers.length === 1;

  return (
    <>
      {layers.map((layer) => (
        <IslandLayerView
          key={layer.id}
          layer={layer}
          form={ISLAND_FORMS[layer.panel]}
          authored={geometryFor(layer.panel)}
          box={box}
          distance={distance}
          handover={handover[layer.role]}
          crossfade={crossfade}
          // Only a layer that is on screen by itself may size the capsule:
          // mid-swap the two authored boxes would fight over it.
          flow={alone}
          renderPanel={renderPanel}
          onExited={onExited}
        />
      ))}
    </>
  );
}

interface IslandLayerViewProps {
  layer: IslandLayer;
  form: IslandForm;
  authored: Geometry;
  box: BoxMotion["box"];
  distance: MotionValue<number>;
  handover: Handover;
  crossfade: Transition;
  flow: boolean;
  renderPanel: (panel: IslandPanel) => React.ReactNode;
  onExited: (id: number) => void;
}

/**
 * One form's content, laid out at its own authored box and transformed onto the
 * live capsule. The frame never participates in the capsule's layout, so a layer
 * can only ever be clipped by the capsule itself.
 */
function IslandLayerView({
  layer,
  form,
  authored,
  box,
  distance,
  handover,
  crossfade,
  flow,
  renderPanel,
  onExited,
}: IslandLayerViewProps): React.ReactNode {
  const { scale, opacity } = useLayerMotion({
    form,
    authored,
    box,
    distance,
    side: layer.role,
    handover,
    crossfade,
  });
  const leaving = layer.role === "out";

  /**
   * The **outgoing** opacity is what decides when a layer may unmount, never the
   * incoming one. For a panel change with no size change the incoming target is
   * already `1`, so an incoming layer reports "arrived" on its first frame —
   * which is exactly how a cross-fade turns into a hard cut.
   */
  useMotionValueEvent(opacity, "change", (value) => {
    if (leaving && value <= EXIT_EPSILON) onExited(layer.id);
  });

  useEffect(() => {
    if (!leaving) return;
    if (opacity.get() <= EXIT_EPSILON) {
      onExited(layer.id);
      return;
    }
    // A spring cannot finish while the frame loop is paused (a backgrounded tab
    // stops `requestAnimationFrame`), and a layer waiting on an opacity must
    // never become permanent state. The exit is the opacity; this is the
    // guarantee.
    const timer = setTimeout(() => onExited(layer.id), MAX_EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving, layer.id, opacity, onExited]);

  return (
    <motion.div
      data-island-layer={layer.panel}
      data-island-layer-side={layer.role}
      // A layer on its way out keeps its DOM (the shrink needs it), so it is
      // taken out of the accessibility tree and out of pointer reach by hand.
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
      className={cn(
        "flex items-center justify-center",
        flow ? "relative h-full w-full" : "absolute inset-0",
        leaving && "pointer-events-none",
      )}
      style={{ opacity }}
    >
      <motion.div
        data-island-content={layer.panel}
        // The authored frame: its content is written against *this* box, never
        // against the live capsule, so a form can shrink with the island without
        // knowing anything about the morph.
        style={{
          // `max-content`, not `fit-content`: fit-content shrinks to the space
          // available, and the capsule around this frame is a spring mid-collapse
          // — so a fit-content pill would be squeezed narrower every frame, which
          // fed straight back into the pill's own measurement.
          ...(form.width === "content"
            ? { width: "max-content" as const }
            : { width: authored.w }),
          height: authored.h,
          scale,
        }}
        // `flex-none` completes that guard, and it is not optional: this frame is
        // a flex item, and an item with `overflow-hidden` has an **automatic
        // minimum size of zero**, so it shrinks straight past its own `width`
        // down to the live capsule. The collapsed row is measured *from inside
        // this frame*, so that shrink is self-referential — one frame of
        // undershoot narrows the capsule, which narrows the frame, which the
        // observer hands back as a smaller pill, and the pill ratchets down until
        // nothing is left to move it. The clipping is then permanent.
        //
        // Pinning the frame to its authored size also makes `layerScale`'s fit
        // exact: a frame that had already shrunk *and* a scale meant the body was
        // shrunk twice, at every frame of every morph.
        className="relative flex-none overflow-hidden"
      >
        {renderPanel(layer.panel)}
      </motion.div>
    </motion.div>
  );
}
