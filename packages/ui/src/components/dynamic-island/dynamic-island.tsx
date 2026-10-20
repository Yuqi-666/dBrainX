// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import * as React from "react";
import { motion } from "motion/react";

import { cn } from "@workspace/ui/lib/utils";

import type { IslandPanel } from "@workspace/interfaces";

import { useIslandEnvironment, useViewport } from "./environment";
import { handoverFor, INSTANT, ISLAND_FORMS } from "./forms";
import { resolveGeometry } from "./geometry";
import { useLayerStack } from "./layers";
import { useBoxMotion } from "./motion";
import { IslandNav } from "./nav";
import { IslandStage } from "./stage";
import { ISLAND_SHADOW, islandSurfaceClass } from "./surface";
import type { DynamicIslandProps } from "./types";
import { usePillBox } from "./use-pill-box";
import { useIslandMotion } from "./use-tuning";

/**
 * `<DynamicIsland />` — the always-on capsule at the bottom of the app.
 *
 * **Three boundaries, and they are what keep this a component rather than a
 * feature:**
 *
 * 1. **It reads no store and no route.** `panel` is controlled and `nav` is a
 *    prop, so the host owns which page is current and which panel is open. A
 *    route table written in here would hard-code pages this package cannot know
 *    about.
 * 2. **It does no business.** Preview, search and agent are `ReactNode`s from
 *    the host; a form without one draws its own correctly-sized placeholder
 *    instead of collapsing.
 * 3. **It registers no global keyboard.** The one key it handles is `Escape`,
 *    locally on the capsule, so a host dialog that is also listening keeps
 *    receiving it.
 *
 * The shell itself owns only the four bodies, the surface it paints, the box it
 * springs (because the capsule *is* that box) and the two ways out. Everything
 * else is a module with one job: `forms.ts` is the data, `tuning.ts` the feel,
 * `geometry.ts` the math, `motion.ts` the springs, `layers.ts` the swap state
 * machine, `stage.tsx` which layer is on screen.
 */
