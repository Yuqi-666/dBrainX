// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { Workspace, WorkspaceId } from "@workspace/interfaces";

export interface WorkspaceStore {
  workspaces: Map<WorkspaceId, Workspace>;
  currentWorkspaceId: WorkspaceId | null;

  setWorkspaces: (workspaces: Workspace[]) => void;
  setCurrentWorkspaceId: (id: WorkspaceId | null) => void;
  getWorkspace: (id: WorkspaceId) => Workspace | undefined;
  getCurrentWorkspace: () => Workspace | undefined;
  reset: () => void;
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  devtools(
    (set, get) => ({
      workspaces: new Map(),
      currentWorkspaceId: null,

      setWorkspaces: (workspaces) =>
        set({ workspaces: new Map(workspaces.map((w) => [w.id, w])) }),
      setCurrentWorkspaceId: (id) => set({ currentWorkspaceId: id }),
      getWorkspace: (id) => get().workspaces.get(id),
      getCurrentWorkspace: () => {
        const { currentWorkspaceId, workspaces } = get();
        return currentWorkspaceId ? workspaces.get(currentWorkspaceId) : undefined;
      },
      reset: () =>
        set({ workspaces: new Map(), currentWorkspaceId: null }),
    }),
    { name: "workspace-store" },
  ),
);
