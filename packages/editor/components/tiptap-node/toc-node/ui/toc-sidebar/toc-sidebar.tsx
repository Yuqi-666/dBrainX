// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useCallback, useMemo, useEffect, useRef, useState } from "react";

import { cn } from "@workspace/editor/lib/tiptap-utils";
import {
  getScrollableAncestor,
  useToc,
} from "@workspace/editor/components/tiptap-node/toc-node/context/toc-context";
import { resolveScrollActiveHeadingId } from "@workspace/editor/components/tiptap-node/toc-node/context/toc-scroll";
import type {
  TableOfContentData,
  TableOfContentDataItem,
} from "@tiptap/extension-table-of-contents";

import "./toc-sidebar.scss";

/**
 * The reading line, in pixels below the top of the scroll container. The
 * heading that has scrolled past this line is the section the reader is in.
 *
 * The TOC sidebar sits inside the document's scroll container: the rich-text
 * node editor scrolls an inner `overflow-y-auto` element, not the window. The
 * `@tiptap/extension-table-of-contents` default `scrollParent` is `window`, so
 * its `isActive` never moves in that setup — this component tracks the real
 * scroller itself and keeps its own active id.
 */
const TOC_READING_LINE = 64;

export interface TocSidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The maximum number of headings to show in the TOC.
   * @default 20
   */
  maxShowCount?: number;
  /**
   * Offset from the top of the editor container (in pixels).
   * @default 0
   */
  topOffset?: number;
}

