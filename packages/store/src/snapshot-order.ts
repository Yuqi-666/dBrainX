// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The ordering rule for server snapshots (plan item 82, IS-3).
 *
 * One snapshot can reach the store twice: once as the reply of the operation
 * that caused it, once as the refetch a domain event triggers. The two
 * deliveries can arrive in either order, a duplicate is possible, and a
 * reconnect can replay an older one. The store therefore keeps one snapshot per
 * entity and only replaces it with one that is not older.
 *
 * A snapshot carries two ordering signals:
 * - `updatedAt`, the version the server stamped on the stored record;
 * - `identity`, the delivery that carried it (an event id, or the operation's
 *   correlation id when the reply carries the snapshot first).
 *
 * `updatedAt` decides whenever the two snapshots name different versions, so a
 * stale reply can never replace a newer event. `identity` only breaks a tie, so
 * two deliveries of one server revision converge on one snapshot no matter
 * which arrives first.
 *
 * A delivery with no `identity` is not a server write: it is a read of the
 * server's current record (the refetch behind an event, or the workspace load)
 * or the caller's own projection of what it shows. Such a delivery is applied
 * at an equal version, because it cannot be older than the record it describes
 * and refusing it would freeze an optimistic edit in place.
 */
export interface SnapshotOrder {
  /** The record's server-stamped version; absent when the record has none. */
  updatedAt?: string;
  /** The delivery that carried the snapshot; absent for a read or projection. */
  identity?: string;
}

/**
 * -1, 0 or 1 for two stamps. An ISO instant parses to a comparable number; a
 * stamp the runtime cannot parse falls back to a literal comparison so a bad
 * value is never mistaken for "no version".
 */
function compareStamps(incoming: string, existing: string): number {
  const incomingAt = Date.parse(incoming);
  const existingAt = Date.parse(existing);
  if (!Number.isNaN(incomingAt) && !Number.isNaN(existingAt)) {
    if (incomingAt === existingAt) return 0;
    return incomingAt > existingAt ? 1 : -1;
  }
  if (incoming === existing) return 0;
  return incoming > existing ? 1 : -1;
}

/**
 * True when `incoming` may replace the snapshot the store holds for the same
 * entity.
 *
 * `existing` is what the store applied last: the entity itself for
 * `updatedAt`, plus the identity recorded with it.
 */
export function isNewerSnapshot(
  incoming: SnapshotOrder,
  existing: SnapshotOrder,
): boolean {
  if (incoming.updatedAt !== undefined && existing.updatedAt !== undefined) {
    const order = compareStamps(incoming.updatedAt, existing.updatedAt);
    if (order !== 0) return order > 0;
  } else if (
    incoming.updatedAt === undefined &&
    existing.updatedAt !== undefined
  ) {
    // An unversioned snapshot (a view) never replaces a versioned one.
    return false;
  } else if (incoming.updatedAt !== undefined) {
    // A versioned snapshot always replaces an unversioned one.
    return true;
  }

  // The same version, or neither side carries one: identity breaks the tie.
  if (incoming.identity === undefined) return true;
  if (existing.identity === undefined) return true;
  return incoming.identity > existing.identity;
}
