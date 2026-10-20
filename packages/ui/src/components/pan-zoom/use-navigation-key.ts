// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** Space temporarily hands mouse input to the viewport, scoped to this viewer. */
export function useNavigationKey(root: RefObject<HTMLElement | null>) {
  const [pressed, setPressed] = useState(false);
  const pressedRef = useRef(false);
  useEffect(() => {
    const release = () => {
      pressedRef.current = false;
      setPressed(false);
    };
    const down = (event: KeyboardEvent) => {
      if (
        event.code !== "Space" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      const element = root.current;
      const target = event.target as HTMLElement | null;
      if (
        !element ||
        target?.closest(
          "input, textarea, select, [contenteditable='true'], button, [role='button']",
        )
      )
        return;
      if (!element.contains(target) && !element.matches(":hover")) return;
      event.preventDefault();
      pressedRef.current = true;
      setPressed(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") release();
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") release();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [root]);
  return { pressed, pressedRef };
}
