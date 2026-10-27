// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import type { ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import type { Annotation } from "@workspace/interfaces";

import { AnnotationLayer } from "@workspace/ui/components/annotation/annotation-layer";
import { Button } from "@workspace/ui/components/ui/button";
import { useNavigationKey } from "@workspace/ui/components/pan-zoom/use-navigation-key";
import { LoadingPlaceholder } from "@workspace/ui/components/editor/loading-placeholder";
import { cn } from "@workspace/ui/lib/utils";

interface ImageViewerProps {
  url: string;
  title?: string;
  annotations?: Annotation[];
  onAnnotationsChange: (items: Annotation[]) => void;
  compact?: boolean;
}

/** One transformed content box owns both image and ink; chrome stays outside. */
export function ImageViewer({
  url,
  title,
  annotations,
  onAnnotationsChange,
  compact,
}: ImageViewerProps) {
  const { t } = useI18n();

  const root = useRef<HTMLDivElement | null>(null);
  const viewport = useRef<ReactZoomPanPinchRef | null>(null);
  const [toolbarContainer, setToolbarContainer] =
    useState<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [touchDraws, setTouchDraws] = useState(false);
  const [active, setActive] = useState(false);
  const [scale, setScale] = useState(1);
  const [rasterScale, setRasterScale] = useState(1);
  const { pressed, pressedRef } = useNavigationKey(root);
  const penDown = useRef(false);

  useEffect(() => {
    const image = new Image();
    image.onload = () =>
      setNatural({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => setFailed(true);
    image.src = url;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [url]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit =
    natural && size.width > 0 && size.height > 0
      ? Math.min(
          Math.max(1, size.width - 32) / natural.width,
          Math.max(1, size.height - 32) / natural.height,
        )
      : 0;
  const width = (natural?.width ?? 0) * fit;
  const height = (natural?.height ?? 0) * fit;
  const actualSizeScale = fit ? 1 / fit : 1;
  const minScale = Math.min(0.1, actualSizeScale);
  const maxScale = Math.max(8, actualSizeScale * 4);

  useEffect(() => {
    const timer = window.setTimeout(() => setRasterScale(scale), 160);
    return () => window.clearTimeout(timer);
  }, [scale]);

  useLayoutEffect(() => {
    // Re-align after a host resize, without discarding the chosen zoom level.
    viewport.current?.centerView(viewport.current.state.scale, 0);
  }, [width, height]);

  const isNavigationGesture = useCallback(
    (event: PointerEvent) =>
      event.pointerType === "mouse" &&
      (event.button === 1 || pressedRef.current),
    [pressedRef],
  );

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    // The library handles MouseEvent/TouchEvent. Block synthesized mouse events
    // from a stylus and touch events from a palm before they reach its listeners.
    const stopPalm = (event: Event) => {
      if (penDown.current || event.type.startsWith("touch"))
        event.stopPropagation();
    };
    const finishPen = (event: PointerEvent) => {
      if (event.pointerType === "pen") penDown.current = false;
    };
    const clear = () => {
      penDown.current = false;
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") clear();
    };
    element.addEventListener("mousedown", stopPalm, true);
    element.addEventListener("touchstart", stopPalm, true);
    element.addEventListener("touchmove", stopPalm, true);
    element.addEventListener("touchend", stopPalm, true);
    element.addEventListener("touchcancel", stopPalm, true);
    window.addEventListener("pointerup", finishPen);
    window.addEventListener("pointercancel", finishPen);
    window.addEventListener("lostpointercapture", finishPen);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      element.removeEventListener("mousedown", stopPalm, true);
      element.removeEventListener("touchstart", stopPalm, true);
      element.removeEventListener("touchmove", stopPalm, true);
      element.removeEventListener("touchend", stopPalm, true);
      element.removeEventListener("touchcancel", stopPalm, true);
      window.removeEventListener("pointerup", finishPen);
      window.removeEventListener("pointercancel", finishPen);
      window.removeEventListener("lostpointercapture", finishPen);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);

  const fitView = () => viewport.current?.centerView(1, 180);
  const fingers = useRef(
    new Map<number, { x: number; y: number; startX: number; startY: number }>(),
  );
  const touchSequence = useRef({ moved: false, peak: 0, started: 0 });
  const lastTap = useRef<{ x: number; y: number; time: number } | null>(null);

  const finishTouch = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    const point = fingers.current.get(event.pointerId);
    if (!point) return;
    fingers.current.delete(event.pointerId);
    if (fingers.current.size) return;
    const sequence = touchSequence.current;
    if (
      event.type === "pointerup" &&
      !sequence.moved &&
      sequence.peak === 1 &&
      event.timeStamp - sequence.started < 300
    ) {
      const previous = lastTap.current;
      if (
        previous &&
        event.timeStamp - previous.time < 350 &&
        Math.hypot(point.x - previous.x, point.y - previous.y) < 30
      ) {
        lastTap.current = null;
        fitView();
      } else lastTap.current = { ...point, time: event.timeStamp };
    } else lastTap.current = null;
  };
  return (
    <div
      ref={root}
      data-image-viewer
      style={{ touchAction: "none" }}
      tabIndex={0}
      onPointerUpCapture={finishTouch}
      onPointerCancelCapture={finishTouch}
      onLostPointerCapture={finishTouch}
      onPointerMoveCapture={(event) => {
        const point = fingers.current.get(event.pointerId);
        const handle = viewport.current;
        if (!point || !handle || penDown.current) return;
        const before = [...fingers.current.values()].map((p) => ({ ...p }));
        point.x = event.clientX;
        point.y = event.clientY;
        if (Math.hypot(point.x - point.startX, point.y - point.startY) > 8)
          touchSequence.current.moved = true;
        const after = [...fingers.current.values()];
        if (after.length === 1 && drawing && touchDraws) return;
        const center = (points: { x: number; y: number }[]) => ({
          x: points.reduce((n, p) => n + p.x, 0) / points.length,
          y: points.reduce((n, p) => n + p.y, 0) / points.length,
        });
        const old = center(before),
          next = center(after);
        const distance = (points: { x: number; y: number }[]) =>
          Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
        const ratio =
          after.length === 2
            ? distance(after) / Math.max(1, distance(before))
            : 1;
        const state = handle.state;
        const target = Math.max(
          minScale,
          Math.min(maxScale, state.scale * ratio),
        );
        const factor = target / state.scale;
        const box = root.current!.getBoundingClientRect();
        handle.setTransform(
          factor * state.positionX +
            (1 - factor) * (old.x - box.left) +
            next.x -
            old.x,
          factor * state.positionY +
            (1 - factor) * (old.y - box.top) +
            next.y -
            old.y,
          target,
          0,
        );
      }}
      onPointerDownCapture={(event) => {
        if (event.pointerType === "touch" && !penDown.current) {
          if (!fingers.current.size)
            touchSequence.current = {
              moved: false,
              peak: 0,
              started: event.timeStamp,
            };
          fingers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
            startX: event.clientX,
            startY: event.clientY,
          });
          touchSequence.current.peak = Math.max(
            touchSequence.current.peak,
            fingers.current.size,
          );
          // Capture on the original surface so annotation keeps receiving samples.
          (event.target as Element).setPointerCapture(event.pointerId);
        }
        if (event.pointerType === "pen") penDown.current = true;
        if (
          drawing &&
          (event.pointerType !== "touch" ||
            (touchDraws && fingers.current.size === 1)) &&
          !isNavigationGesture(event.nativeEvent)
        ) {
          const handle = viewport.current;
          if (handle) {
            const { positionX, positionY, scale } = handle.state;
            // A one-millisecond stationary animation cancels any momentum using
            // the library's public controls before the stroke samples its box.
            handle.setTransform(positionX, positionY, scale, 1);
          }
        }
      }}
      onKeyDown={(event) => {
        if (active) return;
        if (
          (event.target as HTMLElement).closest(
            "input, textarea, button, [contenteditable='true']",
          )
        )
          return;
        if (event.key === "0") {
          event.preventDefault();
          fitView();
        }
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          viewport.current?.zoomIn();
        }
        if (event.key === "-") {
          event.preventDefault();
          viewport.current?.zoomOut();
        }
      }}
      className={cn(
        "relative h-full w-full overflow-hidden outline-none",
        !drawing || pressed
          ? "cursor-grab active:cursor-grabbing"
          : "cursor-crosshair",
      )}
    >
      {!natural && !failed && <LoadingPlaceholder variant="image" />}
      {failed && (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {t("图片加载失败")}{" "}
        </div>
      )}
      {fit > 0 && (
        <TransformWrapper
          ref={viewport}
          initialScale={1}
          minScale={minScale}
          maxScale={maxScale}
          centerOnInit
          centerZoomedOut
          limitToBounds
          disablePadding
          wheel={{
            disabled: active,
            step: 0.008,
            activationKeys: (keys) =>
              keys.includes("Control") || keys.includes("Meta"),
          }}
          trackPadPanning={{ disabled: active }}
          panning={{
            allowLeftClickPan: !drawing || pressed,
            allowMiddleClickPan: true,
            allowRightClickPan: false,
            disabled: active,
            excluded: drawing && touchDraws && !pressed ? ["canvas"] : [],
          }}
          pinch={{ disabled: penDown.current, allowPanning: true }}
          doubleClick={{
            disabled: true,
            mode: "toggle",
            step: 1,
            animationTime: 180,
          }}
          onTransform={(_context, state) => setScale(state.scale)}
        >
          <TransformComponent
            wrapperStyle={{ width: "100%", height: "100%" }}
            contentStyle={{ width, height }}
          >
            <div className="relative" style={{ width, height }}>
              <img
                src={url}
                alt={title || t("图片")}
                draggable={false}
                className="block h-full w-full select-none rounded-sm"
              />
              <AnnotationLayer
                selfMeasured
                toolbarContainer={toolbarContainer}
                items={annotations}
                onItemsChange={onAnnotationsChange}
                pointerToggle
                defaultPointerEnabled={false}
                onPointerEnabledChange={setDrawing}
                onTouchDrawsChange={setTouchDraws}
                onActiveChange={setActive}
                isNavigationGesture={isNavigationGesture}
                arbitrateViewport
                compact={compact}
                rasterScale={rasterScale}
                maxDpr={2}
                maxPixels={8_000_000}
                onResetView={fitView}
              />
            </div>
          </TransformComponent>
        </TransformWrapper>
      )}
      <div
        ref={setToolbarContainer}
        className="pointer-events-none absolute inset-0 z-30"
      />
      {fit > 0 && (
        <div
          data-image-controls
          className="pointer-events-none absolute inset-x-0 bottom-2 z-30 flex justify-center"
        >
          <div className="pointer-events-auto flex items-center gap-1 rounded-md border bg-popover/95 p-1 shadow-sm backdrop-blur-sm">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("缩小图片")}
              disabled={active || scale <= minScale}
              onClick={() => viewport.current?.zoomOut()}
            >
              <Minus />
            </Button>
            <span
              className="w-14 text-center text-xs tabular-nums"
              aria-live="polite"
            >
              {Math.round(scale * fit * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("放大图片")}
              disabled={active || scale >= maxScale}
              onClick={() => viewport.current?.zoomIn()}
            >
              <Plus />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={active}
              onClick={fitView}
            >
              <Maximize />
              {t("适配")}{" "}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={active}
              onClick={() => viewport.current?.centerView(actualSizeScale, 180)}
            >
              100%
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
