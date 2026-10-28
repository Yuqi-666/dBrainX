// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent, KeyboardEvent } from "react";
import { animate, useMotionValue, useReducedMotion } from "motion/react";

import { useToolbarPreference } from "./use-toolbar-preference";

type Edge = "top" | "right" | "bottom" | "left";
const GAP = 8;
const clamp = (value: number, max: number) =>
  Math.max(GAP, Math.min(value, Math.max(GAP, max - GAP)));

/** Coordinates belong to the toolbar's containing block, including portal hosts. */
export function useFloatingToolbar() {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useToolbarPreference(
    "position",
    { x: GAP, y: GAP },
    (value): value is { x: number; y: number } =>
      typeof value === "object" &&
      value !== null &&
      "x" in value &&
      "y" in value &&
      typeof value.x === "number" &&
      typeof value.y === "number" &&
      Number.isFinite(value.x) &&
      Number.isFinite(value.y) &&
      value.x >= 0 &&
      value.y >= 0,
    !dragging,
  );
  const x = useMotionValue(GAP);
  const y = useMotionValue(GAP);
  const reducedMotion = useReducedMotion();
  const [edge, setEdge] = useToolbarPreference<Edge>(
    "edge",
    "top",
    (value): value is Edge =>
      value === "top" ||
      value === "right" ||
      value === "bottom" ||
      value === "left",
  );
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  } | null>(null);
  const vertical = edge === "left" || edge === "right";

  useLayoutEffect(() => {
    if (dragging || reducedMotion) {
      x.jump(position.x);
      y.jump(position.y);
      return;
    }
    const transition = {
      type: "spring" as const,
      stiffness: 380,
      damping: 38,
      mass: 0.8,
    };
    const moveX = animate(x, position.x, transition);
    const moveY = animate(y, position.y, transition);
    return () => {
      moveX.stop();
      moveY.stop();
    };
  }, [position.x, position.y, dragging, reducedMotion, x, y]);

  const bounds = () => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    return {
      width: parent?.clientWidth ?? 0,
      height: parent?.clientHeight ?? 0,
      w: el?.offsetWidth ?? 0,
      h: el?.offsetHeight ?? 0,
    };
  };

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.offsetParent;
    if (!el || !parent || dragging) return;
    const fit = () => {
      const { width, height, w, h } = bounds();
      setPosition((p) => {
        const next = {
          x:
            edge === "left"
              ? GAP
              : edge === "right"
                ? Math.max(GAP, width - w - GAP)
                : clamp(p.x, width - w),
          y:
            edge === "top"
              ? GAP
              : edge === "bottom"
                ? Math.max(GAP, height - h - GAP)
                : clamp(p.y, height - h),
        };
        return next.x === p.x && next.y === p.y ? p : next;
      });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    observer.observe(el);
    return () => observer.disconnect();
  }, [edge, dragging, position.x, position.y, setPosition]);

  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    const { width, height, w, h } = bounds();
    const x = clamp(current.lastX, width - w);
    const y = clamp(current.lastY, height - h);
    const distances: [Edge, number][] = [
      ["top", y],
      ["bottom", height - h - y],
      ["left", x],
      ["right", width - w - x],
    ];
    distances.sort((a, b) => a[1] - b[1]);
    setPosition({ x, y });
    setEdge(distances[0]![0]);
  };

  return {
    ref,
    position,
    x,
    y,
    edge,
    vertical,
    dragging,
    handle: {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const actualX = x.get();
        const actualY = y.get();
        x.stop();
        y.stop();
        setPosition({ x: actualX, y: actualY });
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          startX: actualX,
          startY: actualY,
          lastX: actualX,
          lastY: actualY,
        };
        setDragging(true);
      },
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        const { width, height, w, h } = bounds();
        current.lastX = clamp(
          current.startX + event.clientX - current.x,
          width - w,
        );
        current.lastY = clamp(
          current.startY + event.clientY - current.y,
          height - h,
        );
        setPosition({ x: current.lastX, y: current.lastY });
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        const edges: Record<string, Edge> = {
          ArrowUp: "top",
          ArrowDown: "bottom",
          ArrowLeft: "left",
          ArrowRight: "right",
        };
        const next = edges[event.key];
        if (next) {
          event.preventDefault();
          event.stopPropagation();
          setEdge(next);
        }
        if (event.key === "Home") {
          event.preventDefault();
          setPosition({ x: GAP, y: GAP });
          setEdge("top");
        }
      },
    },
  };
}
