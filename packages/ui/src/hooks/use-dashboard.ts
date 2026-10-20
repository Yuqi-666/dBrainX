// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useEffect } from "react";
import {
  useAuthStore,
  useDashboardStore,
  useWorkspaceStore,
} from "@workspace/store";
import { DashboardService } from "@workspace/services";
import { trpc } from "@workspace/api-client";

/** Server-authoritative personal dashboard state and owner-scoped notifications. */
export function useDashboard() {
  const userId = useAuthStore((state) => state.user?.id);
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const scope =
    userId && workspaceId ? JSON.stringify([userId, workspaceId]) : null;
  const workspace = useDashboardStore((state) =>
    scope ? state.workspaces[scope] : undefined,
  );
  const syncState = useDashboardStore((state) =>
    scope ? state.syncStates[scope] : undefined,
  );
  useEffect(() => {
    if (scope) void DashboardService.sync(scope).catch(() => {});
  }, [scope]);
  const ready = !!scope && !!syncState?.loaded;
  trpc.dashboard.onUpdated.useSubscription(
    { workspaceId: workspaceId ?? "" },
    {
      enabled: ready,
      onStarted: () => {
        if (scope) void DashboardService.sync(scope).catch(() => {});
      },
      onData: (event) => {
        if (
          scope &&
          event.revision >
            (useDashboardStore.getState().workspaces[scope]?.revision ?? 0)
        )
          void DashboardService.sync(scope)
            .then(() => {
              if (
                event.revision >
                (useDashboardStore.getState().workspaces[scope]?.revision ?? 0)
              )
                return DashboardService.sync(scope);
            })
            .catch(() => {});
      },
      onError: () => {
        if (scope)
          useDashboardStore.getState().setSyncState(scope, {
            error: "实时同步已断开，将在重新连接后刷新。",
          });
      },
    },
  );
  return {
    scope,
    workspace,
    ready,
    syncState,
    reload: () => {
      if (scope) void DashboardService.sync(scope).catch(() => {});
    },
  };
}
