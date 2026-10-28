// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useCallback, useSyncExternalStore } from "react";
import { MediaImportRequestError } from "@workspace/api-client";
import type {
  MediaImportErrorCode,
  MediaImportProgress,
  MediaKind,
} from "@workspace/interfaces";
import { readMediaImportError } from "@workspace/utils/media-import";

/**
 * Media imports (video and audio), kept outside React.
 *
 * The import dialog is mounted by the node edit dialog, and closing that dialog
 * unmounts the drop zone while the backend keeps downloading for minutes. A
 * component-local progress state would therefore be lost exactly when the user
 * closes the dialog to look at something else — reopening showed an empty drop
 * zone while the import was still running.
 *
 * This is the same pattern `useFileUpload` uses for uploads: the state is keyed
 * by node id at module level, so a zone mounted again subscribes to the entry
 * the previous instance started and renders the live bar. The success report is
 * a global toast fired by the import promise itself, which also outlives the
 * component. The server-side job store is the second half: a zone mounted after
 * a page reload finds the running job through `mediaImportJob(nodeId)` and
 * re-attaches to it (`file-drop-zone.tsx`).
 *
 * Both kinds share one entry per node because one node can only run one import
 * at a time — the server refuses a second one for the same node with `busy`.
 * The entry names its `kind` so the progress view can word the phases.
 */

/** The import currently in flight for one node. */
export interface MediaUrlImportActive {
  /** What is being imported. */
  kind: MediaKind;
  /** Page address being imported. */
  url: string;
  /**
   * Server-side id of the job, `""` until the first progress update or result.
   *
   * A fresh import lets the API layer generate the id (it needs it before the
   * mutation starts) and reports it back through the progress callback; a
   * resumed import starts with the id the old job already had.
   */
  jobId: string;
  /** Latest server progress, `null` before the first update. */
  progress: MediaImportProgress | null;
}

/** A failed import, kept until the next mounted zone shows it. */
export interface MediaUrlImportFailure {
  /** What was being imported. */
  kind: MediaKind;
  /** Page address that failed, prefilled into the retry dialog. */
  url: string;
  /** Stable reason, so the dialog can highlight the matching site capsule. */
  code: MediaImportErrorCode;
  /** Message reported to the user. */
  message: string;
}

/**
 * A job the server still knows about after this client lost its promise.
 *
 * `interrupted` is what a page reload, a closed browser, or a server restart
 * leaves behind: the downloaded part is still on disk and the job can continue
 * with the same id. `completed` is a result waiting to be written onto the node;
 * the zone writes it and confirms the job, which deletes it.
 */
export interface MediaUrlImportResumable {
  /** Job id the server stored; a resume must reuse it. */
  jobId: string;
  /** What is being imported. */
  kind: MediaKind;
  /** Page address being imported. */
  url: string;
  /** Chosen quality / audio tier, so a resume keeps the user's pick. */
  formatId: string;
  /** Job state found on mount. */
  state: "running" | "completed" | "interrupted";
}

/** What one node has going on in the media-import surface. */
export interface MediaUrlImportSnapshot {
  active: MediaUrlImportActive | null;
  failure: MediaUrlImportFailure | null;
  resumable: MediaUrlImportResumable | null;
}

/** Shared immutable snapshot for a node that has never imported anything. */
const IDLE: MediaUrlImportSnapshot = {
  active: null,
  failure: null,
  resumable: null,
};