export function DynamicIsland({
  panel,
  onPanelChange,
  nav,
  content,
  contentWidths,
  actions,
  backdrop = "auto",
  className,
  ref,
}: DynamicIslandProps): React.ReactNode {
  const { reducedMotion, reducedTransparency } = useIslandEnvironment();
  const viewport = useViewport();

  const [pillElement, setPillElement] = React.useState<HTMLElement | null>(
    null,
  );
  const { pill, measured } = usePillBox(pillElement);

  const { layers, incoming, remove } = useLayerStack(panel);
  const swapping = layers.length > 1;

  /**
   * The springs to run and the hand-over table to pick from, with every tunable
   * number already folded in — see `tuning.ts`. Named `feel` rather than
   * `motion`, which is the library this file is rendering with.
   */
  const feel = useIslandMotion();
  // The tuning may force the cut on or off; `null` — its default — follows the
  // platform, which is what reduced motion means.
  const instant = feel.instant ?? reducedMotion;

  /**
   * The form the user was looking at a moment ago — the layer the stack has just
   * demoted, so `undefined` while nothing is swapping. The content timing is
   * decided from this pair, and it is the *previous* form rather than "is the
   * pill on screen" that matters: a swap retargeted mid-flight is still a
   * panel-to-panel move (see `handoverFor`).
   */
  const previous = swapping ? layers.at(-2)?.panel : undefined;
  const handover = handoverFor(previous, panel, feel.timing);

  const [bodyHeights, setBodyHeights] = React.useState<
    Partial<Record<IslandPanel, number>>
  >({});
  const measureBody = React.useCallback((form: IslandPanel, height: number) => {
    setBodyHeights((current) =>
      current[form] === height ? current : { ...current, [form]: height },
    );
  }, []);

  const geometryFor = React.useCallback(
    (form: IslandPanel) =>
      resolveGeometry(
        form === "idle"
          ? ISLAND_FORMS[form]
          : {
            ...ISLAND_FORMS[form],
            width: contentWidths?.[form] ?? ISLAND_FORMS[form].width,
            height: bodyHeights[form] ?? ISLAND_FORMS[form].height,
          },
        viewport,
        pill,
      ),
    [viewport, pill, bodyHeights, contentWidths],
  );
  const geometry = geometryFor(panel);

  /**
   * Which spring to run. Collapsing is the under-damped spring's one bad
   * direction, and this is decided in the same pass as the demotion above so the
   * very first frame of a collapse already has it.
   */
  const morph = useBoxMotion(
    geometry,
    instant ? INSTANT : swapping && panel === "idle" ? feel.settle : feel.morph,
    instant,
  );

  /**
   * The pill's width is a measurement, so the first commit springs from a
   * fallback. Jumping to the real number — instead of animating to it — keeps
   * mount completely still; a *changed* measurement afterwards animates.
   */
  const jumped = React.useRef(false);
  React.useEffect(() => {
    if (jumped.current || !measured) return;
    jumped.current = true;
    morph.jump(geometry);
  }, [measured, morph, geometry]);

  /**
   * One form's content, authored against **that form's box** — never against the
   * live capsule. That is what lets any form shrink with the island without
   * knowing anything about the morph.
   */
  const renderPanel = React.useCallback(
    (form: IslandPanel): React.ReactNode => {
      if (form === "idle") {
        // The **row** is the pill's measurement target — both of its axes are the
        // pill's — so it is deliberately *not* stretched to the frame: on a coarse
        // pointer its items are 44px touch targets, and the pill grows to them
        // instead of clipping them. The wrapper fills the frame (so the row stays
        // centred in it) and centres the row without resizing it.
        //
        // Measuring a wrapper instead would make the pill's own size part of its
        // own target (see `usePillBox`).
        return (
          <div className="flex h-full items-center">
            <IslandNav ref={setPillElement} nav={nav} />
          </div>
        );
      }

      return (
        <MeasuredBody form={form} onMeasure={measureBody} actions={actions}>
          {content?.[form]}
        </MeasuredBody>
      );
    },
    [actions, content, nav, measureBody],
  );

  const capsule = React.useRef<HTMLDivElement | null>(null);
  const setCapsule = React.useCallback(
    (node: HTMLDivElement | null) => {
      capsule.current = node;
      assignRef(ref, node);
    },
    [ref],
  );

  /**
   * The local, layered `Escape`: an expanded island collapses, a collapsed one
   * does nothing at all — no `preventDefault`, no `stopPropagation` — so a host
   * dialog or popover that is also listening keeps receiving the key.
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.key !== "Escape" || panel === "idle")
      return;
    onPanelChange("idle");
  };

  /**
   * 点击岛外. It listens in the **capture** phase on purpose: the graph canvas
   * and the sidebar install their own pointer handlers, and a bubble-phase
   * listener can be outrun by one of them calling `stopPropagation`.
   *
   * It only exists while the island is expanded, and it is the half of "close"
   * that does not require a keyboard — on a tablet, the half that matters.
   */
  React.useEffect(() => {
    if (panel === "idle") return;

    const handlePointerDown = (event: PointerEvent) => {
      const node = capsule.current;
      if (node && event.target instanceof Node && node.contains(event.target)) {
        return;
      }
      // Feature content may open a Radix portal outside the capsule.
      // A graph canvas defers dismissal until its worker resolves whether the
      // pointer hit a node (switch directly to preview) or empty space (close).
      if (
        event.target instanceof Element &&
        event.target.closest(
          '[role="dialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"], [data-island-defer-dismiss]',
        )
      )
        return;
      onPanelChange("idle");
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [panel, onPanelChange]);

  return (
    // The strip stays pointer-transparent — otherwise it would eat canvas drags
    // and the sidebar's hot zone along the whole bottom edge. Only the capsule is
    // interactive, and it is the only element that moves.
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <motion.div
        ref={setCapsule}
        data-island
        data-island-panel={panel}
        style={{
          // Until the pill has been measured the capsule sizes itself, which is
          // what a content-width form asks for; the number that replaces it is
          // the measurement of this very box.
          width: measured ? morph.width : "fit-content",
          height: morph.height,
          borderRadius: morph.radius,
          boxShadow: ISLAND_SHADOW,
        }}
        className={cn(
          // `overflow-hidden` is what makes the capsule the island's silhouette:
          // every visual layer is painted here.
          "pointer-events-auto relative overflow-hidden text-popover-foreground",
          // A blur over a backdrop that repaints every frame is re-sampled every
          // frame; the user's own reduced-transparency request wins outright.
          islandSurfaceClass(backdrop === "auto" && !reducedTransparency),
          className,
        )}
        onKeyDown={handleKeyDown}
      >
        <IslandStage
          layers={layers}
          incoming={incoming}
          geometryFor={geometryFor}
          box={morph.box}
          handover={handover}
          crossfade={instant ? INSTANT : feel.crossfade}
          renderPanel={renderPanel}
          onExited={remove}
        />
      </motion.div>
    </div>
  );
}

/** Measure the natural body, never the animated capsule or its capped viewport. */
function MeasuredBody({
  form,
  onMeasure,
  children,
  actions,
}: {
  form: IslandPanel;
  onMeasure: (form: IslandPanel, height: number) => void;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const footer = React.useRef<HTMLDivElement>(null);
  const body = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const node = body.current;
    if (!node) return;
    // offsetHeight rounds fractional line heights down; that can leave the
    // viewport a fraction shorter than its body and create a needless scrollbar.
    let bodyHeight = node.offsetHeight;
    let footerHeight = footer.current?.offsetHeight ?? 0;
    const measure = () => onMeasure(form, Math.ceil(bodyHeight + footerHeight));
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.borderBoxSize[0]?.blockSize;
        if (entry.target === node) bodyHeight = height ?? node.offsetHeight;
        else footerHeight = height ?? footer.current?.offsetHeight ?? 0;
      }
      measure();
    });
    // Leave a pixel for rounding until the observer reports precise box sizes.
    onMeasure(form, bodyHeight + footerHeight + 1);
    observer.observe(node);
    if (footer.current) observer.observe(footer.current);
    return () => observer.disconnect();
  }, [form, onMeasure, actions]);
  return (
    <div className="flex h-full w-full flex-col">
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain",
          form === "preview" && "scrollbar-hide",
        )}
      >
        <div ref={body} className="flow-root">
          {children}
        </div>
      </div>
      {actions ? (
        <div
          ref={footer}
          className="shrink-0 border-t border-border/60 px-3 py-2"
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  (ref as { current: T | null }).current = value;
}

/**
 * The reachable public surface. `packages/ui`'s `exports` map only translates
 * `./components/*` to `*.tsx`, so a sibling `types.ts` cannot be imported from
 * outside the package — the props contract has to be re-exported from the module
 * a consumer can actually name.
 */
export type {
  DynamicIslandProps,
  IslandExpandedPanel,
  IslandNavItem,
  IslandPanel,
} from "./types";
