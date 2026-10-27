// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useEffect, useState } from "react";
import { useDataStore, useWorkspaceStore, useUIStore } from "@workspace/store";
import { WorkspaceService } from "@workspace/services";
import type { ViewId } from "@workspace/interfaces";

/**
 * Loads the workspace once for the session: sync the user's workspaces, open the
 * first one (which loads every workspace-scoped model), then activate its first
 * view.
 *
 * Called by `WorkspaceShell`, which lives in `(main)/layout.tsx` and therefore
 * stays mounted across `/graph` ⇄ `/dashboard` — the load path runs once, not
 * once per switch. It deliberately does **not** decide which surface is visible:
 * that is the route's business (`workspace-shell.tsx` derives it from the
 * pathname), and a hook that runs once must not pin a surface anyway.
 */
export function useWorkspaceInitialization() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const initGraph = async () => {
      setError(null);
      setIsInitialized(false);
      await WorkspaceService.sync();

      const wsStore = useWorkspaceStore.getState();
      const firstWorkspace =
        wsStore.getCurrentWorkspace() ??
        Array.from(wsStore.workspaces.values())[0];

      if (!firstWorkspace) {
        useDataStore.getState().clearDiff();
        setIsInitialized(true);
        return;
      }

      const firstWorkspaceId = firstWorkspace.id;
      await WorkspaceService.open(firstWorkspaceId);

      const views = useDataStore.getState().views;
      const firstViewId = views.keys().next().value as ViewId | undefined;
      if (firstViewId) {
        useUIStore.getState().setCurrentViewId(firstViewId);
      }

      useDataStore.getState().clearDiff();
      setIsInitialized(true);
    };

    void initGraph().catch((error: unknown) => {
      console.error("[WorkspaceShell] initialization failed", error);
      setError("工作空间加载失败，请重试。");
    });
  }, [attempt]);

  return {
    isInitialized,
    error,
    retry: () => setAttempt((value) => value + 1),
  };
}
