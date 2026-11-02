// SPDX-License-Identifier: AGPL-3.0-only

import type { EngineWorkerHandle, EngineWorkerStatus } from "@workspace/adapter-front";
import type { EngineConfig } from "./config.ts";

/**
 * The two-queue worker loop from §4.5.4 (plan item 65).
 *
 * One cycle asks both queues for work **at the same time**: jobs first would
 * make a single slow scheduled run delay every delivery, and the two queues are
 * independent. Within one tick, `SchedulerService` and `EventDispatchService`
 * bound their own parallelism, so a hung operation never serialises its
 * siblings; this loop only decides when to ask again.
 *
 * An empty cycle backs off exponentially (`idleBackoffMs` doubling to
 * `idleBackoffMaxMs`) instead of polling, and the history of those delays is
 * part of the reported status so the idle claim can be checked rather than
 * trusted. A cycle that claimed anything waits `pollMs`.
 *
 * `stop()` stops claiming first, then waits for the in-flight ticks up to
 * `drainDeadlineMs`. The result says whether the drain finished
 * (`drained: true`) or the deadline expired (`pending` still non-zero), so a
 * shutdown can report the truth instead of a success it did not observe.
 */

export interface EngineWorkerQueue {
  tick(): Promise<{ readonly claimed: number }>;
}

export interface EngineWorkerOptions {
  readonly config: EngineConfig;
  readonly scheduler: EngineWorkerQueue;
  readonly dispatcher: EngineWorkerQueue;
  readonly log?: (line: string) => void;
  /** Injected for tests: the loop never reads a real clock to decide a sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface EngineWorkerDrainResult {
  readonly drained: boolean;
  readonly pending: number;
  readonly waitedMs: number;
}

export class EngineWorker implements EngineWorkerHandle {
  readonly #config: EngineConfig;
  readonly #scheduler: EngineWorkerQueue;
  readonly #dispatcher: EngineWorkerQueue;
  readonly #log: (line: string) => void;
  readonly #sleep: (ms: number) => Promise<void>;

  #enabled: boolean;
  #running = false;
  #stopping = false;
  #loop: Promise<void> | null = null;
  #inFlight: Promise<void> | null = null;
  #wake: (() => void) | null = null;
  #idleTicks = 0;
  #backoffMs: number[] = [];
  #claimedTotal = 0;
  #lastError: string | undefined;

  constructor(options: EngineWorkerOptions) {
    this.#config = options.config;
    this.#scheduler = options.scheduler;
    this.#dispatcher = options.dispatcher;
    this.#log = options.log ?? ((line) => console.log(line));
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#enabled = options.config.enabled;
  }

  start(): void {
    this.#enabled = true;
    if (this.#running) return;
    this.#stopping = false;
    this.#running = true;
    this.#backoffMs = [];
    this.#idleTicks = 0;
    this.#log("[engine] claiming work");
    this.#loop = this.#run();
  }

  async stop(): Promise<EngineWorkerDrainResult> {
    this.#enabled = false;
    this.#stopping = true;
    this.#wakeSleep();
    const started = Date.now();
    const loop = this.#loop;
    if (loop !== null) {
      const deadline = new Promise<void>((resolve) => {
        setTimeout(resolve, this.#config.drainDeadlineMs).unref();
      });
      await Promise.race([loop, deadline]);
    }
    const pending = this.#inFlight === null ? 0 : 1;
    this.#running = false;
    this.#loop = null;
    this.#log(
      pending === 0
        ? `[engine] drained after ${Date.now() - started}ms`
        : `[engine] drain deadline ${this.#config.drainDeadlineMs}ms expired with a tick still running; its leases expire on their own`,
    );
    return { drained: pending === 0, pending, waitedMs: Date.now() - started };
  }

  status(): EngineWorkerStatus {
    return {
      enabled: this.#enabled,
      running: this.#running,
      idleTicks: this.#idleTicks,
      backoffMs: [...this.#backoffMs],
      pending: this.#inFlight === null ? 0 : 1,
    };
  }

  get lastError(): string | undefined {
    return this.#lastError;
  }

  get claimedTotal(): number {
    return this.#claimedTotal;
  }

  /** One cycle, exposed so a test can drive the loop without its timer. */
  async tick(): Promise<{ readonly claimed: number }> {
    const jobTick = this.#scheduler.tick();
    const deliveryTick = this.#dispatcher.tick();
    const [jobs, deliveries] = await Promise.allSettled([jobTick, deliveryTick]);
    let claimed = 0;
    for (const settled of [jobs, deliveries]) {
      if (settled.status === "fulfilled") claimed += settled.value.claimed;
      else this.#lastError = messageOf(settled.reason);
    }
    this.#claimedTotal += claimed;
    return { claimed };
  }

  async #run(): Promise<void> {
    while (!this.#stopping) {
      const inFlight = (async (): Promise<number> => {
        const result = await this.tick();
        return result.claimed;
      })();
      this.#inFlight = inFlight.then(
        () => undefined,
        () => undefined,
      );
      let claimed: number;
      try {
        claimed = await inFlight;
      } finally {
        this.#inFlight = null;
      }

      if (claimed === 0) {
        this.#idleTicks += 1;
        const delay = backoffFor(
          this.#config,
          this.#backoffMs.length + 1,
        );
        this.#backoffMs.push(delay);
        await this.#sleepOrStop(delay);
      } else {
        this.#backoffMs = [];
        await this.#sleepOrStop(this.#config.pollMs);
      }
    }
  }

  #sleepOrStop(ms: number): Promise<void> {
    if (this.#stopping) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this.#wake = null;
        resolve();
      };
      this.#wake = done;
      void this.#sleep(ms).then(done, done);
    });
  }

  #wakeSleep(): void {
    this.#wake?.();
  }
}

/** 1st idle cycle: base, then double, capped. */
export function backoffFor(config: EngineConfig, idleStreak: number): number {
  const exponent = Math.min(Math.max(idleStreak, 1) - 1, 30);
  return Math.min(
    config.idleBackoffMs * 2 ** exponent,
    config.idleBackoffMaxMs,
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
