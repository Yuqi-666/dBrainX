// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The viewer's toolbar. Purely presentational: every value arrives as a prop and
 * every change leaves as a callback, so the strip can be read as a description
 * of the viewer's state without knowing anything about pdfjs.
 *
 * Two layout rules, both learned from the dataview toolbars:
 *
 * - **Fixed-size controls, always present.** The group on the right is anchored
 *   with `ml-auto`, so a control that appears, disappears or resizes on
 *   re-render pushes its neighbours around. Counts live inside fixed-width
 *   boxes, and the hidden variants below are *responsive* (container queries),
 *   never state-dependent within one width.
 * - **Nothing is lost when space runs out.** Every control that is hidden below
 *   a container width is reachable from the 更多 menu, which is itself hidden
 *   once the wide layout returns.
 *
 * The rail has exactly one control here: an open/close switch at the far left.
 * 缩略图 and 大纲 are tabs *inside* the rail, so a top-row button per tab was the
 * same switch twice — and it spent two of the row's scarce slots doing it.
 */
import { useEffect, useState } from "react";
import {
  BookOpen,
  CaseSensitive,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns3,
  Download,
  ExternalLink,
  File,
  Loader2,
  MoreHorizontal,
  PanelLeft,
  Rows3,
  ScrollText,
  Search,
  Square,
  WholeWord,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { Button } from "@workspace/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import { Input } from "@workspace/ui/components/ui/input";
import { Separator } from "@workspace/ui/components/ui/separator";
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

import {
  PDF_ZOOM_STEPS,
  pdfSlotOf,
  pdfSlotStartPage,
  pdfSpreadStep,
  type PdfDirection,
  type PdfScrollMode,
  type PdfSpread,
  type PdfToolbarProps,
} from "./types";

interface IconButtonProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  /** Renders the engaged variant — used for toggles, never for readouts. */
  active?: boolean;
  disabled?: boolean;
  /** Extra classes, e.g. the responsive show/hide wrappers. */
  className?: string;
}

