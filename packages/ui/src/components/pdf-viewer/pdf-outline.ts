// SPDX-License-Identifier: AGPL-3.0-only

import type { PdfOutlineEntry } from "./types";

/**
 * The outline rows the reader is "in", as the sibling-index path of the active
 * row plus every ancestor of it.
 *
 * The active section is the **last** row that *starts* at or before the current
 * page, not the row whose page equals it: a chapter has to stay lit across all
 * of its pages and only go dark when the next chapter begins. Walking the
 * document order and keeping the last match also leaves a row whose destination
 * is still ahead of the reader unlit.
 *
 * Paths are the sibling indices joined with a dot (`"2.1.0"`), which is what
 * both the row components and the test compare on.
 */
export function outlineActiveKeys(
  entries: readonly PdfOutlineEntry[],
  page: number,
): ReadonlySet<string> {
  const flat: { path: string[]; page: number }[] = [];
  const walk = (items: readonly PdfOutlineEntry[], path: string[]) => {
    items.forEach((item, index) => {
      const next = [...path, String(index)];
      if (item.page !== null) flat.push({ path: next, page: item.page });
      walk(item.items, next);
    });
  };
  walk(entries, []);

  let active: string[] | null = null;
  for (const item of flat) {
    if (item.page <= page) active = item.path;
  }
  const keys = new Set<string>();
  if (active) {
    const path: string[] = active;
    for (let depth = 1; depth <= path.length; depth += 1) {
      keys.add(path.slice(0, depth).join("."));
    }
  }
  return keys;
}

/** Whether `path` is an ancestor of the active row (so it should unfold). */
export function outlinePathIsOnActiveChain(
  activeKeys: ReadonlySet<string>,
  path: string,
): boolean {
  for (const key of activeKeys) {
    if (key.startsWith(`${path}.`)) return true;
  }
  return false;
}
