// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useRef, useState } from "react";
import { useDialogContentContainer } from "@workspace/ui/components/ui/dialog";

/** Place a nested popover beside its owning floating layer, above that layer. */
export function usePopoverLayer() {
  const dialogContainer = useDialogContentContainer();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [layer, setLayer] = useState<{
    container: HTMLElement | null;
    zIndex: number;
  }>({ container: dialogContainer, zIndex: 51 });
  const prepareLayer = () => {
    let container = dialogContainer;
    let zIndex = 50;
    for (
      let node: HTMLElement | null = triggerRef.current;
      node;
      node = node.parentElement
    ) {
      if (
        node.matches(
          '[data-slot="dropdown-menu-content"], [data-slot="dropdown-menu-sub-content"], [data-slot="popover-content"]',
        )
      ) {
        const parentZIndex = Number.parseInt(getComputedStyle(node).zIndex, 10);
        if (Number.isFinite(parentZIndex))
          zIndex = Math.max(zIndex, parentZIndex);
      }
      // The outer wrapper's host avoids both menu clipping and dialog stacking.
      if (node.hasAttribute("data-radix-popper-content-wrapper"))
        container = node.parentElement;
    }
    setLayer({ container, zIndex: zIndex + 1 });
  };
  return { triggerRef, prepareLayer, ...layer };
}