function IconButton({
  label,
  icon: Icon,
  onClick,
  active,
  disabled,
  className,
}: IconButtonProps) {
  useI18n();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant={active ? "secondary" : "ghost"}
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn("shrink-0", className)}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function PdfToolbar({
  page,
  pageCount,
  onPageChange,
  zoom,
  mode,
  onModeChange,
  search,
  sidebar,
  downloadUrl,
  onDownload,
  title,
  extras,
  className,
}: PdfToolbarProps) {
  const { t } = useI18n();

  const horizontal = mode.direction === "horizontal";
  const PreviousIcon = horizontal ? ChevronLeft : ChevronUp;
  const NextIcon = horizontal ? ChevronRight : ChevronDown;
  /**
   * 双页 addresses *slots*, not pages: the counter and the arrows move one spread
   * at a time, which is what the reader sees move.
   */
  const pagesPerSlot = pdfSpreadStep(mode.spread);

  const [draft, setDraft] = useState(String(page));
  useEffect(() => setDraft(String(page)), [page]);

  /**
   * The number a typed page actually lands on: the viewer rounds it down to its
   * slot, so the draft echoes the page that will be shown instead of the digits
   * that were typed — otherwise 双页 would leave `4` sitting in the box while the
   * viewer reports `3`.
   */
  const normalizePage = (value: number) =>
    pdfSlotStartPage(
      pdfSlotOf(Math.min(pageCount || 1, Math.max(1, value)), mode.spread),
      mode.spread,
    );

  const commitPage = () => {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(page));
      return;
    }
    const next = normalizePage(parsed);
    setDraft(String(next));
    if (next !== page) onPageChange(next);
  };

  /**
   * Relative navigation starts from the *draft*, not from the rendered `page`:
   * a blur-commit fires before the click, so typing `5` and then pressing 下一页
   * would otherwise step from the stale page (1) and land back on page 3. One
   * step is one slot, which is what 双页 puts on screen at a time.
   */
  const stepPage = (delta: number) => {
    const parsed = Number.parseInt(draft, 10);
    const base = Number.isFinite(parsed) ? normalizePage(parsed) : page;
    onPageChange(base + delta * pagesPerSlot);
  };

  const zoomLabel =
    zoom.fit === "width"
      ? t("适配宽度")
      : zoom.fit === "page"
        ? t("适配页面")
        : `${Math.round(zoom.scale * 100)}%`;

  const activeScale = Math.round(zoom.scale * 100);

  const selectDirection = (value: string) => {
    if (!value) return;
    onModeChange({ ...mode, direction: value as PdfDirection });
  };

  const selectScroll = (value: string) => {
    if (!value) return;
    onModeChange({ ...mode, scroll: value as PdfScrollMode });
  };

  const selectSpread = (value: string) => {
    if (!value) return;
    onModeChange({ ...mode, spread: value as PdfSpread });
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div
        data-pdf-toolbar
        className={cn(
          // Scroll, never clip: the right-hand group is anchored with `ml-auto`,
          // which collapses to zero when the row overflows — so `overflow-hidden`
          // would cut off the 更多 menu first, i.e. the very control that exists
          // to make the hidden ones reachable.
          "@container flex h-11 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b bg-background/95 px-2",
          className,
        )}
      >
        {/* 侧栏 — the far-left switch. It opens on 大纲; the rail's own tab strip
            switches to 缩略图. */}
        <IconButton
          label={t(sidebar.open ? "收起侧栏" : "展开侧栏")}
          icon={PanelLeft}
          active={sidebar.open}
          onClick={sidebar.onToggle}
        />

        <Separator orientation="vertical" className="mx-0.5 h-5" />

        {/* 翻页 — first of the document controls, always present. */}
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            label={t("上一页")}
            icon={PreviousIcon}
            disabled={page <= 1}
            onClick={() => stepPage(-1)}
          />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              commitPage();
            }}
            className="flex items-center"
          >
            <Input
              value={draft}
              inputMode="numeric"
              aria-label={t("页码")}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitPage}
              className="h-7 w-11 px-1 text-center text-xs tabular-nums"
            />
            <span className="px-1 text-xs tabular-nums text-muted-foreground">
              / {pageCount || "—"}
            </span>
          </form>
          <IconButton
            label={t("下一页")}
            icon={NextIcon}
            // 双页 moves a whole spread at a time, so the last *slot* is the end
            // of the document — page 5 of 6 is already the last pair.
            disabled={
              !pageCount ||
              pdfSlotOf(page, mode.spread) >= pdfSlotOf(pageCount, mode.spread)
            }
            onClick={() => stepPage(1)}
          />
        </div>

        <Separator orientation="vertical" className="mx-0.5 h-5" />

        {/* 缩放 */}
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            label={t("缩小")}
            icon={ZoomOut}
            onClick={zoom.onZoomOut}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 w-20 shrink-0 justify-center text-xs tabular-nums"
              >
                {zoomLabel}
                <ChevronDown className="opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {PDF_ZOOM_STEPS.map((step) => {
                const percent = Math.round(step * 100);
                const active = zoom.fit === "free" && percent === activeScale;
                return (
                  <DropdownMenuItem
                    key={step}
                    onSelect={() => zoom.onSelectScale(step)}
                  >
                    <Check className={cn("size-4", !active && "opacity-0")} />
                    {percent}%
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => zoom.onSelectFit("width")}>
                <Check
                  className={cn("size-4", zoom.fit !== "width" && "opacity-0")}
                />
                {t("适配宽度")}{" "}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => zoom.onSelectFit("page")}>
                <Check
                  className={cn("size-4", zoom.fit !== "page" && "opacity-0")}
                />
                {t("适配页面")}{" "}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton label={t("放大")} icon={ZoomIn} onClick={zoom.onZoomIn} />
        </div>

        <Separator
          orientation="vertical"
          className="mx-0.5 hidden h-5 @5xl:block"
        />

        {/* 布局 — 垂直/水平 × 连续/翻页 × 单页/双页, three independent axes. */}
        <div className="hidden shrink-0 items-center gap-1 @5xl:flex">
          <ToggleGroup
            type="single"
            size="sm"
            value={mode.direction}
            onValueChange={selectDirection}
          >
            <ToggleGroupItem
              value="vertical"
              aria-label={t("垂直")}
              title={t("垂直")}
            >
              <Rows3 />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="horizontal"
              aria-label={t("水平")}
              title={t("水平")}
            >
              <Columns3 />
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            size="sm"
            value={mode.scroll}
            onValueChange={selectScroll}
          >
            <ToggleGroupItem
              value="continuous"
              aria-label={t("连续滚动")}
              title={t("连续滚动")}
            >
              <ScrollText />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="paged"
              aria-label={t("翻页")}
              title={t("翻页")}
            >
              <File />
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            size="sm"
            value={mode.spread}
            onValueChange={selectSpread}
          >
            <ToggleGroupItem
              value="single"
              aria-label={t("单页")}
              title={t("单页")}
            >
              <Square />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="double"
              aria-label={t("双页")}
              title={t("双页")}
            >
              <BookOpen />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* 查找 */}
        <div className="flex min-w-0 shrink items-center gap-0.5">
          {search.open ? (
            <>
              <Input
                autoFocus
                value={search.query}
                placeholder={t("在文档中查找")}
                aria-label={t("在文档中查找")}
                onChange={(event) => search.onQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (event.shiftKey) search.onPrev();
                    else search.onNext();
                    return;
                  }
                  // Escape is deliberately *not* handled here: the viewer stops
                  // it in a window capture listener (see `pdf-viewer.tsx`), so by
                  // the time a React handler could see it the search bar is
                  // already closed and the node editor dialog is safe.
                }}
                className="h-7 w-40 shrink text-xs"
              />
              <span className="hidden w-16 shrink-0 items-center justify-end gap-1 text-xs tabular-nums text-muted-foreground @2xl:flex">
                {search.pending && <Loader2 className="size-3 animate-spin" />}
                {search.count > 0
                  ? `${search.active} / ${search.count}`
                  : search.pending
                    ? ""
                    : "0 / 0"}
              </span>
              <IconButton
                label={t("上一个匹配")}
                icon={PreviousIcon}
                disabled={search.count === 0}
                onClick={search.onPrev}
              />
              <IconButton
                label={t("下一个匹配")}
                icon={NextIcon}
                disabled={search.count === 0}
                onClick={search.onNext}
              />
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("查找选项")}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t("查找选项")}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>{t("查找选项")}</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={search.caseSensitive}
                    onCheckedChange={(value) =>
                      search.onCaseSensitiveChange(value === true)
                    }
                  >
                    <CaseSensitive className="size-4" />
                    {t("区分大小写")}{" "}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={search.wholeWord}
                    onCheckedChange={(value) =>
                      search.onWholeWordChange(value === true)
                    }
                  >
                    <WholeWord className="size-4" />
                    {t("全字匹配")}{" "}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <IconButton
                label={t("关闭查找")}
                icon={X}
                onClick={() => search.onOpenChange(false)}
              />
            </>
          ) : (
            <IconButton
              label={t("查找")}
              icon={Search}
              onClick={() => search.onOpenChange(true)}
            />
          )}
        </div>

        {/* 功能组 — right-anchored, fixed size. */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton
            label={t("下载")}
            icon={Download}
            onClick={onDownload}
            className="hidden @2xl:inline-flex"
          />
          <IconButton
            label={t("在新标签页打开")}
            icon={ExternalLink}
            onClick={() => {
              window.open(downloadUrl, "_blank", "noopener,noreferrer");
            }}
            className="hidden @2xl:inline-flex"
          />

          {extras}

          {/* The narrow-container fallback for everything hidden above. */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("更多")}
                    className="@5xl:hidden"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("更多")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>{title || "PDF"}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {t("方向")}{" "}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={mode.direction}
                onValueChange={selectDirection}
              >
                <DropdownMenuRadioItem value="vertical">
                  <Rows3 className="size-4" />
                  {t("垂直")}{" "}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="horizontal">
                  <Columns3 className="size-4" />
                  {t("水平")}{" "}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {t("滚动")}{" "}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={mode.scroll}
                onValueChange={selectScroll}
              >
                <DropdownMenuRadioItem value="continuous">
                  <ScrollText className="size-4" />
                  {t("连续滚动")}{" "}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="paged">
                  <File className="size-4" />
                  {t("翻页")}{" "}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={mode.spread === "double"}
                onCheckedChange={(value) =>
                  selectSpread(value === true ? "double" : "single")
                }
              >
                <BookOpen className="size-4" />
                {t("双页显示")}{" "}
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onDownload}>
                <Download className="size-4" />
                {t("下载")}{" "}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  window.open(downloadUrl, "_blank", "noopener,noreferrer");
                }}
              >
                <ExternalLink className="size-4" />
                {t("在新标签页打开")}{" "}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  );
}
