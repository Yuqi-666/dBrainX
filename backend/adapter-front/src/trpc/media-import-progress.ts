// SPDX-License-Identifier: AGPL-3.0-only

import type { MediaImportProgress } from "@workspace/interfaces";

/**
 * In-flight progress of the shared video/audio imports.
 *
 * An import is one long-running mutation: the server downloads with yt-dlp and
 * then packages or converts the file, which can take minutes, and the client
 * that started it is watching a bar. The mutation reports its progress here, and
 * the importing client's `file.onMediaImportProgress` subscription reads it back
 * over the same WebSocket.
 *
 * The channel is keyed by the random `jobId` the *client* generated for this one
 * import (the server honours it after validating it), and every event carries
 * the owner's id: a subscriber only receives updates for its own imports, and a
 * finished id is removed by the mutation so it cannot leak. Nothing is persisted
 * here — progress is worthless once the import is over, and the job store is
 * what a reloaded page reads instead.
 */

/** Receives one update of the import named by the key. */
type Listener = (event: {
  userId: string;
  progress: MediaImportProgress;
}) => void;

/** Subscribers per job id, removed by the mutation when it finishes. */
const listeners = new Map<string, Set<Listener>>();

/** Starts listening to one import's progress; returns the unsubscribe function. */
export function subscribeMediaImportProgress(
  jobId: string,
  listener: Listener,
): () => void {
  let set = listeners.get(jobId);
  if (!set) {
    set = new Set();
    listeners.set(jobId, set);
  }
  set.add(listener);

  return () => {
    const current = listeners.get(jobId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(jobId);
  };
}

/** Publishes one update of `jobId` to whoever is watching that id. */
export function publishMediaImportProgress(
  jobId: string,
  userId: string,
  progress: MediaImportProgress,
): void {
  const set = listeners.get(jobId);
  if (!set) return;
  for (const listener of set) {
    try {
      listener({ userId, progress });
    } catch {
      /* a bad subscriber must not fail the import */
    }
  }
}

/** Stops listening to an import entirely, so a finished id cannot leak. */
export function clearMediaImportProgress(jobId: string): void {
  listeners.delete(jobId);
}
