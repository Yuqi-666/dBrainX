// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import type { SidebarMode } from "@workspace/store";
import { useEffect, useRef, type RefObject } from "react";

/**
 * Keeps a floating (`temp`) panel up exactly while the pointer is over it — or
 * over a menu it opened — and closes it otherwise.
 *
 * "Over it" is read from the DOM instead of from `mouseleave`: a Radix menu
 * renders in a portal **outside** the panel, so moving into that menu reports a
 * leave on the panel even though the pointer never really left the interaction.
 * The condition is therefore derived from live state (`elementFromPoint` plus
 * the presence of a popper wrapper) and re-evaluated on both kinds of change:
 * pointer movement, and menu open/close — a close emits no `pointermove`, but it
 * does change the DOM, which is why a MutationObserver watches for it.
 *
 * The graph's sidebar and both dashboard panels share this one implementation, so
 * the surfaces cannot drift apart.
 */
const MENU_SELECTOR = [
  "[data-radix-popper-content-wrapper]",
  "[data-radix-menu-content]",
  "[data-slot='dropdown-menu-content']",
  "[data-slot='dropdown-menu-sub-content']",
].join(",");

export function useFloatingPanel<T extends HTMLElement>(
  mode: SidebarMode,
  panelRef: RefObject<T | null>,
  close: () => void,
) {
  const closeRef = useRef(close);

  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  useEffect(() => {
    if (mode !== "temp") return;

    let lastX = -1;
    let lastY = -1;

    const keepOpen = () => {
      if (document.querySelector(MENU_SELECTOR)) return true;
      const el = document.elementFromPoint(lastX, lastY);
      return !!el && !!panelRef.current?.contains(el);
    };

    const evaluate = () => {
      if (!keepOpen()) closeRef.current();
    };

    const onPointerMove = (event: PointerEvent) => {
      lastX = event.clientX;
      lastY = event.clientY;
      evaluate();
    };

    const observer = new MutationObserver((mutations) => {
      const menuChanged = mutations.some((mutation) =>
        [...mutation.addedNodes, ...mutation.removedNodes].some(
          (node) => node instanceof Element && node.matches(MENU_SELECTOR),
        ),
      );
      if (menuChanged) evaluate();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("pointermove", onPointerMove);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      observer.disconnect();
    };
  }, [mode, panelRef]);
}
