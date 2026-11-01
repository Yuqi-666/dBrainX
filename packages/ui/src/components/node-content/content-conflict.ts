// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one signal a stopped content queue sends to the surface that can show it.
 *
 * It lives in its own module, with no runtime import, for two reasons: the
 * queue keeps no UI dependency (and stays runnable under `node --test`), and a
 * component that subscribes here does not pull the service/tRPC graph into its
 * own module graph.
 */

export interface ContentConflictNotice {
  readonly operationId: string;
  readonly code: "VERSION_CONFLICT";
  readonly message: string;
}

type Listener = (notice: ContentConflictNotice) => void;

const listeners = new Set<Listener>();

/** Report a version conflict to every mounted surface. */
export function emitContentConflict(notice: ContentConflictNotice): void {
  for (const listener of listeners) listener(notice);
}

export function subscribeContentConflicts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
