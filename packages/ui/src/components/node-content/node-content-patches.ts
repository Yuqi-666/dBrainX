// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeData } from "@workspace/interfaces";

/** Include queued content patches when preparing the next edit in a gesture. */
export function queuedContent<C>(
  content: C,
  patches: readonly Partial<NodeData>[],
): C {
  return Object.assign(
    {},
    content,
    ...patches.map((patch) => patch.content ?? {}),
  );
}

/** Merge content keys as well as node keys when draining one gesture. */
export function mergeNodePatches(
  patches: readonly Partial<NodeData>[],
): Partial<NodeData> {
  const merged = Object.assign({}, ...patches) as Partial<NodeData>;
  const contentPatches = patches.filter((patch) => patch.content !== undefined);
  if (contentPatches.length > 0) {
    merged.content = Object.assign(
      {},
      ...contentPatches.map((patch) => patch.content),
    );
  }
  return merged;
}
