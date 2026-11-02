// SPDX-License-Identifier: AGPL-3.0-only

import type { RetentionRunResult } from "@workspace/application";

import type { EngineMaintenanceConfig } from "./config.ts";

/**
 * The host's retention timer (plan item 68).
 *
 * It is deliberately not part of the worker loop: a cleanup that walks a large
 * event log must never delay a claim. The two run on the same process and
 * share nothing but the store, whose batch size bounds each cleanup stage.
 *
 * Two behaviours are the adversarial cases from the plan:
 *
 * - **a slow batch cannot stack.** `runOnce` returns the run already in flight
 *   instead of starting a second one, so a batch slower than the interval
 *   produces a skipped tick, not two concurrent reclaims of the same rows.
 * - **the report is data, not a log line.** The timer logs one JSON line whose
 *   fields are the run's own counters, so an operator reads the same numbers
 *   `engine.cleanup` returns.
 */

export interface EngineMaintenanceService {
  run(): Promise<RetentionRunResult>;
}

export interface EngineMaintenanceOptions {
  readonly service: EngineMaintenanceService;
  readonly config: EngineMaintenanceConfig;
  readonly log?: (line: string) => void;
}

export class EngineMaintenance {
  readonly #service: EngineMaintenanceService;
  readonly #config: EngineMaintenanceConfig;
  readonly #log: (line: string) => void;
  #timer: NodeJS.Timeout | null = null;
  #running: Promise<RetentionRunResult> | null = null;
  #stopped = false;

  constructor(options: EngineMaintenanceOptions) {
    this.#service = options.service;
    this.#config = options.config;
    this.#log = options.log ?? ((line) => console.log(line));
  }

  get running(): boolean {
    return this.#running !== null;
  }

  start(): void {
    if (this.#timer !== null || this.#config.intervalMs <= 0) return;
    this.#stopped = false;
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    const running = this.#running;
    if (running !== null) {
      await running.catch(() => undefined);
    }
  }

  /** The one public trigger: the timer and `engine.cleanup` both call it. */
  runOnce(): Promise<RetentionRunResult> {
    const running = this.#running;
    if (running !== null) return running;
    const run = this.#service.run();
    this.#running = run;
    void run
      .then(
        (result) => this.#log(summaryLine(result)),
        (error: unknown) => {
          this.#log(
            JSON.stringify({
              event: "engine.cleanup",
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        },
      )
      .finally(() => {
        if (this.#running === run) this.#running = null;
      });
    return run;
  }

  #schedule(delayMs: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.runOnce()
        .catch(() => undefined)
        .finally(() => this.#schedule(this.#config.intervalMs));
    }, delayMs);
    this.#timer.unref?.();
  }
}

function summaryLine(result: RetentionRunResult): string {
  return JSON.stringify({
    event: "engine.cleanup",
    ok: result.failures.length === 0,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    retentionMs: result.events.retentionMs,
    cutoff: result.events.cutoff,
    candidates: result.events.candidates,
    deleted: result.events.deleted,
    skipped: result.events.skipped,
    deliveriesDeleted: result.events.deliveriesDeleted,
    truncated: result.events.truncated,
    scopeRowsDeleted: result.automationScopes?.deleted ?? null,
    sandboxesExpired: result.sandbox?.expired ?? null,
    sandboxFilesSoftDeleted: result.sandbox?.filesSoftDeleted ?? null,
    failures: result.failures,
  });
}
