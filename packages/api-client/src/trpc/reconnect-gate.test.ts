// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Operation } from "@trpc/client";
import { observable } from "@trpc/server/observable";

import { createReconnectGate, createReconnectQueue } from "./reconnect-gate.ts";

const OP = {
  id: 1,
  type: "query",
  path: "workspace.listByUser",
  input: {},
  context: {},
} as Operation<unknown>;

async function send(
  gate: ReturnType<typeof createReconnectGate>,
  seen: string[],
): Promise<void> {
  const link = gate({});
  await new Promise<void>((resolve, reject) => {
    const subscription = link({
      op: OP,
      next: (op) =>
        observable((observer) => {
          seen.push(op.path);
          observer.next({ result: { type: "data", data: { ok: true } } });
          observer.complete();
        }),
    }).subscribe({
      next: () => undefined,
      error: reject,
      complete: resolve,
    });
    setTimeout(() => subscription.unsubscribe(), 50).unref();
  });
}

function deferred() {
  let resolve: () => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("a request issued while the socket closes waits for it", async () => {
  const queue = createReconnectQueue();
  const gate = createReconnectGate(queue);
  const close = deferred();
  const seen: string[] = [];

  void queue.run(() => close.promise);
  const request = send(gate, seen);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(seen, [], "the request reached the socket while it closed");

  close.resolve();
  await request;
  assert.deepEqual(seen, [OP.path]);
});

test("a failed close still releases the queue", async () => {
  const queue = createReconnectQueue();
  const gate = createReconnectGate(queue);
  const seen: string[] = [];

  await queue.run(() => Promise.reject(new Error("socket already gone")));
  assert.equal(queue.pending(), null);

  await send(gate, seen);
  assert.deepEqual(seen, [OP.path]);
});

test("without a close in flight a request goes straight out", async () => {
  const queue = createReconnectQueue();
  const gate = createReconnectGate(queue);
  const seen: string[] = [];

  assert.equal(queue.pending(), null);
  await send(gate, seen);
  assert.deepEqual(seen, [OP.path]);
});

test("a second close replaces the wait of the first", async () => {
  const queue = createReconnectQueue();
  const first = deferred();

  void queue.run(() => first.promise);
  await queue.run(() => Promise.resolve());
  assert.equal(queue.pending(), null, "the settled close was not cleared");

  first.resolve();
  await first.promise;
  assert.equal(queue.pending(), null);
});