/** One node's import state plus the components watching it. */
interface Entry {
  snapshot: MediaUrlImportSnapshot;
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();

function entryFor(nodeId: string): Entry {
  let entry = entries.get(nodeId);
  if (!entry) {
    entry = { snapshot: IDLE, listeners: new Set() };
    entries.set(nodeId, entry);
  }
  return entry;
}

function setSnapshot(
  nodeId: string,
  update: (snapshot: MediaUrlImportSnapshot) => MediaUrlImportSnapshot,
): void {
  const entry = entryFor(nodeId);
  const next = update(entry.snapshot);
  if (next === entry.snapshot) return;
  entry.snapshot = next;
  entry.listeners.forEach((listener) => listener());
}

/** Reads the current snapshot; stable while nothing changes. */
export function getMediaUrlImport(nodeId: string): MediaUrlImportSnapshot {
  return entries.get(nodeId)?.snapshot ?? IDLE;
}

/** Subscribes to one node's import state; returns the unsubscribe function. */
export function subscribeMediaUrlImport(
  nodeId: string,
  listener: () => void,
): () => void {
  const entry = entryFor(nodeId);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

/**
 * Marks an import as in flight for this node.
 *
 * A new attempt replaces any failure and consumes any resumable job: either the
 * user dismissed the old failure by trying again, or they are resuming the one
 * job the server holds — in both cases the previous entry is stale.
 */
export function startMediaUrlImport(
  nodeId: string,
  attempt: Pick<MediaUrlImportActive, "kind" | "url"> & {
    jobId?: string;
  },
): void {
  setSnapshot(nodeId, () => ({
    active: {
      kind: attempt.kind,
      url: attempt.url,
      jobId: attempt.jobId ?? "",
      progress: null,
    },
    failure: null,
    resumable: null,
  }));
}

/** Applies one server update to the import in flight. */
export function reportMediaUrlImportProgress(
  nodeId: string,
  progress: MediaImportProgress,
): void {
  setSnapshot(nodeId, (snapshot) => {
    if (!snapshot.active) return snapshot;
    return {
      ...snapshot,
      active: {
        ...snapshot.active,
        // The API layer owns the id for a fresh import; adopting the first
        // update is how the bar learns it without a second source of truth.
        jobId: snapshot.active.jobId || progress.jobId,
        progress,
      },
    };
  });
}

/** The import finished (success or failure); its bar must disappear. */
export function completeMediaUrlImport(nodeId: string): void {
  setSnapshot(nodeId, (snapshot) =>
    snapshot.active === null ? snapshot : { ...snapshot, active: null },
  );
}

/** Records a failure until a mounted zone shows it in the retry dialog. */
export function failMediaUrlImport(
  nodeId: string,
  failure: MediaUrlImportFailure,
): void {
  setSnapshot(nodeId, (snapshot) => ({
    ...snapshot,
    active: null,
    failure,
  }));
}

/** Marks the failure as shown, so reopening the editor later starts clean. */
export function consumeMediaUrlImportFailure(nodeId: string): void {
  setSnapshot(nodeId, (snapshot) =>
    snapshot.failure === null ? snapshot : { ...snapshot, failure: null },
  );
}

/** Records (or clears) the server-side job a mounted zone can re-attach to. */
export function setMediaUrlImportResumable(
  nodeId: string,
  resumable: MediaUrlImportResumable | null,
): void {
  setSnapshot(nodeId, (snapshot) =>
    snapshot.resumable === resumable ? snapshot : { ...snapshot, resumable },
  );
}

/** Drops the server-side job entry, e.g. after a resume or an explicit cancel. */
export function clearMediaUrlImportResumable(nodeId: string): void {
  setMediaUrlImportResumable(nodeId, null);
}

/**
 * The reason and the sentence of a failed media call.
 *
 * The API layer throws {@link MediaImportRequestError} with the classified code
 * already separated from the message. Anything else (a transport failure, an
 * older call site) still goes through the shared wire-format reader, so the UI
 * never has to look for the `MEDIA_ERROR:` prefix itself.
 */
export function mediaImportFailure(error: unknown): {
  code: MediaImportErrorCode;
  message: string;
} {
  if (error instanceof MediaImportRequestError) {
    return {
      code: error.code,
      message: error.message.trim() || "The import failed",
    };
  }
  return readMediaImportError(error);
}

/**
 * Subscribes a component to one node's media-import state.
 *
 * `useSyncExternalStore` keeps a remount in step with the promise the previous
 * instance started: no React state is copied, the snapshot is the source of
 * truth.
 */
export function useMediaUrlImport(nodeId: string): MediaUrlImportSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => subscribeMediaUrlImport(nodeId, listener),
    [nodeId],
  );
  const getSnapshot = useCallback(() => getMediaUrlImport(nodeId), [nodeId]);
  return useSyncExternalStore(subscribe, getSnapshot, () => IDLE);
}
