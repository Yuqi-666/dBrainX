// SPDX-License-Identifier: AGPL-3.0-only

import { runWithToken } from "@workspace/infrastructure";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { IDomainEvent } from "@workspace/domain/event-bus";
import { verifyToken } from "@workspace/infrastructure";

/**
 * tRPC Context - created for each request.
 * `token` is the raw PocketBase JWT used for this connection; it is threaded to
 * `logout` so that procedure can denylist it server-side. Identity is derived
 * only from `userId` (server-verified), never from a client-claimed id.
 */
export interface Context {
  userId: string;
  token?: string;
  connectionId?: string;
  sourceId: string;
}

/**
 * Context creation function.
 *
 * Identity is derived ONLY from a server-verified PocketBase token carried in
 * `connectionParams.token` (WS) or `ctx.userId` (HTTP debug path). The raw
 * `connectionParams.userId` is never trusted as an identity anchor — clients
 * could otherwise claim any userId.
 *
 * Async: verifies the token against PocketBase before building the context.
 */
export async function createContext(
  ctx: {
    req?: unknown;
    socket?: unknown;
    server?: unknown;
    userId?: string;
    connectionId?: string;
    info?: {
      connectionParams?: { token?: string; sourceId?: string; userId?: string };
    };
  }
): Promise<Context> {
  let userId = "";
  let sourceId = "";
  let token: string | undefined;

  const wsCtx = ctx as { info?: { connectionParams?: { token?: string; sourceId?: string } } };
  const connectionParams = wsCtx.info?.connectionParams;
  const wsToken = connectionParams?.token;
  if (wsToken) {
    try {
      userId = await verifyToken(wsToken);
      token = wsToken;
    } catch {
      userId = "";
    }
    sourceId = connectionParams.sourceId ?? "";
  } else if (ctx.userId) {
    userId = ctx.userId;
  }

  return { userId, token, connectionId: ctx.connectionId, sourceId };
}

export type createContextFn = typeof createContext;

/**
 * Initialize tRPC with superjson transformer
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

/**
 * Enforce user authentication middleware
 */
const enforceUserId = t.middleware(async ({ ctx, next }) => {
  if (!ctx.token) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }
  try { ctx.userId = await verifyToken(ctx.token); } catch {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session expired" });
  }
  return runWithToken(ctx.token, () => next({ ctx: { userId: ctx.userId, token: ctx.token } }));
});

/**
 * Protected procedure - requires authentication
 */
export const protectedProcedure = t.procedure.use(enforceUserId);

/**
 * Export tRPC builders
 */
export const router = t.router;
export const procedure = t.procedure;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
export const mergeRouters = t.mergeRouters;

/**
 * Create a typed event emitter for tRPC subscriptions
 * This pattern allows broadcasting events to connected clients
 */
export function createEmitter<T>() {
  const listeners = new Set<(data: T) => void>();

  return {
    subscribe: (listener: (data: T) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (data: T) => {
      listeners.forEach((listener) => listener(data));
    },
  };
}

/**
 * Single unified event emitter for all domain events
 * Replaces 14 individual emitters from the previous architecture
 */
export const eventEmitter = createEmitter<IDomainEvent>();
