// SPDX-License-Identifier: AGPL-3.0-only

import { router, protectedProcedure } from "../server";
import { z } from "zod";
import { AppContainer } from "../../di/container";

const getContainer = () => AppContainer.getInstance();

const addSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  workspaceId: z.string().optional(),
});

const updateSchema = z.object({
  id: z.string(),
  updates: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    color: z.string().optional(),
    icon: z.string().optional(),
  }),
});

const deleteSchema = z.object({
  id: z.string(),
});

export const nodeSemanticRouter = router({
  add: protectedProcedure.input(addSchema).mutation(async ({ ctx, input }) => {
    const result = await getContainer().semanticCommandService.createNodeSemantic({
      ...input,
      userId: ctx.userId,
      sourceId: ctx.sourceId,
    });
    return result;
  }),
  update: protectedProcedure.input(updateSchema).mutation(async ({ ctx, input }) => {
    const result = await getContainer().semanticCommandService.updateNodeSemantic({
      id: input.id,
      ...input.updates,
      userId: ctx.userId,
      sourceId: ctx.sourceId,
    });
    return result;
  }),
  delete: protectedProcedure.input(deleteSchema).mutation(async ({ ctx, input }) => {
    await getContainer().semanticCommandService.deleteNodeSemantic({
      id: input.id,
      userId: ctx.userId,
      sourceId: ctx.sourceId,
    });
    return { success: true, id: input.id };
  }),
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      return getContainer().semanticQueryService.listNodeSemantics({ workspaceId: input?.workspaceId });
    }),
  listByWorkspace: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ input }) => {
      return getContainer().semanticQueryService.listNodeSemantics({ workspaceId: input.workspaceId });
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return getContainer().semanticQueryService.getNodeSemanticById({ id: input.id });
    }),
});
