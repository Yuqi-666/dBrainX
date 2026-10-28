// SPDX-License-Identifier: AGPL-3.0-only

import { TRPCError } from "@trpc/server";
import type { DashboardWorkspace } from "@workspace/interfaces";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import {
  DashboardAccessError,
  DashboardConflictError,
  DashboardValidationError,
} from "@workspace/domain";
import { router, protectedProcedure, eventEmitter } from "../server";
import { container } from "../../di/container";

const id = z.string().min(1).max(100);
const widget = z
  .object({
    id,
    nodeId: id,
    x: z.number().int().min(0).max(10),
    y: z.number().int().min(0).max(100000),
    w: z.number().int().min(2).max(12),
    h: z.number().int().min(4).max(1000),
  })
  .strict();
const state = z
  .object({
    revision: z.number().int().min(0),
    candidates: z.array(id).max(2000),
    pages: z
      .array(
        z
          .object({
            id,
            name: z.string().trim().min(1).max(80),
            widgets: z.array(widget).max(2000),
          })
          .strict(),
      )
      .max(100),
    activePageId: id.nullable(),
  })
  .strict();
const scope = z.object({ workspaceId: id }).strict();

function services(token?: string) {
  if (!token)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "A verified session is required",
    });
  return container().dashboardServices(token);
}
async function translate<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dashboard request failed";
    if (error instanceof DashboardAccessError)
      throw new TRPCError({ code: "FORBIDDEN", message });
    if (error instanceof DashboardConflictError)
      throw new TRPCError({ code: "CONFLICT", message });
    if (error instanceof DashboardValidationError)
      throw new TRPCError({ code: "BAD_REQUEST", message });
    throw error;
  }
}

export const dashboardRouter = router({
  get: protectedProcedure.input(scope).query(({ ctx, input }) =>
    translate<DashboardWorkspace>(() =>
      services(ctx.token).query.get({
        workspaceId: input.workspaceId,
        userId: ctx.userId,
      }),
    ),
  ),
  save: protectedProcedure
    .input(scope.extend({ state }))
    .mutation(({ ctx, input }) =>
      translate<DashboardWorkspace>(() =>
        services(ctx.token).command.save({
          ...input,
          userId: ctx.userId,
          sourceId: ctx.sourceId,
        }),
      ),
    ),
  onUpdated: protectedProcedure
    .input(scope)
    .subscription(async ({ ctx, input }) => {
      const query = services(ctx.token).query;
      await translate(() =>
        query.assertAccess({
          workspaceId: input.workspaceId,
          userId: ctx.userId,
        }),
      );
      return observable<{
        workspaceId: string;
        revision: number;
        sourceId?: string;
      }>((emit) => {
        let active = true;
        const unsubscribe = eventEmitter.subscribe((event) => {
          if (
            event.eventType !== "DashboardUpdated" ||
            event.metadata.userId !== ctx.userId ||
            event.aggregateId !== input.workspaceId
          )
            return;
          // Membership may have been revoked since the subscription was opened.
          void query
            .assertAccess({
              workspaceId: input.workspaceId,
              userId: ctx.userId,
            })
            .then(() => {
              if (active)
                emit.next({
                  workspaceId: input.workspaceId,
                  revision: (event.data as { revision: number }).revision,
                  sourceId: event.metadata.sourceId,
                });
            })
            .catch(() => {
              if (active)
                emit.error(
                  new TRPCError({
                    code: "FORBIDDEN",
                    message: "Workspace access denied",
                  }),
                );
            });
        });
        return () => {
          active = false;
          unsubscribe();
        };
      });
    }),
});
