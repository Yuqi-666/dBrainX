// SPDX-License-Identifier: AGPL-3.0-only

import { router, protectedProcedure, eventEmitter } from "../server";
import { observable } from "@trpc/server/observable";
import type { IDomainEvent } from "@workspace/domain/event-bus";
import {
  getPocketBaseClient,
  runWithToken,
  verifyToken,
} from "@workspace/infrastructure";

export const eventRouter = router({
  onEvent: protectedProcedure.subscription(({ ctx }) => {
    return observable<IDomainEvent>((emit) => {
      let active = true;
      let pending = Promise.resolve();
      const handler = (event: IDomainEvent) => {
        if (event.eventType === "DashboardUpdated") return;
        // Serialize authorization to retain event order. Recheck current membership
        // for every notification; removing a user also removes their live access.
        pending = pending.then(async () => {
          if (!active) return;
          try {
            await verifyToken(ctx.token!);
            const data = event.data as {
              workspaceId?: string;
              userId?: string;
            };
            if (
              event.eventType === "WorkspaceDeleted" &&
              event.metadata.userId === ctx.userId
            ) {
              emit.next(event);
              return;
            }
            if (
              event.eventType === "WorkspaceMemberRemoved" &&
              data.userId === ctx.userId
            ) {
              emit.next(event);
              return;
            }
            const workspaceId =
              event.metadata.workspaceId ??
              data.workspaceId ??
              (event.eventType.startsWith("Workspace")
                ? event.aggregateId
                : undefined);
            if (!workspaceId) return; // Never broadcast an event with unknown scope.
            await runWithToken(ctx.token, () =>
              getPocketBaseClient()
                .collection("workspaces")
                .getOne(workspaceId),
            );
            if (active) emit.next(event);
          } catch {
            /* inaccessible workspace or expired session */
          }
        });
      };
      const unsubscribe = eventEmitter.subscribe(handler);
      return () => {
        active = false;
        unsubscribe();
      };
    });
  }),
});