export function TocSidebar({
  className,
  maxShowCount = 20,
  topOffset = 0,
  ...props
}: TocSidebarProps) {
  const { t } = useI18n();

  const { tocContent, navigateToHeading, normalizeHeadingDepths } = useToc();
  const hasRestoredHashRef = useRef(false);

  // Track when a click happened so we can ignore scroll events
  // caused by our own programmatic scrolling for a short time.
  const lastClickTimeRef = useRef<number | null>(null);

  // Manual active id (from user clicks). This should override scroll-based
  // and selection-based active states while it's set.
  const [manualActiveId, setManualActiveId] = useState<string | null>(null);

  // Heading derived from where the document scroller actually is; see
  // {@link TOC_READING_LINE} for why the extension cannot provide this.
  const [scrollActiveId, setScrollActiveId] = useState<string | null>(null);

  const headingList = useMemo<TableOfContentData>(
    () => tocContent ?? [],
    [tocContent],
  );

  const visibleHeadings = useMemo(
    () => headingList.slice(0, maxShowCount),
    [headingList, maxShowCount],
  );

  const normalizedDepths = useMemo(
    () => normalizeHeadingDepths(visibleHeadings),
    [visibleHeadings, normalizeHeadingDepths],
  );

  const depthById = useMemo(() => {
    const map = new Map<string, number>();
    visibleHeadings.forEach((h, index) => {
      map.set(h.id, normalizedDepths[index] ?? 1);
    });
    return map;
  }, [visibleHeadings, normalizedDepths]);

  // Scroll-based highlighted heading (using isActive)
  const highlightedHeading = useMemo<TableOfContentDataItem | null>(
    () => [...headingList].reverse().find((h) => h.isActive) ?? null,
    [headingList],
  );

  // Selection-based active heading (isActive)
  const selectionActiveId = useMemo(
    () => headingList.find((h) => h.isActive)?.id ?? null,
    [headingList],
  );

  // Decide which heading is "active" for UI purposes
  const activeContentId = useMemo(() => {
    // 1. User clicked something: manual always wins.
    if (manualActiveId) {
      return manualActiveId;
    }

    // 2. The heading the real scroll container has scrolled past.
    if (scrollActiveId) {
      return scrollActiveId;
    }

    // 3. Scroll-highlighted heading (extension scroll logic).
    if (highlightedHeading?.id) {
      return highlightedHeading.id;
    }

    // 4. Selection-based active heading (cursor).
    if (selectionActiveId) {
      return selectionActiveId;
    }

    // 5. Fallback to first heading.
    return headingList[0]?.id;
  }, [
    manualActiveId,
    scrollActiveId,
    highlightedHeading,
    selectionActiveId,
    headingList,
  ]);

  const handleContentClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, item: TableOfContentDataItem) => {
      e.preventDefault();
      e.stopPropagation();

      // Mark this heading as manually active
      setManualActiveId(item.id);
      lastClickTimeRef.current = Date.now();

      navigateToHeading(item, { topOffset });
    },
    [navigateToHeading, topOffset],
  );

  /**
   * Highlight the correct TOC entry when the page loads with a hash.
   * Actual scrolling / selection is handled by useScrollToHash — we only
   * need to set the manual-active marker so the sidebar UI matches.
   */
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      hasRestoredHashRef.current ||
      !headingList.length
    ) {
      return;
    }

    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;

    const target = headingList.find((h) => h.id === hash);
    if (target) {
      setManualActiveId(target.id);
      hasRestoredHashRef.current = true;
    }
  }, [headingList]);

  const sidebarRef = useRef<HTMLDivElement>(null);

  // Keep a ref in sync so the scroll handler can read the latest value
  // without being recreated on every manualActiveId change.
  const manualActiveIdRef = useRef(manualActiveId);
  manualActiveIdRef.current = manualActiveId;

  // The scroll handler must see the latest heading list without re-subscribing
  // to the scroller every time the extension republishes it (which happens on
  // every document change).
  const headingListRef = useRef(headingList);
  headingListRef.current = headingList;

  const recomputeScrollActive = useRef<() => void>(() => {});

  /**
   * Track the scroll container the editor really uses.
   *
   * The TOC extension's own active state compares `window.scrollY` with each
   * heading's `offsetTop`; inside the rich-text node the page is scrolled by an
   * inner `overflow-y-auto` element, so the extension never sees a scroll and
   * the highlight stays on the first heading. Measuring the headings against
   * that container is what makes the highlight follow the document.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    // Held in its own binding so the narrowed type survives into the nested
    // handlers below.
    const scrollHost: HTMLElement = sidebar;

    let frame = 0;
    let target: HTMLElement | Window = getScrollableAncestor(scrollHost);

    function onScroll() {
      if (frame) return;
      frame = window.requestAnimationFrame(compute);
    }

    /**
     * Moves the listener when the scroll container changes.
     *
     * The first pass can run before the document is tall enough to overflow,
     * when `getScrollableAncestor` still answers `window`; once content fills
     * the pane the real container appears and the listener has to follow it.
     */
    function track(next: HTMLElement | Window) {
      if (next === target) return;
      target.removeEventListener("scroll", onScroll);
      target = next;
      target.addEventListener("scroll", onScroll, { passive: true });
    }

    function compute() {
      frame = 0;
      track(getScrollableAncestor(scrollHost));

      const headings = headingListRef.current;
      if (!headings.length) {
        setScrollActiveId(null);
        return;
      }

      const readingLine =
        target instanceof Window
          ? TOC_READING_LINE
          : target.getBoundingClientRect().top + TOC_READING_LINE;

      const anchors = headings
        .filter((heading) => heading.dom?.isConnected)
        .map((heading) => ({
          id: heading.id,
          top: heading.dom.getBoundingClientRect().top,
        }));

      // Above the first heading the document has not started yet; the first
      // section is the one the reader is looking at.
      setScrollActiveId(
        resolveScrollActiveHeadingId(anchors, readingLine) ??
          headings[0]?.id ??
          null,
      );
    }

    recomputeScrollActive.current = onScroll;
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    onScroll();

    return () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      recomputeScrollActive.current = () => {};
    };
  }, []);

  // Headings arrive after the editor parses the document, so the first pass
  // above usually runs with an empty list. Recompute when it fills in (and when
  // an edit adds or removes a heading) without re-subscribing to the scroller.
  useEffect(() => {
    recomputeScrollActive.current();
  }, [headingList]);

  /**
   * Clear manual active id when the user actually scrolls
   * (but ignore the scroll events that immediately follow our own
   * programmatic scroll from a click).
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleScroll = () => {
      const now = Date.now();
      const lastClickTime = lastClickTimeRef.current;

      // Ignore scroll events within 500ms of a click
      if (lastClickTime && now - lastClickTime < 500) {
        return;
      }

      // User is scrolling manually now; go back to scroll-based logic.
      if (manualActiveIdRef.current !== null) {
        setManualActiveId(null);
      }
    };

    // Find the scrollable ancestor to also listen on it
    const scrollTarget = sidebarRef.current
      ? getScrollableAncestor(sidebarRef.current)
      : null;

    window.addEventListener("scroll", handleScroll, { passive: true });

    // If the scrollable ancestor is not the window, listen on it too
    if (scrollTarget && !(scrollTarget instanceof Window)) {
      scrollTarget.addEventListener("scroll", handleScroll, { passive: true });
    }

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollTarget && !(scrollTarget instanceof Window)) {
        scrollTarget.removeEventListener("scroll", handleScroll);
      }
    };
  }, []);

  const hasHeadings = headingList.length > 0;

  return (
    <div ref={sidebarRef} className={cn("toc-sidebar", className)} {...props}>
      <div className="toc-sidebar-wrapper">
        <div className="toc-sidebar-inner">
          {/* Progress rail */}
          <div className="toc-sidebar-progress">
            {visibleHeadings.map((item) => {
              const depth = depthById.get(item.id) ?? 1;
              const isActive = activeContentId === item.id;

              return (
                <div
                  key={item.id}
                  className={cn(
                    "toc-sidebar-progress-line",
                    isActive && "toc-sidebar-progress-line--active",
                  )}
                  data-depth={depth}
                  style={{ "--toc-depth": depth } as React.CSSProperties}
                />
              );
            })}
          </div>

          {/* TOC nav */}
          <nav
            className={cn(
              "toc-sidebar-nav",
              !hasHeadings && "toc-sidebar-nav--hidden",
            )}
            aria-label={t("Table of contents")}
          >
            <div className="toc-sidebar-popover">
              {visibleHeadings.map((item) => {
                const depth = depthById.get(item.id) ?? 1;
                const isActive = activeContentId === item.id;

                return (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    rel="noopener noreferrer"
                    className={cn(
                      "toc-sidebar-item notranslate",
                      isActive && "toc-sidebar-item--active",
                    )}
                    data-depth={depth}
                    style={{ "--toc-depth": depth } as React.CSSProperties}
                    onClick={(e) => handleContentClick(e, item)}
                    aria-current={isActive ? "location" : undefined}
                  >
                    {item.textContent}
                  </a>
                );
              })}
            </div>
          </nav>
        </div>
      </div>
    </div>
  );
}
