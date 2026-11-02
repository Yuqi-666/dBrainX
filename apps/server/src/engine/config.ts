// SPDX-License-Identifier: AGPL-3.0-only

import { hostname } from "node:os";

import type { AppContainerEngineOptions } from "@workspace/adapter-front";

/**
 * The served engine's knobs (plan item 65), all environment-driven.
 *
 * | Variable | Default | Meaning |
 * | --- | --- | --- |
 * | `DBRAINX_ENGINE_ENABLED` | `1` | starts the worker; the settings switch can turn it off at runtime |
 * | `DBRAINX_ENGINE_WORKER_ID` | `<hostname>:<pid>` | the lease owner every claim and completion carries |
 * | `DBRAINX_ENGINE_POLL_MS` | `500` | pause after a tick that claimed work |
 * | `DBRAINX_ENGINE_IDLE_BACKOFF_MS` | `1000` | first pause after a tick that claimed nothing |
 * | `DBRAINX_ENGINE_IDLE_BACKOFF_MAX_MS` | `30000` | the idle pause doubles up to this bound |
 * | `DBRAINX_ENGINE_DRAIN_MS` | `30000` | how long shutdown waits for in-flight work |
 * | `DBRAINX_ENGINE_CONCURRENCY` | `2` | job firings per tick and workspace buckets per dispatch tick |
 * | `DBRAINX_ENGINE_LEASE_MS` | `30000` | delivery and job lease |
 * | `DBRAINX_ENGINE_CLAIM_LIMIT` | `20` | rows one delivery claim may take |
 * | `DBRAINX_ENGINE_JOB_LIMIT` | `10` | jobs one tick may claim |
 * | `DBRAINX_ENGINE_MAX_ATTEMPTS` | `5` | delivery attempts before the dead letter |
 * | `DBRAINX_ENGINE_CLEANUP_INTERVAL_MS` | `3600000` | pause between retention runs; `0` disables the job |
 * | `DBRAINX_ENGINE_EVENT_RETENTION_MS` | `604800000` | a `done` event older than this is reclaimed |
 * | `DBRAINX_ENGINE_SANDBOX_IDLE_MS` | `604800000` | a ready sandbox unused this long expires |
 * | `DBRAINX_ENGINE_CLEANUP_BATCH` | `100` | rows one cleanup stage may touch per run |
 *
 * A malformed value is a startup failure: an engine silently running with a
 * 1 ms poll or a 0 ms drain deadline is worse than one that refuses to start.
 */

export interface EngineQueueConfig {
  readonly limit: number;
  readonly leaseMs: number;
  readonly concurrency: number;
}

export interface EngineMaintenanceConfig {
  /** `0` turns the timer off; the `engine.cleanup` endpoint still works. */
  readonly intervalMs: number;
  readonly eventRetentionMs: number;
  readonly sandboxIdleMs: number;
  readonly batchSize: number;
}

export interface EngineConfig {
  readonly enabled: boolean;
  readonly owner: string;
  /** Pause after a busy tick. */
  readonly pollMs: number;
  /** First pause after an idle tick; doubles per consecutive idle tick. */
  readonly idleBackoffMs: number;
  /** Upper bound of the idle pause. */
  readonly idleBackoffMaxMs: number;
  /** How long shutdown waits for in-flight runs before it gives up. */
  readonly drainDeadlineMs: number;
  readonly scheduler: EngineQueueConfig;
  readonly dispatch: EngineQueueConfig & { readonly maxAttempts: number };
  readonly maintenance: EngineMaintenanceConfig;
}

