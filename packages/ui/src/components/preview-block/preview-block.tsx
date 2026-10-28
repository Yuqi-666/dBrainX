// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import * as React from "react";
import { X } from "lucide-react";
import { useDataStore } from "@workspace/store";
import { PREVIEW_WIDTH, PREVIEW_MAX_HEIGHT, PREVIEW_MARGIN } from "./types";
import { NodePreviewBody } from "./node-preview-body";

let latestMousePosition = { x: 0, y: 0 };
if (typeof window !== "undefined") {
  window.addEventListener("mousemove", (e: MouseEvent) => {
    latestMousePosition = { x: e.clientX, y: e.clientY };
  });
}

export interface PreviewBlockProps {
  nodeId: string;
  containerRef: React.RefObject<HTMLElement | null>;
  onClose?: () => void;
  visible: boolean;
  isFocus?: boolean;
}

// 边界计算函数（使用实际尺寸）
function calculatePosition(
  mouseX: number,
  mouseY: number,
  containerRef: React.RefObject<HTMLElement | null>,
  previewWidth: number,
  previewHeight: number,
): { left: number; top: number } {
  let left = mouseX + PREVIEW_MARGIN;
  let top = mouseY + PREVIEW_MARGIN;

  if (!containerRef.current) return { left, top };

  const rect = containerRef.current.getBoundingClientRect();
  const exceedsRight = left + previewWidth > rect.right;
  const exceedsBottom = top + previewHeight > rect.bottom;

  if (exceedsRight) left = mouseX - previewWidth - PREVIEW_MARGIN;
  if (exceedsBottom) top = mouseY - previewHeight - PREVIEW_MARGIN;

  left = Math.max(
    rect.left + PREVIEW_MARGIN,
    Math.min(left, rect.right - previewWidth - PREVIEW_MARGIN),
  );
  top = Math.max(
    rect.top + PREVIEW_MARGIN,
    Math.min(top, rect.bottom - previewHeight - PREVIEW_MARGIN),
  );

  return { left, top };
}

export function PreviewBlock({
  nodeId,
  containerRef,
  onClose,
  visible,
  isFocus,
}: PreviewBlockProps) {
  const { t } = useI18n();

  const node = useDataStore((state) => state.nodes.get(nodeId));
  const previewRef = React.useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = React.useState({
    width: PREVIEW_WIDTH,
    height: PREVIEW_MAX_HEIGHT,
  });
  const [, setTick] = React.useState(0);
  const [frozenPosition, setFrozenPosition] = React.useState<{
    x: number;
    y: number;
  } | null>(null);

  React.useEffect(() => {
    if (!visible) return;
    const handleMouseMove = () => setTick((prev) => prev + 1);
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [visible]);

  React.useEffect(() => {
    if (isFocus) {
      // Freeze (or re-freeze when switching nodes) at the current mouse
      // position — which is the click position at the moment `isFocus`
      // becomes true or `nodeId` changes.
      setFrozenPosition({ x: latestMousePosition.x, y: latestMousePosition.y });
    } else {
      setFrozenPosition(null);
    }
  }, [isFocus, nodeId]);

  // Reset to defaults when the node changes so the preview isn't
  // positioned with stale dimensions from the previous node.
  React.useEffect(() => {
    setPreviewSize({ width: PREVIEW_WIDTH, height: PREVIEW_MAX_HEIGHT });
  }, [nodeId]);

  React.useEffect(() => {
    if (!previewRef.current) return;
    const updateSize = () => {
      const el = previewRef.current;
      if (el) {
        setPreviewSize({ width: el.offsetWidth, height: el.offsetHeight });
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(previewRef.current);
    return () => observer.disconnect();
  }, [visible]);

  const pos = calculatePosition(
    isFocus && frozenPosition ? frozenPosition.x : latestMousePosition.x,
    isFocus && frozenPosition ? frozenPosition.y : latestMousePosition.y,
    containerRef,
    previewSize.width,
    previewSize.height,
  );

  // ESC 关闭
  const handleClose = React.useCallback(() => onClose?.(), [onClose]);
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) =>
      e.key === "Escape" && handleClose();
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose]);

  if (!visible || !node) return null;

  return (
    <div
      ref={previewRef}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: `min(${PREVIEW_WIDTH}px, calc(100vw - 32px))`,
        maxHeight: `min(${PREVIEW_MAX_HEIGHT}px, calc(100vh - 32px))`,
        zIndex: 9999,
      }}
      data-preview-block
      className="pointer-events-none overflow-y-auto rounded-2xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10"
    >
      {isFocus && onClose && (
        <button
          onClick={handleClose}
          aria-label={t("关闭预览")}
          className="absolute right-2 top-2 rounded-full p-1 hover:bg-accent/80 transition-colors"
        >
          <X className="size-3.5 text-muted-foreground" />
        </button>
      )}
      <NodePreviewBody node={node} />
    </div>
  );
}
