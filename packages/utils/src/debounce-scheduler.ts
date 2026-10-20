// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Generic per-key debounce scheduler.
 *
 * Maintains a Map of pending timers keyed by an arbitrary string id. When
 * schedule() is called for a key that already has a pending timer, the
 * previous timer is cleared and only the latest payload is kept. The first
 * payload for a given key is preserved as the "original snapshot" so callers
 * can implement error rollback semantics.
 */

export interface DebouncedTask<P, R> {
  /** Task payload — the most recent value passed to schedule(). */
  payload: P;
  /** Async function executed after the debounce delay. */
  run: (payload: P) => Promise<R>;
  /**
   * Called if the run() promise rejects. Receives the original snapshot
   * (the payload from the FIRST call in the current debounce window) so the
   * caller can roll back local state.
   */
  onError: (error: unknown, originalPayload: P) => void;
  /** Resolves when the scheduled run() resolves. */
  resolve: (value: R | PromiseLike<R>) => void;
  /** Rejects when the scheduled run() rejects. */
  reject: (reason?: unknown) => void;
}

export class DebounceScheduler<P, R = void> {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly originals = new Map<string, P>();
  private readonly tasks = new Map<string, DebouncedTask<P, R>>();

  constructor(private readonly defaultDelayMs: number) {}

  /**
   * Schedule a debounced task.
   *
   * - If a timer already exists for `key`, it is cleared and the new
   *   payload/tasks replace the old ones. The first payload remains as the
   *   "original snapshot" for error rollback.
   * - If `delay` is provided it overrides the scheduler default.
   * - If `options.delay === 0` (or `false` is the signal — see below), the
   *   task runs immediately. Use the dedicated `runImmediate()` helper for
   *   the non-debounced path.
   */
  schedule(
    key: string,
    payload: P,
    run: (payload: P) => Promise<R>,
    onError: (error: unknown, originalPayload: P) => void,
    options?: { delay?: number; signal?: AbortSignal },
  ): Promise<R> {
    if (options?.signal?.aborted) {
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }

    return new Promise<R>((resolve, reject) => {
      // Preserve the very first payload in the current debounce window so
      // onError can roll back to it.
      if (!this.originals.has(key)) {
        this.originals.set(key, payload);
      }

      const existing = this.timers.get(key);
      if (existing) clearTimeout(existing);

      const task: DebouncedTask<P, R> = {
        payload,
        run,
        onError,
        resolve,
        reject,
      };
      this.tasks.set(key, task);

      const delay = options?.delay ?? this.defaultDelayMs;
      const timer = setTimeout(() => {
        const pending = this.flush(key);
        if (pending) {
          pending.catch(() => {
            // Errors are already routed to task.onError / task.reject
            // inside flush(); this catch exists only to keep the timer
            // callback safe.
          });
        }
      }, delay);
      this.timers.set(key, timer);

      if (options?.signal) {
        const onAbort = () => {
          this.cancel(key);
          reject(new DOMException("Aborted", "AbortError"));
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  /**
   * Immediately execute any pending task for `key`. Used for unmount-style
   * flushes and for tests. Returns the in-flight promise if a task was
   * pending, otherwise `null`.
   */
  flush(key: string): Promise<R> | null {
    const task = this.tasks.get(key);
    const timer = this.timers.get(key);
    if (!task || timer === undefined) return null;

    clearTimeout(timer);
    this.timers.delete(key);
    this.tasks.delete(key);

    const originalPayload = this.originals.get(key) as P;
    this.originals.delete(key);

    return task
      .run(task.payload)
      .then((value) => {
        task.resolve(value);
        return value;
      })
      .catch((error) => {
        task.onError(error, originalPayload);
        task.reject(error);
        throw error;
      });
  }

  /** Cancel a pending debounced task without running it. */
  cancel(key: string): void {
    const timer = this.timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    this.originals.delete(key);
    this.tasks.delete(key);
  }

  /** Cancel every pending task. Used on app teardown. */
  cancelAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.originals.clear();
    this.tasks.clear();
  }

  hasPending(key: string): boolean {
    return this.timers.has(key);
  }
}

/**
 * Resolve the debounce delay in milliseconds from the public API.
 *
 * - `undefined` (default) → `0` (do NOT debounce; preserves prior behavior)
 * - `true` → use the scheduler default
 * - `false` → `0` (do NOT debounce)
 * - `number` → use that value
 */
export function resolveDebounceMs(
  option: boolean | number | undefined,
  defaultMs: number,
): number {
  if (option === true) return defaultMs;
  if (typeof option === "number") return option;
  return 0;
}

export function shouldDebounce(
  option: boolean | number | undefined,
): boolean {
  if (option === true) return true;
  if (typeof option === "number" && option > 0) return true;
  return false;
}