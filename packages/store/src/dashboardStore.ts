// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { ulid } from "ulid";
import type {
  DashboardWorkspace,
  DashboardWidget,
} from "@workspace/interfaces";

const emptyWorkspace = (): DashboardWorkspace => ({
  revision: 0,
  candidates: [],
  pages: [],
  activePageId: null,
});

/** First available slot, checking only row boundaries where a slot can start. */
function findPosition(widgets: DashboardWidget[], w: number, h: number) {
  const rows = [
    ...new Set([0, ...widgets.map((widget) => widget.y + widget.h)]),
  ].sort((a, b) => a - b);
  for (const y of rows) {
    for (let x = 0; x <= 12 - w; x++) {
      if (
        widgets.every(
          (widget) =>
            x + w <= widget.x ||
            x >= widget.x + widget.w ||
            y + h <= widget.y ||
            y >= widget.y + widget.h,
        )
      )
        return { x, y };
    }
  }
  return {
    x: 0,
    y: Math.max(0, ...widgets.map((widget) => widget.y + widget.h)),
  };
}

export interface DashboardSyncState {
  loaded: boolean;
  loading: boolean;
  pending: number;
  error: string | null;
}

interface DashboardStore {
  workspaces: Record<string, DashboardWorkspace>;
  syncStates: Record<string, DashboardSyncState>;
  setWorkspace: (scope: string, workspace: DashboardWorkspace) => void;
  setSyncState: (scope: string, updates: Partial<DashboardSyncState>) => void;
  toggleCandidate: (scope: string, nodeId: string) => void;
  createPage: (scope: string, name: string) => void;
  selectPage: (scope: string, pageId: string) => void;
  renamePage: (scope: string, pageId: string, name: string) => void;
  deletePage: (scope: string, pageId: string) => void;
  addWidget: (
    scope: string,
    pageId: string,
    nodeId: string,
    position?: { x: number; y: number },
  ) => void;
  arrangePage: (scope: string, pageId: string) => void;
  removeWidget: (scope: string, pageId: string, widgetId: string) => void;
  updateLayout: (
    scope: string,
    pageId: string,
    layout: readonly {
      i: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }[],
  ) => void;
}

/** Optimistic view cache. Persistence belongs to DashboardService and the backend. */
export const useDashboardStore = create<DashboardStore>()((set) => {
  const update = (
    scope: string,
    change: (workspace: DashboardWorkspace) => DashboardWorkspace,
  ) => {
    set((state) => {
      const previous = state.workspaces[scope] ?? emptyWorkspace();
      const next = change(previous);
      return next === previous
        ? state
        : { workspaces: { ...state.workspaces, [scope]: next } };
    });
  };
  return {
    workspaces: {},
    syncStates: {},
    setWorkspace: (scope, workspace) =>
      set((state) => ({
        workspaces: { ...state.workspaces, [scope]: workspace },
      })),
    setSyncState: (scope, updates) =>
      set((state) => ({
        syncStates: {
          ...state.syncStates,
          [scope]: {
            loaded: false,
            loading: false,
            pending: 0,
            error: null,
            ...state.syncStates[scope],
            ...updates,
          },
        },
      })),
    toggleCandidate: (scope, nodeId) =>
      update(scope, (workspace) => ({
        ...workspace,
        candidates: workspace.candidates.includes(nodeId)
          ? workspace.candidates.filter((id) => id !== nodeId)
          : [...workspace.candidates, nodeId],
      })),
    createPage: (scope, name) => {
      if (!name.trim()) return;
      const id = ulid();
      update(scope, (workspace) => ({
        ...workspace,
        activePageId: id,
        pages: [...workspace.pages, { id, name: name.trim(), widgets: [] }],
      }));
    },
    selectPage: (scope, pageId) =>
      update(scope, (workspace) =>
        workspace.pages.some((page) => page.id === pageId)
          ? { ...workspace, activePageId: pageId }
          : workspace,
      ),
    renamePage: (scope, pageId, name) => {
      if (!name.trim()) return;
      update(scope, (workspace) => ({
        ...workspace,
        pages: workspace.pages.map((page) =>
          page.id === pageId ? { ...page, name: name.trim() } : page,
        ),
      }));
    },
    deletePage: (scope, pageId) =>
      update(scope, (workspace) => {
        const pages = workspace.pages.filter((page) => page.id !== pageId);
        return {
          ...workspace,
          pages,
          activePageId:
            workspace.activePageId === pageId
              ? (pages[0]?.id ?? null)
              : workspace.activePageId,
        };
      }),
    addWidget: (scope, pageId, nodeId, position) =>
      update(scope, (workspace) => ({
        ...workspace,
        pages: workspace.pages.map((page) => {
          if (page.id !== pageId || !workspace.candidates.includes(nodeId))
            return page;
          // One live content editor per node per page avoids conflicting editor instances.
          if (page.widgets.some((widget) => widget.nodeId === nodeId))
            return page;
          const slot = position ?? findPosition(page.widgets, 6, 8);
          const widget: DashboardWidget = {
            id: ulid(),
            nodeId,
            x: Math.max(0, Math.min(6, slot.x)),
            y: Math.max(0, slot.y),
            w: 6,
            h: 8,
          };
          return { ...page, widgets: [...page.widgets, widget] };
        }),
      })),
    arrangePage: (scope, pageId) =>
      update(scope, (workspace) => ({
        ...workspace,
        pages: workspace.pages.map((page) => {
          if (page.id !== pageId) return page;
          const widgets: DashboardWidget[] = [];
          for (const widget of page.widgets)
            widgets.push({
              ...widget,
              ...findPosition(widgets, widget.w, widget.h),
            });
          return { ...page, widgets };
        }),
      })),
    removeWidget: (scope, pageId, widgetId) =>
      update(scope, (workspace) => ({
        ...workspace,
        pages: workspace.pages.map((page) =>
          page.id === pageId
            ? {
                ...page,
                widgets: page.widgets.filter(
                  (widget) => widget.id !== widgetId,
                ),
              }
            : page,
        ),
      })),
    updateLayout: (scope, pageId, layout) =>
      update(scope, (workspace) => {
        let changed = false;
        const pages = workspace.pages.map((page) => {
          if (page.id !== pageId) return page;
          const widgets = page.widgets.map((widget) => {
            const item = layout.find((entry) => entry.i === widget.id);
            if (
              !item ||
              [item.x, item.y, item.w, item.h].some(
                (value) => !Number.isFinite(value),
              )
            )
              return widget;
            const w = Math.max(2, Math.min(12, Math.round(item.w)));
            const next = {
              ...widget,
              x: Math.max(0, Math.min(12 - w, Math.round(item.x))),
              y: Math.max(0, Math.round(item.y)),
              w,
              h: Math.max(4, Math.round(item.h)),
            };
            if (
              next.x === widget.x &&
              next.y === widget.y &&
              next.w === widget.w &&
              next.h === widget.h
            )
              return widget;
            changed = true;
            return next;
          });
          return changed ? { ...page, widgets } : page;
        });
        return changed ? { ...workspace, pages } : workspace;
      }),
  };
});
