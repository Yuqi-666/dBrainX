// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The client's convergence rules for the graph event stream (plan item 42,
 * §3.5.4.4): consume a fact once, and record an echo of this client's own write
 * without applying it.
 *
 * The stream is still an invalidation signal, not a record the client trusts,
 * so the one thing the client can decide locally is whether it already consumed
 * an event. `eventId` is that identity, and the stream's `cursor` — a position
 * that also names the event — is the fallback when an older message carries no
 * `eventId`. Both are recorded before `apply` runs, so a replay overlap (a
 * reconnect that re-delivers a page the client already has) cannot double-apply
 * a node, and two copies racing through the socket cannot both pass the check.
 *
 * Nothing here touches tRPC, a store or a clock: the subscription hook supplies
 * `apply`, so these rules run under `node --test` without a renderer or a
 * server.
 */

/** One message from `event.onEvent`, structurally (`EventStreamMessage`). */
export interface StreamEvent {
  readonly eventType: string;
  readonly aggregateId?: string;
  /** The envelope's dedupe key; every message since todo 26 carries one. */
  readonly eventId?: string;
  /** Opaque replay position; names the same fact as `eventId`. */
  readonly cursor?: string;
  readonly workspaceId?: string;
  readonly workspaceSequence?: number;
  readonly metadata?: {
    /** The pre-envelope echo id; the legacy shape still sends it. */
    readonly sourceId?: string;
    readonly correlationId?: string;
    readonly workspaceId?: string;
    readonly userId?: string;
  };
  readonly data: unknown;
}

/**
 * What happened to one message.
 *
 * - `applied` — the caller's handler ran.
 * - `own` — this client caused it; recorded so a replay cannot apply it later,
 *   never applied.
 * - `duplicate` — already consumed (same `eventId`, or same `cursor` when an
 *   older message has no `eventId`).
 */
export type EventDisposition = "applied" | "own" | "duplicate";

export interface EventConvergenceOptions<E extends StreamEvent> {
  /** The dispatcher; it receives only events this client has not consumed. */
  readonly apply: (event: E) => void | Promise<void>;
  readonly isOwnOperation?: (event: E) => boolean;
  /**
   * How many identities are remembered. A stream cursor is a position, so the
   * window only has to outlive one replay page; the default holds many.
   */
  readonly appliedLimit?: number;
}

export interface EventConvergence<E extends StreamEvent> {
  /**
   * Consume one message. Resolves with what happened; a throwing `apply` is
   * not retried — the event stays recorded, and the handler's own `sync` (or a
   * workspace resync) is what repairs the state.
   */
  accept(event: E): Promise<EventDisposition>;
  hasApplied(event: E): boolean;
  appliedCount(): number;
  /** The position to resume from on reconnect, once one was consumed. */
  lastCursor(): string | undefined;
  lastEventId(): string | undefined;
  reset(): void;
}

/**
 * The identity an event is deduped by.
 *
 * `eventId` first: it is the envelope's own idempotence key. `cursor` second,
 * because it names the same event and is the only identity an older message
 * carries. A message with neither cannot be deduped and is always applied.
 */
export function dedupeKeyOf(event: StreamEvent): string | undefined {
  if (typeof event.eventId === "string" && event.eventId !== "") {
    return `id:${event.eventId}`;
  }
  if (typeof event.cursor === "string" && event.cursor !== "") {
    return `cursor:${event.cursor}`;
  }
  return undefined;
}

const DEFAULT_APPLIED_LIMIT = 4096;

/** Create the dedupe state one subscription owns. */
export function createEventConvergence<E extends StreamEvent>(
  options: EventConvergenceOptions<E>,
): EventConvergence<E> {
  const limit = Math.max(1, options.appliedLimit ?? DEFAULT_APPLIED_LIMIT);
  const applied = new Set<string>();
  let lastCursor: string | undefined;
  let lastEventId: string | undefined;

  /** Remember one identity, dropping the oldest when the window is full. */
  const remember = (key: string): void => {
    applied.add(key);
    while (applied.size > limit) {
      const oldest = applied.values().next().value;
      if (oldest === undefined) break;
      applied.delete(oldest);
    }
  };

  const notePosition = (event: E): void => {
    if (typeof event.cursor === "string" && event.cursor !== "") {
      lastCursor = event.cursor;
    }
    if (typeof event.eventId === "string" && event.eventId !== "") {
      lastEventId = event.eventId;
    }
  };

  return {
    async accept(event: E): Promise<EventDisposition> {
      const key = dedupeKeyOf(event);
      if (key !== undefined) {
        if (applied.has(key)) return "duplicate";
        // Recorded before the handler runs: two deliveries of one event must
        // not both reach `apply` while the first is still awaiting.
        remember(key);
      }

      if (options.isOwnOperation?.(event) === true) {
        notePosition(event);
        return "own";
      }

      await options.apply(event);
      notePosition(event);
      return "applied";
    },

    hasApplied(event: E): boolean {
      const key = dedupeKeyOf(event);
      return key !== undefined && applied.has(key);
    },

    appliedCount: () => applied.size,
    lastCursor: () => lastCursor,
    lastEventId: () => lastEventId,
    reset(): void {
      applied.clear();
      lastCursor = undefined;
      lastEventId = undefined;
    },
  };
}
