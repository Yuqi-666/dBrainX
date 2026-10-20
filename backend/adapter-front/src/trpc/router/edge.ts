// SPDX-License-Identifier: AGPL-3.0-only

import { router, protectedProcedure } from "../server";
import { container } from "../../di/container";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { EdgeStateData } from "@workspace/interfaces/models/edge/types";

const edgeStateDataSchema = z
  .object({
    client: z.record(z.any()).optional(),
    server: z.record(z.any()).optional(),
  })
  .optional();

const addSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  direction: z.enum(["forward", "reverse", "bidirectional", "undirected"]),
  semanticId: z.string(),
  stateData: edgeStateDataSchema,
  workspaceId: z.string().optional(),
});

const updateSchema = z.object({
  id: z.string(),
  updates: z.object({
    direction: z.enum(["forward", "reverse", "bidirectional", "undirected"]).optional(),
    semanticId: z.string().optional(),
    stateData: edgeStateDataSchema,
    workspaceId: z.string().optional(),
  }),
});

const deleteSchema = z.object({
  id: z.string(),
});

export const edgeRouter = router({
  add: protectedProcedure.input(addSchema).mutation(async ({ ctx, input }) => {
    try {
      const stateData: EdgeStateData | undefined = input.stateData
        ? { client: input.stateData.client ?? {}, server: input.stateData.server ?? {} }
        : undefined;
      const result = await container().edgeCommandService.createEdge({
        id: input.id,
        from: input.from,
        to: input.to,
        direction: input.direction,
        semanticId: input.semanticId,
        stateData,
        workspaceId: input.workspaceId,
        userId: ctx.userId,
        sourceId: ctx.sourceId,
      });
      return result;
    } catch (error) {
      if (error instanceof Error && (error.message.includes("from === to") || error.message.includes("self-loop"))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Edge cannot connect a node to itself",
        });
      }
      throw error;
    }
  }),

  update: protectedProcedure.input(updateSchema).mutation(async ({ ctx, input }) => {
    const stateData: EdgeStateData | undefined = input.updates.stateData
      ? { client: input.updates.stateData.client ?? {}, server: input.updates.stateData.server ?? {} }
      : undefined;
    const result = await container().edgeCommandService.updateEdge({
      id: input.id,
      direction: input.updates.direction,
      semanticId: input.updates.semanticId,
      stateData,
      workspaceId: input.updates.workspaceId,
      userId: ctx.userId,
      sourceId: ctx.sourceId,
    });
    return result;
  }),

  delete: protectedProcedure.input(deleteSchema).mutation(async ({ ctx, input }) => {
    await container().edgeCommandService.deleteEdge({ id: input.id, userId: ctx.userId, sourceId: ctx.sourceId });
    return { success: true, id: input.id };
  }),

  list: protectedProcedure
    .input(z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      semanticId: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return container().edgeQueryService.list(input);
    }),

  listByWorkspace: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ input }) => {
      return container().edgeQueryService.listByWorkspace(input.workspaceId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return container().edgeQueryService.getById({ id: input.id });
    }),
});