export function loadEngineConfig(
  env: NodeJS.ProcessEnv = process.env,
): EngineConfig {
  return {
    enabled: readFlag("DBRAINX_ENGINE_ENABLED", true, env),
    owner:
      readText("DBRAINX_ENGINE_WORKER_ID", env) ??
      `${hostname()}:${process.pid}`,
    pollMs: readInt("DBRAINX_ENGINE_POLL_MS", 500, env, 10),
    idleBackoffMs: readInt("DBRAINX_ENGINE_IDLE_BACKOFF_MS", 1_000, env, 10),
    idleBackoffMaxMs: readInt("DBRAINX_ENGINE_IDLE_BACKOFF_MAX_MS", 30_000, env, 10),
    drainDeadlineMs: readInt("DBRAINX_ENGINE_DRAIN_MS", 30_000, env, 0),
    scheduler: {
      limit: readInt("DBRAINX_ENGINE_JOB_LIMIT", 10, env, 1),
      leaseMs: readInt("DBRAINX_ENGINE_LEASE_MS", 30_000, env, 1),
      concurrency: readInt("DBRAINX_ENGINE_CONCURRENCY", 2, env, 1),
    },
    dispatch: {
      limit: readInt("DBRAINX_ENGINE_CLAIM_LIMIT", 20, env, 1),
      leaseMs: readInt("DBRAINX_ENGINE_LEASE_MS", 30_000, env, 1),
      concurrency: readInt("DBRAINX_ENGINE_CONCURRENCY", 2, env, 1),
      maxAttempts: readInt("DBRAINX_ENGINE_MAX_ATTEMPTS", 5, env, 1),
    },
    maintenance: {
      intervalMs: readInt("DBRAINX_ENGINE_CLEANUP_INTERVAL_MS", 3_600_000, env, 0),
      eventRetentionMs: readInt("DBRAINX_ENGINE_EVENT_RETENTION_MS", 604_800_000, env, 60_000),
      sandboxIdleMs: readInt("DBRAINX_ENGINE_SANDBOX_IDLE_MS", 604_800_000, env, 60_000),
      batchSize: readInt("DBRAINX_ENGINE_CLEANUP_BATCH", 100, env, 1),
    },
  };
}

/**
 * The engine block `apps/server` hands to the container.
 *
 * Every knob is copied here, so a setting printed at startup cannot be one the
 * composition root forgot to pass: `schedulerConcurrency` was declared, printed
 * and never read until this mapping existed (plan item 93).
 */
export function engineRuntimeOptions(
  config: EngineConfig,
): AppContainerEngineOptions {
  return {
    enabled: config.enabled,
    owner: config.owner,
    schedulerLimit: config.scheduler.limit,
    schedulerLeaseMs: config.scheduler.leaseMs,
    schedulerConcurrency: config.scheduler.concurrency,
    dispatchLimit: config.dispatch.limit,
    dispatchLeaseMs: config.dispatch.leaseMs,
    dispatchMaxAttempts: config.dispatch.maxAttempts,
    dispatchConcurrency: config.dispatch.concurrency,
    maintenance: {
      eventRetentionMs: config.maintenance.eventRetentionMs,
      sandboxIdleMs: config.maintenance.sandboxIdleMs,
      batchSize: config.maintenance.batchSize,
    },
  };
}

/** One line the server prints at startup, so the effective policy is visible. */
export function describeEngineConfig(config: EngineConfig): string {
  return (
    `[engine] ${config.enabled ? "enabled" : "disabled"} owner=${config.owner} ` +
    `poll=${config.pollMs}ms idle=${config.idleBackoffMs}..${config.idleBackoffMaxMs}ms ` +
    `drain=${config.drainDeadlineMs}ms ` +
    `jobs=${config.scheduler.limit}/${config.scheduler.concurrency} ` +
    `deliveries=${config.dispatch.limit}/${config.dispatch.concurrency} ` +
    `lease=${config.scheduler.leaseMs}ms attempts=${config.dispatch.maxAttempts} ` +
    `cleanup=${config.maintenance.intervalMs === 0 ? "off" : `${config.maintenance.intervalMs}ms`} ` +
    `retention=${config.maintenance.eventRetentionMs}ms batch=${config.maintenance.batchSize}`
  );
}

function readText(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function readFlag(
  name: string,
  fallback: boolean,
  env: NodeJS.ProcessEnv,
): boolean {
  const value = readText(name, env)?.toLowerCase();
  if (value === undefined) return fallback;
  if (value === "1" || value === "true" || value === "yes" || value === "on") {
    return true;
  }
  if (value === "0" || value === "false" || value === "no" || value === "off") {
    return false;
  }
  throw new RangeError(`${name} must be a boolean (1/0, true/false), got "${value}"`);
}

function readInt(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv,
  min: number,
): number {
  const text = readText(name, env);
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(
      `${name} must be an integer >= ${min}, got "${text}"`,
    );
  }
  return value;
}
