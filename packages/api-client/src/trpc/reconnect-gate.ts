// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The wait a re-handshake puts in front of the requests that follow it.
 *
 * `createWSClient().close()` is asynchronous: it settles the pending requests
 * and only then closes the socket. A request issued inside that window reaches
 * the socket link while the old connection is still closing and before the next
 * `open()` runs, and `wsLink` answers it `Active connection is not open` instead
 * of connecting. A workspace switch is exactly that shape — it closes the socket
 * (the handshake names the workspace) and immediately loads six models.
 *
 * The queue holds those requests until the close settles, then forwards them in
 * the order they arrived. A close that rejects still releases the queue: the
 * next request opens a fresh connection anyway, so nothing is held forever.
 */
import type { TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AnyRouter } from "@trpc/server";

export interface ReconnectQueue {
  run(close: () => Promise<void>): Promise<void>;
  pending(): Promise<void> | null;
}

export function createReconnectQueue(): ReconnectQueue {
  let pending: Promise<void> | null = null;

  return {
    run(close) {
      const closing = close().catch(() => undefined);
      pending = closing;
      void closing.then(() => {
        if (pending === closing) pending = null;
      });
      return closing;
    },
    pending() {
      return pending;
    },
  };
}

/**
 * A link that waits for {@link ReconnectQueue.pending} before delegating.
 *
 * It has to sit in front of the socket link, because the socket link is the one
 * that refuses instead of waiting.
 */
export function createReconnectGate<TRouter extends AnyRouter>(
  queue: Pick<ReconnectQueue, "pending">,
): TRPCLink<TRouter> {
  return () => (opts) => {
    const closing = queue.pending();
    if (closing === null) return opts.next(opts.op);

    return observable((observer) => {
      let live = true;
      let inner: { unsubscribe(): void } | undefined;
      const proceed = () => {
        if (!live) return;
        inner = opts.next(opts.op).subscribe(observer);
      };
      void closing.then(proceed, proceed);
      return () => {
        live = false;
        inner?.unsubscribe();
      };
    });
  };
}
