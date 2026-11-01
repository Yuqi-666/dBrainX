// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The client half of `operation.invoke` (plan item 37, §5.1.9).
 *
 * One transport call and one failure shape. Every graph write goes through the
 * single route, so a caller never builds a whole-record payload and the service
 * layer can apply the canonical snapshot the server reloaded.
 *
 * A failure keeps the stable operation code the route puts first in its
 * message (`VERSION_CONFLICT: …`), so a caller switches on `code` and not on
 * the transport status. `OPERATION_ERROR_CODES` mirrors
 * `backend/application/src/commands/operation/operation-error.ts` and the
 * gateway's codes; the route names them in `TRPC_CODE_BY_OPERATION_CODE`.
 */
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@workspace/adapter-front";

import { trpcClient } from "./client";

/** The body `operation.invoke` accepts, inferred from the router. */
export type OperationInvokeBody =
  inferRouterInputs<AppRouter>["operation"]["invoke"];

/** The executor's `OperationResult`: `output` plus canonical snapshots. */
export type OperationResult =
  inferRouterOutputs<AppRouter>["operation"]["invoke"];

/** The four addressable target kinds. */
export type OperationTarget = OperationInvokeBody["target"];

/** The body `operation.list` accepts, inferred from the router. */
export type OperationCatalogBody =
  inferRouterInputs<AppRouter>["operation"]["list"];

/** One registered operation as `operation.list` reports it. */
export type OperationSummary =
  inferRouterOutputs<AppRouter>["operation"]["list"][number];

/** The one call the service layer makes; replaceable in a test. */
export type OperationInvoker = (
  body: OperationInvokeBody,
) => Promise<OperationResult>;

/**
 * The stable codes `operation.invoke` answers with.
 *
 * Keep this list equal to `OperationErrorCode` on the server; a code that is
 * missing here would reach a caller as `INTERNAL_SERVER_ERROR`.
 */
export const OPERATION_ERROR_CODES = [
  "OPERATION_NOT_FOUND",
  "TARGET_NOT_FOUND",
  "FORBIDDEN",
  "CAPABILITY_DENIED",
  "OUT_OF_SCOPE",
  "TARGET_KIND_UNSUPPORTED",
  "CAPABILITY_POLICY_UNAVAILABLE",
  "SCHEMA_INVALID",
  "VERSION_CONFLICT",
  "OPERATION_TIMEOUT",
  "OPERATION_FAILED",
  "RUN_CONFLICT",
  "AUDIT_FAILED",
] as const;

export type OperationErrorCode = (typeof OPERATION_ERROR_CODES)[number];

/**
 * A named operation code, or the transport-level `INTERNAL_SERVER_ERROR` for a
 * failure that carried no code at all (a dropped socket, for example).
 */
export type OperationFailureCode = OperationErrorCode | "INTERNAL_SERVER_ERROR";

const KNOWN_OPERATION_CODES: ReadonlySet<string> = new Set(
  OPERATION_ERROR_CODES,
);
const CODE_PREFIX = /^([A-Z][A-Z0-9_]*):/;
const CORRELATION_SUFFIX = /\(correlationId: ([^)]+)\)/;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "operation.invoke failed";
}

/** The tRPC `data.code`, when the failure came from a tRPC client. */
function trpcCodeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const data = (error as { data?: { code?: unknown } }).data;
  return typeof data?.code === "string" ? data.code : undefined;
}

/**
 * A refused invocation, with the operation code the server named.
 *
 * The message is the server's client-safe text unchanged (`CODE: detail
 * (correlationId: …)`); `code` is the same code as a typed value.
 */
export class OperationInvokeError extends Error {
  readonly code: OperationFailureCode;
  readonly correlationId?: string;
  readonly trpcCode?: string;

  constructor(
    code: OperationFailureCode,
    message: string,
    options?: {
      readonly cause?: unknown;
      readonly correlationId?: string;
      readonly trpcCode?: string;
    },
  ) {
    super(message);
    this.name = "OperationInvokeError";
    this.code = code;
    if (options?.correlationId !== undefined) {
      this.correlationId = options.correlationId;
    }
    if (options?.trpcCode !== undefined) {
      this.trpcCode = options.trpcCode;
    }
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** The named code of a failure, or `undefined` when it carries none. */
export function operationErrorCodeOf(
  error: unknown,
): OperationErrorCode | undefined {
  if (error instanceof OperationInvokeError) {
    return error.code === "INTERNAL_SERVER_ERROR" ? undefined : error.code;
  }
  const match = CODE_PREFIX.exec(messageOf(error));
  if (match === null) return undefined;
  const code = match[1];
  if (code === undefined) return undefined;
  return KNOWN_OPERATION_CODES.has(code)
    ? (code as OperationErrorCode)
    : undefined;
}

/**
 * Normalizes any failure to `OperationInvokeError`.
 *
 * A named code is read from the message prefix, exactly where the route writes
 * it. An unnamed failure stays `INTERNAL_SERVER_ERROR` and keeps the original
 * error on `cause`, so a transport fault is never disguised as VERSION_CONFLICT.
 */
export function asOperationInvokeError(error: unknown): OperationInvokeError {
  if (error instanceof OperationInvokeError) return error;
  const message = messageOf(error);
  const correlationId = CORRELATION_SUFFIX.exec(message)?.[1];
  const trpcCode = trpcCodeOf(error);
  return new OperationInvokeError(
    operationErrorCodeOf(error) ?? "INTERNAL_SERVER_ERROR",
    message,
    {
      cause: error,
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(trpcCode === undefined ? {} : { trpcCode }),
    },
  );
}

/** One `operation.invoke`; the failure is always an `OperationInvokeError`. */
export async function invokeOperation(
  body: OperationInvokeBody,
): Promise<OperationResult> {
  try {
    return await trpcClient.operation.invoke.mutate(body);
  } catch (error) {
    throw asOperationInvokeError(error);
  }
}
