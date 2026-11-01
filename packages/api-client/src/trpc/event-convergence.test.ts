// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The stream's convergence rules, without React or tRPC (plan item 42).
 *
 * The cases are the ones a reconnect produces: a page replayed over events the
 * client already applied, a message that only carries the replay cursor, an
 * echo of this client's own write, and an old message with no identity at all.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createEventConvergence,
  dedupeKeyOf,
  type EventDisposition,
  type StreamEvent,
} from "./event-convergence.ts";

function event(
  eventId: string,
  workspaceSequence: number,
  eventType = "NodeUpdated",
): StreamEvent {
  return {
    eventType,
    aggregateId: "node-1",
    eventId,
    workspaceId: "workspace-1",
    workspaceSequence,
    cursor: `cursor-${workspaceSequence}`,
    metadata: { workspaceId: "workspace-1", userId: "user-alice" },
    data: { id: "node-1" },
  };
}

function collector(): {
  seen: StreamEvent[];
  apply: (event: StreamEvent) => Promise<void>;
} {
  const seen: StreamEvent[] = [];
  return {
    seen,
    apply: async (incoming) => {
      seen.push(incoming);
    },
  };
}

describe("stream convergence", () => {
  it("applies three events in order, once each", async () => {
    const { seen, apply } = collector();
    const convergence = createEventConvergence<StreamEvent>({ apply });

    const dispositions: EventDisposition[] = [];
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      dispositions.push(
        await convergence.accept(event(`event-${sequence}`, sequence)),
      );
    }

    assert.deepEqual(dispositions, ["applied", "applied", "applied"]);
    assert.deepEqual(
      seen.map((applied) => applied.eventId),
      ["event-1", "event-2", "event-3"],
    );
    assert.equal(convergence.appliedCount(), 3);
    assert.equal(convergence.lastCursor(), "cursor-3");
  });

  it("ignores the overlapping page a reconnect replays", async () => {
    const { seen, apply } = collector();
    const convergence = createEventConvergence<StreamEvent>({ apply });
    const first = [event("event-1", 1), event("event-2", 2)];
    for (const incoming of first) await convergence.accept(incoming);

    const dispositions = [
      await convergence.accept(event("event-1", 1)),
      await convergence.accept(event("event-2", 2)),
      await convergence.accept(event("event-3", 3)),
    ];

    assert.deepEqual(dispositions, ["duplicate", "duplicate", "applied"]);
    assert.deepEqual(
      seen.map((applied) => applied.eventId),
      ["event-1", "event-2", "event-3"],
    );
  });

  it("dedupes a message that carries only the replay cursor", async () => {
    const { seen, apply } = collector();
    const convergence = createEventConvergence<StreamEvent>({ apply });
    const legacy: StreamEvent = {
      eventType: "NodeUpdated",
      aggregateId: "node-1",
      cursor: "position-7",
      metadata: { workspaceId: "workspace-1" },
      data: { id: "node-1" },
    };

    assert.equal(dedupeKeyOf(legacy), "cursor:position-7");
    assert.equal(await convergence.accept(legacy), "applied");
    assert.equal(await convergence.accept(legacy), "duplicate");
    assert.equal(seen.length, 1);
  });

  it("records an own operation without applying it, so its replay is a duplicate", async () => {
    const { seen, apply } = collector();
    const convergence = createEventConvergence<StreamEvent>({
      apply,
      isOwnOperation: (incoming) =>
        incoming.metadata?.sourceId === "source-mine",
    });
    const mine: StreamEvent = {
      ...event("event-9", 9),
      metadata: { workspaceId: "workspace-1", sourceId: "source-mine" },
    };

    assert.equal(await convergence.accept(mine), "own");
    assert.equal(await convergence.accept(mine), "duplicate");
    assert.equal(seen.length, 0);
    assert.equal(convergence.hasApplied(mine), true);
  });

  it("applies a message with no identity, because it cannot be deduped", async () => {
    const { seen, apply } = collector();
    const convergence = createEventConvergence<StreamEvent>({ apply });
    const anonymous: StreamEvent = {
      eventType: "NodeUpdated",
      aggregateId: "node-1",
      data: { id: "node-1" },
    };

    assert.equal(dedupeKeyOf(anonymous), undefined);
    await convergence.accept(anonymous);
    await convergence.accept(anonymous);
    assert.equal(seen.length, 2);
  });

  it("forgets the oldest identity once the window is full", async () => {
    const { apply } = collector();
    const convergence = createEventConvergence<StreamEvent>({
      apply,
      appliedLimit: 2,
    });

    for (let sequence = 1; sequence <= 3; sequence += 1) {
      await convergence.accept(event(`event-${sequence}`, sequence));
    }

    assert.equal(convergence.appliedCount(), 2);
    assert.equal(convergence.hasApplied(event("event-1", 1)), false);
    assert.equal(convergence.hasApplied(event("event-3", 3)), true);
  });

  it("records a two-delivery race once, even while the first is still applying", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: StreamEvent[] = [];
    const convergence = createEventConvergence<StreamEvent>({
      apply: async (incoming) => {
        seen.push(incoming);
        await gate;
      },
    });

    const first = convergence.accept(event("event-1", 1));
    const second = convergence.accept(event("event-1", 1));
    release?.();

    assert.deepEqual(await Promise.all([first, second]), [
      "applied",
      "duplicate",
    ]);
    assert.equal(seen.length, 1);
  });
});
