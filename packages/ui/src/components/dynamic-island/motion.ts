// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { animate, useMotionValue, useSpring, useTransform } from "motion/react";
import type {
  AnimationPlaybackControls,
  MotionValue,
  Transition,
} from "motion/react";

import { layerOpacity, layerScale, proximity } from "./geometry";
import type { Box, BoxSpec, Geometry, Handover, LayerSide } from "./geometry";

/**
 * The morph as springs, and nothing else.
 *
 * Two things live here and they are deliberately separate: the capsule's own box
 * (three springs the shell renders) and one content layer's motion (a scale and
 * an opacity). Every value is produced by calling the pure functions in
 * `geometry.ts` — the numbers are not re-derived in a closure, so the tests in
 * `geometry.test.ts` describe what actually runs.
 */

export interface BoxMotion {
  readonly width: MotionValue<number>;
  readonly height: MotionValue<number>;
  readonly radius: MotionValue<number>;
  /** The live box, for anything that has to reason about the current size. */
  readonly box: {
    readonly w: MotionValue<number>;
    readonly h: MotionValue<number>;
  };
  /** Move to a geometry **without** animating (the pill's first measurement). */
  jump: (geometry: Geometry) => void;
}

export function useBoxMotion(
  geometry: Geometry,
  spring: Transition,
  instant: boolean,
): BoxMotion {
  const width = useMotionValue(geometry.w);
  const height = useMotionValue(geometry.h);
  const radius = useMotionValue(geometry.radius);
  const running = useRef<AnimationPlaybackControls[]>([]);

  const stop = useCallback(() => {
    running.current.forEach((control) => control.stop());
    running.current = [];
  }, []);

  /**
   * A hard cut is written straight to the values in a **layout** effect:
   * `animate()` resolves its keyframes through the frame loop, so even a
   * zero-duration tween would land a frame late — which is precisely the "the
   * size switches directly" promise, missed by one frame.
   */
  useLayoutEffect(() => {
    if (!instant) return;
    stop();
    width.jump(geometry.w);
    height.jump(geometry.h);
    radius.jump(geometry.radius);
  }, [
    instant,
    stop,
    width,
    height,
    radius,
    geometry.w,
    geometry.h,
    geometry.radius,
  ]);

  /**
   * The replacement animation is built **before** the outgoing one is stopped:
   * motion seeds a new animation with `value.getVelocity()`, so clicking
   * "搜索" and then "收起" 140ms later bends the same spring instead of queueing
   * a second animation.
   */
  useEffect(() => {
    if (instant) return;
    const next = [
      animate(width, geometry.w, spring),
      animate(height, geometry.h, spring),
      animate(radius, geometry.radius, spring),
    ];
    stop();
    running.current = next;
  }, [
    instant,
    width,
    height,
    radius,
    geometry.w,
    geometry.h,
    geometry.radius,
    spring,
    stop,
  ]);

  useEffect(() => stop, [stop]);

  const jump = useCallback(
    (next: Geometry) => {
      stop();
      width.jump(next.w);
      height.jump(next.h);
      radius.jump(next.radius);
    },
    [stop, width, height, radius],
  );

  return useMemo(
    () => ({
      width,
      height,
      radius,
      box: { w: width, h: height },
      jump,
    }),
    [width, height, radius, jump],
  );
}

/**
 * How far the live box is from `target` (see `geometry.proximity`). This single
 * number is what the whole content swap is a function of.
 */
export function useProximity(
  box: BoxMotion["box"],
  target: Box,
): MotionValue<number> {
  return useTransform([box.w, box.h], ([w = 0, h = 0]: number[]) =>
    proximity({ w, h }, target),
  );
}

export interface LayerMotion {
  /** `scale` for the authored frame: the layer shrinks with the capsule. */
  readonly scale: MotionValue<number>;
  /** `opacity` for the layer: the geometric swap, smoothed. */
  readonly opacity: MotionValue<number>;
}

export interface LayerMotionOptions {
  /** The form this layer renders — a `"content"` form has no width to fit to. */
  form: BoxSpec;
  /** The layer's own box; at rest its scale is exactly `1`. */
  authored: Geometry;
  /** The live capsule box. */
  box: BoxMotion["box"];
  /** The live box's distance from the *incoming* form. */
  distance: MotionValue<number>;
  side: LayerSide;
  /** When this side takes the capsule over — see `tuning.ts`. */
  handover: Handover;
  crossfade: Transition;
}

export function useLayerMotion({
  form,
  authored,
  box,
  distance,
  side,
  handover,
  crossfade,
}: LayerMotionOptions): LayerMotion {
  const scale = useTransform([box.w, box.h], ([w = 0, h = 0]: number[]) =>
    layerScale(form, authored, { w, h }),
  );
  const opacity = useSpring(
    useTransform(distance, (value: number) =>
      layerOpacity(value, side, handover),
    ),
    crossfade,
  );

  /**
   * A hand-over that is **already over** must not be played, and only the
   * outgoing side can be in that position: an incoming layer's spring starts at
   * its target, but a demoted one was already fully opaque, so without this it
   * would spend a fifth of a second dissolving out from under the body that
   * replaced it — exactly the ghost the `grow` timing exists to remove.
   *
   * A *layout* effect, so it lands before the browser paints the demoted layer.
   * `jump` also stops the spring, so the retarget cannot revive it: the target is
   * a constant for this hand-over, so the next animation it schedules is from the
   * value it is already at.
   */
  useLayoutEffect(() => {
    if (handover === "done") opacity.jump(side === "in" ? 1 : 0);
  }, [handover, side, opacity]);

  return useMemo(() => ({ scale, opacity }), [scale, opacity]);
}
