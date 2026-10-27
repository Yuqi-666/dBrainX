import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { Workspace, WorkspaceId } from "@workspace/interfaces";

/**
 * The browser remembers the last workspace this client opened.
 *
 * It is a preference, not data: the workspace list itself is server data and is
 * never persisted. On the next load `useWorkspaceInitialization` prefers the
 * restored id (`getCurrentWorkspace`) and falls back to the first workspace when
 * that id is gone — deleted on another device, or owned by another account that
 * logged in on this browser. So a stale value degrades to the old behaviour
 * instead of opening a workspace that does not exist.
 */
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
    persist(
      (set, get) => ({
        workspaces: new Map(),
        currentWorkspaceId: null,

        setWorkspaces: (workspaces) =>
          set({ workspaces: new Map(workspaces.map((w) => [w.id, w])) }),
        setCurrentWorkspaceId: (id) => set({ currentWorkspaceId: id }),
        getWorkspace: (id) => get().workspaces.get(id),
        getCurrentWorkspace: () => {
          const { currentWorkspaceId, workspaces } = get();
          return currentWorkspaceId
            ? workspaces.get(currentWorkspaceId)
            : undefined;
        },
        reset: () => set({ workspaces: new Map(), currentWorkspaceId: null }),
      }),
      {
        name: "workspace-storage",
        /** Only the open id survives; the map belongs to the server. */
        partialize: (state) => ({
          currentWorkspaceId: state.currentWorkspaceId,
        }),
      },
    ),
    { name: "workspace-store" },
  ),
);
