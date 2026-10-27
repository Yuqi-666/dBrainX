// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import {
  annotationColorFromHex,
  annotationPaletteHex,
  annotationPickerValue,
} from "./colors";
import { ColorPicker } from "@workspace/ui/components/selector/color-picker";

import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

import * as React from "react";
import { motion } from "motion/react";
import {
  MousePointer2,
  Ellipsis,
  Eraser,
  Eye,
  EyeOff,
  GripVertical,
  Hand,
  PenLine,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@workspace/ui/components/ui/button";
import { Slider } from "@workspace/ui/components/ui/slider";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverAnchor,
} from "@workspace/ui/components/ui/popover";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/ui/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import type { AnnotationToolbarProps } from "./types";
import { ANNOTATION_COLORS, ANNOTATION_SIZES } from "./types";
import { BRUSHES } from "./brushes";
import { useToolbarPreference } from "./use-toolbar-preference";
import { useFloatingToolbar } from "./use-floating-toolbar";

const HIT = "size-9 shrink-0 rounded-lg pointer-coarse:size-11";

function Action({
  label,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  useI18n();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          className={cn(HIT, className)}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function BrushPreview({
  width,
  opacity,
  thinning,
}: {
  width: number;
  opacity: number;
  thinning: number;
}) {
  useI18n();

  return (
    <svg viewBox="0 0 100 28" className="h-7 w-full" aria-hidden="true">
      <path
        d="M5 20 C20 2 27 3 40 15 S63 26 77 12 S90 7 95 9"
        fill="none"
        stroke="currentColor"
        strokeWidth={Math.max(1.5, width * (thinning > 0.7 ? 3 : 2))}
        strokeLinecap="round"
        opacity={opacity}
      />
    </svg>
  );
}

export function AnnotationToolbar(props: AnnotationToolbarProps) {
  const { t } = useI18n();

  const {
    tool,
    onToolChange,
    color,
    onColorChange,
    size,
    onSizeChange,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onClear,
    hidden,
    onToggleHidden,
    touchDraws,
    onToggleTouchDraws,
    eraserMode = "stroke",
    onEraserModeChange,
    onResetView,
    itemCount,
    compact = false,
    className,
  } = props;
  const floating = useFloatingToolbar();
  const [openTool, setOpenTool] = React.useState<
    "pointer" | "brush" | "eraser" | null
  >(null);
  const lastTouchClick = React.useRef<{ mode: string; time: number } | null>(
    null,
  );
  const clickPointerType = React.useRef("mouse");
  const [confirming, setConfirming] = React.useState(false);
  const [lastBrush, setLastBrush] = useToolbarPreference<
    Exclude<typeof tool, "eraser" | "pointer">
  >(
    "lastBrush",
    tool === "eraser" || tool === "pointer" ? "pen" : tool,
    (value): value is Exclude<typeof tool, "eraser" | "pointer"> =>
      BRUSHES.some((entry) => entry.tool === value),
  );
  React.useEffect(() => {
    if (tool !== "eraser" && tool !== "pointer") setLastBrush(tool);
  }, [tool, setLastBrush]);
  React.useEffect(() => {
    if (!confirming) return;
    const timeout = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [confirming]);
  const selectTool = (next: typeof tool) => {
    onToolChange(next);

    if (next !== "pointer" && hidden) onToggleHidden();
  };
  const toolButton = (mode: "pointer" | "brush" | "eraser") => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      clickPointerType.current = event.pointerType;
    },
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      selectTool(mode === "brush" ? lastBrush : mode);
      // Use the browser's click sequence for mouse/pen. A wall-clock counter
      // mistakes the first click of a fast second double-click for its second,
      // opens early, then closes on the actual second click.
      let double = event.detail >= 2;
      if (
        clickPointerType.current === "touch" &&
        event.detail > 0 &&
        event.detail < 2
      ) {
        const now = performance.now();
        double =
          lastTouchClick.current?.mode === mode &&
          now - lastTouchClick.current.time < 400;
        lastTouchClick.current = double ? null : { mode, time: now };
      }
      setOpenTool((current) => (double || current === mode ? mode : null));
    },
    onDoubleClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setOpenTool(mode);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        selectTool(mode === "brush" ? lastBrush : mode);
        setOpenTool(mode);
      }
    },
    "aria-haspopup": "dialog" as const,
    "aria-expanded": openTool === mode,
  });
  const brush =
    BRUSHES.find(
      (entry) =>
        entry.tool ===
        (tool === "eraser" || tool === "pointer" ? lastBrush : tool),
    ) ?? BRUSHES[0];
  const legacyColor = ANNOTATION_COLORS.find((entry) => entry.key === color);
  const paletteHex = annotationPaletteHex(color);
  const selectedColorLabel = legacyColor?.label ?? paletteHex ?? color;
  const colorStyle =
    paletteHex ?? `var(${legacyColor?.cssVar ?? ANNOTATION_COLORS[0]!.cssVar})`;
  const side =
    floating.edge === "left"
      ? "right"
      : floating.edge === "right"
        ? "left"
        : floating.edge === "bottom"
          ? "top"
          : "bottom";
  const divider = (
    <span
      aria-hidden
      className={cn(
        "shrink-0 bg-border",
        floating.vertical ? "mx-1 my-1 h-px w-7" : "mx-1 h-5 w-px",
      )}
    />
  );

  return (
    <TooltipProvider delayDuration={250}>
      <motion.div
        ref={floating.ref}
        data-annotation-toolbar
        data-dock={floating.edge}
        role={t("toolbar")}
        aria-label={t("批注工具栏")}
        aria-orientation={floating.vertical ? "vertical" : "horizontal"}
        style={{ left: 0, top: 0, x: floating.x, y: floating.y }}
        className={cn(
          "pointer-events-auto absolute z-30 flex w-fit max-w-[calc(100%-1rem)] gap-1 rounded-2xl border border-border/70 bg-popover/95 p-1.5 text-popover-foreground shadow-lg ring-1 ring-foreground/5 backdrop-blur-xl",
          floating.vertical
            ? "max-h-[calc(100%-1rem)] flex-col items-center overflow-y-auto"
            : "items-center overflow-x-auto",
          floating.dragging && "select-none shadow-xl",
          className,
        )}
      >
        <Action
          label={t("拖动工具栏 · 方向键停靠 · Home 复位")}
          data-annotation-drag
          className="touch-none cursor-grab text-muted-foreground active:cursor-grabbing"
          {...floating.handle}
        >
          <GripVertical
            className={cn("size-4", floating.vertical && "rotate-90")}
          />
        </Action>
        <div
          className={cn(
            "flex gap-0.5 rounded-xl bg-muted/60 p-0.5",
            floating.vertical && "flex-col",
          )}
        >
          <Popover
            open={openTool === "pointer"}
            onOpenChange={(open) => {
              if (!open)
                setOpenTool((current) =>
                  current === "pointer" ? null : current,
                );
            }}
          >
            <PopoverAnchor asChild>
              <Action
                label={t("指针（V）· 双击设置")}
                data-annotation-tool="pointer"
                data-annotation-pointer
                aria-pressed={tool === "pointer"}
                className="aria-pressed:bg-background aria-pressed:shadow-sm"
                {...toolButton("pointer")}
              >
                <MousePointer2 />
              </Action>
            </PopoverAnchor>
            <PopoverContent
              side={side}
              align="start"
              sideOffset={12}
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                if (
                  (event.target as Element | null)?.closest(
                    "[data-annotation-tool]",
                  )
                )
                  event.preventDefault();
              }}
              className="w-52 gap-2 rounded-2xl p-2"
            >
              <div className="px-2 py-2 text-sm font-medium">{t("指针")}</div>
              <Button
                variant="ghost"
                className="justify-start"
                onClick={() => {
                  onResetView?.();
                  setOpenTool(null);
                }}
              >
                <Hand className="size-4" />
                {t("恢复视图")}{" "}
              </Button>
              <Button
                variant="ghost"
                className="justify-start"
                onClick={onToggleHidden}
              >
                {hidden ? (
                  <Eye className="size-4" />
                ) : (
                  <EyeOff className="size-4" />
                )}
                {hidden ? t("显示批注") : t("隐藏批注")}
              </Button>
            </PopoverContent>
          </Popover>
          <Popover
            open={openTool === "brush"}
            onOpenChange={(open) => {
              if (!open)
                setOpenTool((current) =>
                  current === "brush" ? null : current,
                );
            }}
          >
            <PopoverAnchor asChild>
              <Action
                label={translate("画笔 · {value1}（{value2}）· 双击设置", {
                  value1: brush.label,
                  value2: brush.shortcut,
                })}
                data-annotation-tool={brush.tool}
                data-annotation-brush-trigger
                aria-pressed={tool !== "pointer" && tool !== "eraser"}
                className="aria-pressed:bg-background aria-pressed:shadow-sm"
                {...toolButton("brush")}
              >
                <PenLine
                  style={{
                    color:
                      tool !== "pointer" && tool !== "eraser"
                        ? colorStyle
                        : undefined,
                  }}
                />
              </Action>
            </PopoverAnchor>
            <PopoverContent
              side={side}
              align="start"
              sideOffset={12}
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                if (
                  (event.target as Element | null)?.closest(
                    "[data-annotation-tool]",
                  )
                )
                  event.preventDefault();
              }}
              className="w-64 gap-2 rounded-2xl p-2"
            >
              <div className="px-2 py-2 text-sm font-medium">{t("画笔")}</div>
              <ToggleGroup
                type="single"
                value={
                  tool === "eraser" || tool === "pointer" ? lastBrush : tool
                }
                orientation="vertical"
                onValueChange={(value) => {
                  if (!value) {
                    setOpenTool(null);
                    return;
                  }
                  const next = BRUSHES.find((entry) => entry.tool === value);
                  if (next) {
                    selectTool(next.tool);
                    setLastBrush(next.tool);
                    setOpenTool(null);
                  }
                }}
                className="w-full flex-col gap-1"
              >
                {BRUSHES.map((entry) => (
                  <ToggleGroupItem
                    key={entry.tool}
                    value={entry.tool}
                    data-annotation-tool={entry.tool}
                    aria-label={entry.label}
                    aria-pressed={tool === entry.tool}
                    className="h-12 w-full justify-between gap-3 rounded-lg px-3 aria-pressed:bg-accent"
                  >
                    <span className="w-14 shrink-0 text-left text-xs">
                      {entry.label}
                    </span>
                    <span className="flex-1" style={{ color: colorStyle }}>
                      <BrushPreview {...entry} />
                    </span>
                    <kbd className="text-xs text-muted-foreground">
                      {entry.shortcut}
                    </kbd>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </PopoverContent>
          </Popover>
          <Popover
            open={openTool === "eraser"}
            onOpenChange={(open) => {
              if (!open)
                setOpenTool((current) =>
                  current === "eraser" ? null : current,
                );
            }}
          >
            <PopoverAnchor asChild>
              <Action
                label={t("橡皮（E）· 双击设置")}
                data-annotation-tool="eraser"
                aria-pressed={tool === "eraser"}
                className="aria-pressed:bg-background aria-pressed:shadow-sm"
                {...toolButton("eraser")}
              >
                <Eraser />
              </Action>
            </PopoverAnchor>
            <PopoverContent
              side={side}
              align="start"
              sideOffset={12}
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                if (
                  (event.target as Element | null)?.closest(
                    "[data-annotation-tool]",
                  )
                )
                  event.preventDefault();
              }}
              className="w-52 gap-2 rounded-2xl p-2"
            >
              <div className="px-2 py-2 text-sm font-medium">
                {t("擦除方式")}
              </div>
              <ToggleGroup
                type="single"
                value={eraserMode}
                orientation="vertical"
                className="w-full flex-col gap-1"
                onValueChange={(value) => {
                  if (!value) {
                    setOpenTool(null);
                    return;
                  }
                  if (value === "stroke" || value === "path") {
                    onEraserModeChange?.(value);
                    setOpenTool(null);
                  }
                }}
              >
                <ToggleGroupItem
                  value="stroke"
                  data-annotation-eraser-mode="stroke"
                  className="w-full justify-start gap-2 px-3"
                >
                  <Eraser className="size-4" />
                  {t("笔画擦除")}{" "}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="path"
                  data-annotation-eraser-mode="path"
                  className="w-full justify-start gap-2 px-3"
                >
                  <PenLine className="size-4" />
                  {t("路径擦除")}{" "}
                </ToggleGroupItem>
              </ToggleGroup>
            </PopoverContent>
          </Popover>
        </div>
        {divider}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-annotation-color-trigger
              aria-label={translate("颜色与粗细（{value1}）", {
                value1: selectedColorLabel,
              })}
              className={HIT}
            >
              <span
                className="size-5 rounded-full ring-1 ring-foreground/20 ring-offset-2 ring-offset-popover"
                style={{ backgroundColor: colorStyle }}
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side={side}
            align="start"
            sideOffset={12}
            className="w-80 max-w-[calc(100vw-1rem)] rounded-2xl p-4"
          >
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="font-medium">{t("颜色")}</span>
            </div>
            <ColorPicker
              value={annotationPickerValue(color)}
              onChange={(value) => {
                const next = annotationColorFromHex(value);
                if (next) onColorChange(next);
              }}
              className="p-0"
            />
            <div className="mb-2 mt-5 flex items-center justify-between text-xs">
              <span className="font-medium">{t("笔刷大小")}</span>
              <output className="tabular-nums text-muted-foreground">
                {Number((size * 1000).toFixed(1))}
              </output>
            </div>
            <Slider
              aria-label={t("笔刷大小")}
              data-annotation-size-slider
              min={1}
              max={40}
              step={0.5}
              value={[size * 1000]}
              onValueChange={([value]) => {
                if (value !== undefined) onSizeChange(value / 1000);
              }}
              className="mb-3 min-h-7"
            />
            <ToggleGroup
              type="single"
              value={String(size)}
              onValueChange={(value) => {
                if (value) onSizeChange(Number(value));
              }}
              className="w-full gap-1 rounded-lg bg-muted/60 p-1"
            >
              {ANNOTATION_SIZES.map((value, index) => (
                <ToggleGroupItem
                  key={value}
                  value={String(value)}
                  data-annotation-size={String(index)}
                  aria-label={[t("细"), t("中"), t("粗")][index]}
                  aria-pressed={size === value}
                  className="flex-1 gap-2 rounded-md text-xs aria-pressed:bg-background aria-pressed:shadow-sm"
                >
                  <span
                    className="rounded-full bg-current"
                    style={{ width: 3 + index * 3, height: 3 + index * 3 }}
                  />
                  {[t("细"), t("中"), t("粗")][index]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div
              className="mt-3 rounded-lg bg-muted/40 px-3 py-2"
              style={{ color: colorStyle }}
            >
              <BrushPreview {...brush} width={(brush.width * size) / 0.008} />
            </div>
          </PopoverContent>
        </Popover>
        {divider}
        <Action
          label={t("撤销（⌘ / Ctrl Z）")}
          data-annotation-undo
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 />
        </Action>
        <Action
          label={t("重做（⌘ / Ctrl ⇧ Z）")}
          data-annotation-redo
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 />
        </Action>
        {!compact && (
          <Action
            label={hidden ? t("显示批注（\\）") : t("隐藏批注（\\）")}
            data-annotation-hide
            aria-pressed={hidden}
            onClick={onToggleHidden}
            className="aria-pressed:bg-accent"
          >
            {hidden ? <EyeOff /> : <Eye />}
          </Action>
        )}
        <DropdownMenu onOpenChange={() => setConfirming(false)}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-annotation-more
              aria-label={t("更多批注操作")}
              className={HIT}
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={side}
            align="end"
            sideOffset={12}
            className="w-52 rounded-xl"
          >
            <DropdownMenuCheckboxItem
              data-annotation-touch
              checked={touchDraws}
              onCheckedChange={onToggleTouchDraws}
            >
              {t("手指书写")}{" "}
            </DropdownMenuCheckboxItem>
            {compact && (
              <>
                <DropdownMenuCheckboxItem
                  data-annotation-hide
                  checked={!hidden}
                  onCheckedChange={onToggleHidden}
                >
                  {t("显示批注")}{" "}
                </DropdownMenuCheckboxItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-annotation-clear
              data-annotation-clear-confirm={confirming ? "true" : undefined}
              disabled={itemCount === 0}
              variant="destructive"
              onSelect={(event) => {
                if (!confirming) {
                  event.preventDefault();
                  setConfirming(true);
                } else {
                  onClear();
                  setConfirming(false);
                }
              }}
            >
              <Trash2 />
              {confirming ? t("再次点击，清除全部") : t("清除全部批注")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </motion.div>
    </TooltipProvider>
  );
}
