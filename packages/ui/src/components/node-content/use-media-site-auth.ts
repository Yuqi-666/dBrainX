// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  disconnectMediaSite,
  mediaSites,
  verifyMediaSite,
} from "@workspace/api-client";
import type { MediaSites } from "@workspace/api-client";
import type { MediaKind } from "@workspace/interfaces";
import { mediaImportFailure } from "./use-media-url-import";

/**
 * The listed media sites and their saved logins, kept outside React.
 *
 * Two dialogs can ask for the same list (a video node and an audio node, or the
 * same node reopened), and opening the login sheet must light up the capsules
 * the cookie import connected. Holding the list at module level keyed by kind
 * means:
 *
 * - one `mediaSites(kind)` request serves every mounted dialog of that kind;
 * - a login or a disconnect updates both the sheet and the capsule row without
 *   any parent passing state through props;
 * - a request is not repeated when the dialog is closed and reopened.
 *
 * The server is the source of truth for login state: every mutating action
 * finishes with a refresh instead of guessing the new state locally. A failed
 * refresh is shown as a row-level message, not thrown, because a stale list is
 * still usable — the import flow re-checks the login itself.
 */

/** What one kind's site list currently looks like. */
export interface MediaSiteAuthSnapshot {
  kind: MediaKind;
  /** The server's answer, `null` until the first successful load. */
  data: MediaSites | null;
  /** True while a request is in flight. */
  loading: boolean;
  /** Human message of the last failed load / action, `null` when clear. */
  error: string | null;
}

/** Shared immutable snapshot for a kind that has not loaded yet. */
const EMPTY: Omit<MediaSiteAuthSnapshot, "kind"> = {
  data: null,
  loading: false,
  error: null,
};

interface Entry {
  snapshot: MediaSiteAuthSnapshot;
  listeners: Set<() => void>;
  /** The request in flight, so two dialogs share one load instead of racing. */
  loading: Promise<void> | null;
}

const entries = new Map<MediaKind, Entry>();

function entryFor(kind: MediaKind): Entry {
  let entry = entries.get(kind);
  if (!entry) {
    entry = {
      snapshot: { ...EMPTY, kind },
      listeners: new Set(),
      loading: null,
    };
    entries.set(kind, entry);
  }
  return entry;
}

function setSnapshot(
  kind: MediaKind,
  update: (snapshot: MediaSiteAuthSnapshot) => MediaSiteAuthSnapshot,
): void {
  const entry = entryFor(kind);
  const next = update(entry.snapshot);
  if (next === entry.snapshot) return;
  entry.snapshot = next;
  entry.listeners.forEach((listener) => listener());
}

/** Reads the current snapshot; stable while nothing changes. */
export function getMediaSiteAuth(kind: MediaKind): MediaSiteAuthSnapshot {
  return entries.get(kind)?.snapshot ?? { ...EMPTY, kind };
}

/** Subscribes to one kind's site list; returns the unsubscribe function. */
export function subscribeMediaSiteAuth(
  kind: MediaKind,
  listener: () => void,
): () => void {
  const entry = entryFor(kind);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

/**
 * Loads the site list (or reuses the load already in flight) and stores it.
 *
 * A failure keeps the previous `data`: a stale list still names the sites, and
 * the capsules can say "could not refresh" instead of emptying the dialog.
 */
export function refreshMediaSiteAuth(kind: MediaKind): Promise<void> {
  const entry = entryFor(kind);
  if (entry.loading) return entry.loading;

  setSnapshot(kind, (snapshot) => ({
    ...snapshot,
    loading: true,
    error: null,
  }));

  const request = mediaSites(kind)
    .then((data) => {
      setSnapshot(kind, (snapshot) => ({
        ...snapshot,
        data,
        loading: false,
      }));
    })
    .catch((error: unknown) => {
      setSnapshot(kind, (snapshot) => ({
        ...snapshot,
        loading: false,
        error: mediaImportFailure(error).message,
      }));
    })
    .finally(() => {
      entry.loading = null;
    });

  entry.loading = request;
  return request;
}

/** Re-checks one saved login and refreshes the row afterwards. */
export async function verifyMediaSiteAuth(
  kind: MediaKind,
  siteKey: string,
): Promise<void> {
  try {
    await verifyMediaSite(siteKey);
  } finally {
    // Refresh even on failure: a failed verification is exactly what turns the
    // capsule amber, and that status comes from the server.
    await refreshMediaSiteAuth(kind);
  }
}

/** Removes one saved login and refreshes the row afterwards. */
export async function disconnectMediaSiteAuth(
  kind: MediaKind,
  siteKey: string,
): Promise<void> {
  try {
    await disconnectMediaSite(siteKey);
  } finally {
    await refreshMediaSiteAuth(kind);
  }
}

/**
 * Subscribes a component to one kind's site list and loads it on first use.
 *
 * The actions are returned bound to `kind`, so a component never has to thread
 * that argument through a callback. `refresh` is stable per kind, which keeps it
 * safe in an effect dependency list.
 */
export function useMediaSiteAuth(kind: MediaKind): {
  snapshot: MediaSiteAuthSnapshot;
  refresh: () => Promise<void>;
  verify: (siteKey: string) => Promise<void>;
  disconnect: (siteKey: string) => Promise<void>;
} {
  const subscribe = useCallback(
    (listener: () => void) => subscribeMediaSiteAuth(kind, listener),
    [kind],
  );
  const getSnapshot = useCallback(() => getMediaSiteAuth(kind), [kind]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () =>
    getMediaSiteAuth(kind),
  );

  const refresh = useCallback(() => refreshMediaSiteAuth(kind), [kind]);
  const verify = useCallback(
    (siteKey: string) => verifyMediaSiteAuth(kind, siteKey),
    [kind],
  );
  const disconnect = useCallback(
    (siteKey: string) => disconnectMediaSiteAuth(kind, siteKey),
    [kind],
  );

  // A dialog opening is the moment the list matters; load once per kind. The
  // refresh is a no-op while another component's load is already running.
  useEffect(() => {
    if (snapshot.data === null && !snapshot.loading) void refresh();
  }, [refresh, snapshot.data, snapshot.loading]);

  return { snapshot, refresh, verify, disconnect };
}
