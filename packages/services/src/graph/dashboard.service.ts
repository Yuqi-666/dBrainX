// SPDX-License-Identifier: AGPL-3.0-only

import { trpcClient } from "@workspace/api-client";
import { useAuthStore, useDashboardStore } from "@workspace/store";
import type { DashboardWorkspace } from "@workspace/interfaces";

type Store = ReturnType<typeof useDashboardStore.getState>;
type Session = {
  tail: Promise<void>;
  confirmed?: DashboardWorkspace;
  generation: number;
  syncing?: Promise<void>;
};
const sessions = new Map<string, Session>();

function identity(scope: string) {
  const tuple: unknown = JSON.parse(scope);
  if (
    !Array.isArray(tuple) ||
    tuple.length !== 2 ||
    typeof tuple[0] !== "string" ||
    typeof tuple[1] !== "string" ||
    tuple[0] !== useAuthStore.getState().getUserId()
  )
    throw new Error("Dashboard session changed");
  return { userId: tuple[0], workspaceId: tuple[1] };
}
function session(scope: string): Session {
  let value = sessions.get(scope);
  if (!value) {
    value = { tail: Promise.resolve(), generation: 0 };
    sessions.set(scope, value);
  }
  return value;
}
function legacy(scope: string): DashboardWorkspace | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = JSON.parse(
      localStorage.getItem("dbrain-dashboards-v1") ?? "null",
    )?.state?.workspaces?.[scope];
    return value &&
      Array.isArray(value.pages) &&
      Array.isArray(value.candidates)
      ? { ...value, revision: 0 }
      : null;
  } catch {
    return null;
  }
}
function clearLegacy(scope: string): void {
  try {
    const value = JSON.parse(
      localStorage.getItem("dbrain-dashboards-v1") ?? "null",
    );
    if (!value?.state?.workspaces?.[scope]) return;
    delete value.state.workspaces[scope];
    localStorage.setItem("dbrain-dashboards-v1", JSON.stringify(value));
  } catch {
    /* A saved server copy is authoritative even if browser storage is unavailable. */
  }
}

/** Serialize optimistic snapshots per scope. A failed/conflicting save cancels dependent snapshots. */
function change(scope: string, apply: (store: Store) => void): void {
  const { workspaceId } = identity(scope);
  const store = useDashboardStore.getState();
  if (!store.syncStates[scope]?.loaded || store.syncStates[scope]?.loading)
    return;
  const before = store.workspaces[scope];
  apply(store);
  const state = useDashboardStore.getState().workspaces[scope];
  if (!state || state === before) return;
  const current = session(scope);
  const generation = current.generation;
  store.setSyncState(scope, {
    pending: (useDashboardStore.getState().syncStates[scope]?.pending ?? 0) + 1,
    error: null,
  });
  current.tail = current.tail.then(async () => {
    if (generation !== current.generation) return;
    try {
      identity(scope);
      const saved = await trpcClient.dashboard.save.mutate({
        workspaceId,
        state: {
          ...state,
          revision: current.confirmed?.revision ?? state.revision,
        },
      });
      current.confirmed = saved;
      const latest = useDashboardStore.getState();
      // Keep edits queued while this save was in flight; only advance their base revision.
      if (latest.workspaces[scope])
        latest.setWorkspace(scope, {
          ...latest.workspaces[scope]!,
          revision: saved.revision,
        });
      latest.setSyncState(scope, {
        pending: Math.max(0, (latest.syncStates[scope]?.pending ?? 1) - 1),
      });
    } catch (error) {
      current.generation++;
      const latest = useDashboardStore.getState();
      if (current.confirmed) latest.setWorkspace(scope, current.confirmed);
      const code = (error as { data?: { code?: string } })?.data?.code;
      let message = "保存失败，未保存的更改已撤回。请重新加载后重试。";
      if (code === "CONFLICT") {
        message = "其他设备已修改 Dashboard，已加载最新版本，请重新操作。";
        try {
          const remote = await trpcClient.dashboard.get.query({ workspaceId });
          current.confirmed = remote;
          latest.setWorkspace(scope, remote);
        } catch {
          message = "Dashboard 已发生版本冲突，请重新加载后再操作。";
        }
      }
      latest.setSyncState(scope, { pending: 0, error: message });
    }
  });
}

export const DashboardService = {
  async sync(scope: string): Promise<void> {
    const { workspaceId } = identity(scope);
    const current = session(scope);
    if (current.syncing) return current.syncing;
    useDashboardStore
      .getState()
      .setSyncState(scope, { loading: true, error: null });
    current.syncing = (async () => {
      // Subscription/reconnect reads must not overwrite local edits awaiting acknowledgement.
      await current.tail;
      const store = useDashboardStore.getState();
      let importing = false;
      try {
        identity(scope);
        let remote = await trpcClient.dashboard.get.query({ workspaceId });
        const local = remote.revision === 0 ? legacy(scope) : null;
        if (local && (local.pages.length || local.candidates.length)) {
          importing = true;
          remote = await trpcClient.dashboard.save.mutate({
            workspaceId,
            state: local,
          });
        }
        identity(scope);
        current.confirmed = remote;
        store.setWorkspace(scope, remote);
        store.setSyncState(scope, {
          loaded: true,
          loading: false,
          error: null,
        });
        clearLegacy(scope);
      } catch (error) {
        store.setSyncState(scope, {
          loading: false,
          error: importing
            ? "本机旧布局同步失败，原数据仍保留。请重试加载。"
            : "Dashboard 加载失败，请重试。",
        });
        throw error;
      }
    })().finally(() => {
      current.syncing = undefined;
    });
    return current.syncing;
  },
  createPage: (scope: string, name: string) =>
    change(scope, (store) => store.createPage(scope, name)),
  selectPage: (scope: string, pageId: string) =>
    change(scope, (store) => store.selectPage(scope, pageId)),
  renamePage: (scope: string, pageId: string, name: string) =>
    change(scope, (store) => store.renamePage(scope, pageId, name)),
  deletePage: (scope: string, pageId: string) =>
    change(scope, (store) => store.deletePage(scope, pageId)),
  toggleCandidate: (scope: string, nodeId: string) =>
    change(scope, (store) => store.toggleCandidate(scope, nodeId)),
  addWidget: (
    scope: string,
    pageId: string,
    nodeId: string,
    position?: { x: number; y: number },
  ) =>
    change(scope, (store) => store.addWidget(scope, pageId, nodeId, position)),
  removeWidget: (scope: string, pageId: string, widgetId: string) =>
    change(scope, (store) => store.removeWidget(scope, pageId, widgetId)),
  arrangePage: (scope: string, pageId: string) =>
    change(scope, (store) => store.arrangePage(scope, pageId)),
  updateLayout: (
    scope: string,
    pageId: string,
    layout: Parameters<Store["updateLayout"]>[2],
  ) => change(scope, (store) => store.updateLayout(scope, pageId, layout)),
};
