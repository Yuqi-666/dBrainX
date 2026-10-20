// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * Debounced auto-commit for an always-editable surface.
 *
 * The note card's rich-text body and its title have **no save gesture**: the
 * card is the editor, so a keystroke is the edit and there is no Enter to press
 * (the single-block template swallows Enter on purpose, and a title input that
 * committed on Enter would be the only control in the sidebar with a key nobody
 * can see). The body is a whole Tiptap document, so waiting for a blur alone
 * would lose a typed line the moment the node editor unmounts.
 *
 * Two rules make the trade safe, and both are why this is a hook rather than a
 * `setTimeout` at each call site:
 *
 * 1. **Only the last value of a burst is written.** `schedule` replaces the
 *    pending value and restarts the timer, so typing a sentence is one write,
 *    not one write per character.
 * 2. **The burst can always be ended early.** `flush` is what a blur (and an
 *    unmount) calls, so leaving a card writes immediately instead of up to
 *    `delayMs` later.
 *
 * `commit` is held in a ref, so a caller may pass an inline arrow without
 * resetting the pending timer on every render.
 */
import * as React from "react";

export interface AutoCommit<T> {
  /** Queue `value` as the next write, replacing anything still pending. */
  schedule: (value: T) => void;
  /** Write the pending value now, if there is one. */
  flush: () => void;
}

export function useAutoCommit<T>(
  commit: (value: T) => void,
  delayMs = 600,
): AutoCommit<T> {
  const commitRef = React.useRef(commit);
  const timerRef = React.useRef<number | null>(null);
  const pendingRef = React.useRef<{ value: T } | null>(null);

  React.useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  const flush = React.useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    commitRef.current(pending.value);
  }, []);

  const schedule = React.useCallback(
    (value: T) => {
      pendingRef.current = { value };
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        flush();
      }, delayMs);
    },
    [delayMs, flush],
  );

  // An unmount is not a cancel: the last edit before the node editor closed is
  // still an edit. `flush` on an already-flushed pair does nothing.
  React.useEffect(() => flush, [flush]);

  return { schedule, flush };
}
