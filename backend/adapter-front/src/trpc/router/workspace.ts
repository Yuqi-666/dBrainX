// SPDX-License-Identifier: AGPL-3.0-only

import { router, protectedProcedure } from "../server";
import { container } from "../../di/container";
import type { NodeIcon } from "@workspace/interfaces";
import { z } from "zod";

/**
 * A workspace's picker icon (`NodeIcon`).
 *
 * Only the `emoji` and `icon` kinds are accepted: a workspace has no file of
 * its own to upload an image to. `z.custom` rather than `z.object` for the same
 * reason as the node router — zod strips every key it does not declare, which
 * would silently drop `color` on the way in.
 */
const workspaceIconSchema = z.custom<NodeIcon>((value) => {
  if (typeof value !== "object" || value === null) return false;
  const icon = value as Partial<NodeIcon>;
  return (
    (icon.kind === "emoji" || icon.kind === "icon") &&
    typeof icon.value === "string" &&
    (icon.color === undefined || typeof icon.color === "string")
  );
}, "Must be a workspace icon: { kind: 'emoji' | 'icon', value, color? }");

const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  // `undefined` means "leave the field alone"; `null` clears the stored icon.
  icon: workspaceIconSchema.nullable().optional(),
});

const memberSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  role: z.enum(["owner", "editor", "viewer"]),
});

export const workspaceRouter = router({
  add: protectedProcedure.input(workspaceSchema).mutation(async ({ ctx, input }) => {
    return container().workspaceCommandService.createWorkspace({
      id: input.id,
      name: input.name,
      ownerId: input.ownerId,
      icon: input.icon,
      userId: ctx.userId,
      sourceId: ctx.sourceId,
    });
  }),

  provisionDefault: protectedProcedure.mutation(async ({ ctx }) => {
    return container().workspaceCommandService.provisionDefaultWorkspace(
      ctx.userId,
    );
  }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        updates: z.object({
          name: z.string().optional(),
          icon: workspaceIconSchema.nullable().optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return container().workspaceCommandService.updateWorkspace({
        id: input.id,
        name: input.updates.name,
        icon: input.updates.icon,
        userId: ctx.userId,
        sourceId: ctx.sourceId,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await container().workspaceCommandService.deleteWorkspace({
        id: input.id,
        userId: ctx.userId,
        sourceId: ctx.sourceId,
      });
      return { success: true, id: input.id };
    }),

  list: protectedProcedure.query(async () => {
    return container().workspaceQueryService.list({});
  }),

  listByUser: protectedProcedure
    .input(z.object({ userId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const userId = input.userId ?? ctx.userId;
      return container().workspaceQueryService.listByUser({ userId });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return container().workspaceQueryService.getById({ id: input.id });
    }),

  getMembers: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ input }) => {
      return container().workspaceQueryService.getMembers({ workspaceId: input.workspaceId });
    }),

  addMember: protectedProcedure.input(memberSchema).mutation(async ({ ctx, input }) => {
    return container().workspaceCommandService.addMember({
      id: input.id,
      workspaceId: input.workspaceId,
      userId: input.userId,
      role: input.role,
      actorUserId: ctx.userId,
      sourceId: ctx.sourceId,
    });
  }),

  removeMember: protectedProcedure
    .input(z.object({ id: z.string(), workspaceId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await container().workspaceCommandService.removeMember({
        id: input.id,
        workspaceId: input.workspaceId,
        userId: input.userId,
        actorUserId: ctx.userId,
        sourceId: ctx.sourceId,
      });
      return { success: true };
    }),
});
