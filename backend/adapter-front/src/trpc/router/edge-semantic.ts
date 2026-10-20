// SPDX-License-Identifier: AGPL-3.0-only

import { router, protectedProcedure } from "../server";
import { container } from "../../di/container";
import type { EdgeType } from "@workspace/interfaces/models/edge/types";
import { z } from "zod";

const addSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string() as z.ZodType<EdgeType>,
  description: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  workspaceId: z.string().optional(),
});

const updateSchema = z.object({
  id: z.string(),
  updates: z.object({
    name: z.string().optional(),
    category: z.string().optional() as z.ZodType<EdgeType | undefined>,
    description: z.string().optional(),
    color: z.string().optional(),
    icon: z.string().optional(),
  }),
});

const deleteSchema = z.object({
  id: z.string(),
});

export const edgeSemanticRouter = router({
  add: protectedProcedure.input(addSchema).mutation(async ({ ctx, input }) => {
    const result = await container().semanticCommandService.createEdgeSemantic({
      ...input,
      userId: ctx.userId,
      sourceId: ctx.sourceId,
    });
    return result;
  }),
  update: protectedProcedure.input(updateSchema).mutation(async ({ ctx, input }) => {
    const result = await container().semanticCommandService.updateEdgeSemantic({
      id: input.id,
      ...input.updates,
      userId: ctx.userId,
      sourceId: ctx.sourceId,
    });
    return result;
  }),
  delete: protectedProcedure.input(deleteSchema).mutation(async ({ ctx, input }) => {
    await container().semanticCommandService.deleteEdgeSemantic({
      id: input.id,
      userId: ctx.userId,
      sourceId: ctx.sourceId,
    });
    return { success: true, id: input.id };
  }),
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      return container().semanticQueryService.listEdgeSemantics({ workspaceId: input?.workspaceId });
    }),
  listByWorkspace: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ input }) => {
      return container().semanticQueryService.listEdgeSemantics({ workspaceId: input.workspaceId });
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return container().semanticQueryService.getEdgeSemanticById({ id: input.id });
    }),
});
