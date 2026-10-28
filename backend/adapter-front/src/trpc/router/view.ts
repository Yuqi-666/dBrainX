// SPDX-License-Identifier: AGPL-3.0-only

import { router, protectedProcedure } from "../server";
import { container } from "../../di/container";
import { z } from "zod";

const addSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  viewType: z.enum(["Force", "Flow"]),
  filterConfig: z.any().optional(),
  isPinned: z.boolean().optional(),
  workspaceId: z.string().optional(),
});

const updateSchema = z.object({
  id: z.string(),
  updates: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    viewType: z.enum(["Force", "Flow"]).optional(),
    filterConfig: z.any().optional(),
    isPinned: z.boolean().optional(),
    visualConfig: z
      .object({
        backgroundColor: z.string().optional(),
        colorsSyncTheme: z.boolean().optional(),
        backgroundStyle: z.enum(["solid", "grid", "dots", "none"]).optional(),
        gridSpacing: z.number().optional(),
        gridColor: z.string().optional(),
        snapToGrid: z.boolean().optional(),
        showMinimap: z.boolean().optional(),
        nodeDensity: z.number().positive().optional(),
      })
      .optional(),
    workspaceId: z.string().optional(),
  }),
});

const deleteSchema = z.object({
  id: z.string(),
});

export const viewRouter = router({
  add: protectedProcedure.input(addSchema).mutation(async ({ ctx, input }) => {
    const result = await container().viewCommandService.createView({
      id: input.id,
      name: input.name,
      viewType: input.viewType,
      filterConfig: input.filterConfig,
      isPinned: input.isPinned,
      workspaceId: input.workspaceId,
      userId: ctx.userId,
      sourceId: ctx.sourceId,
    });
    return result;
  }),

  update: protectedProcedure.input(updateSchema).mutation(async ({ ctx, input }) => {
    const result = await container().viewCommandService.updateView({
      id: input.id,
      ...input.updates,
      userId: ctx.userId,
      sourceId: ctx.sourceId,
    });
    return result;
  }),

  delete: protectedProcedure.input(deleteSchema).mutation(async ({ ctx, input }) => {
    await container().viewCommandService.deleteView({ id: input.id, userId: ctx.userId, sourceId: ctx.sourceId });
    return { success: true, id: input.id };
  }),

  list: protectedProcedure
    .input(z.object({
      isPinned: z.boolean().optional(),
      viewType: z.enum(["Force", "Flow"]).optional(),
    }))
    .query(async ({ input }) => {
      return container().viewQueryService.list(input);
    }),

  listByWorkspace: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ input }) => {
      return container().viewQueryService.listByWorkspace(input.workspaceId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return container().viewQueryService.getById({ id: input.id });
    }),

  getPinned: protectedProcedure.query(async () => {
    return container().viewQueryService.getPinned();
  }),
});
