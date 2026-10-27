// SPDX-License-Identifier: AGPL-3.0-only

import type { DashboardWorkspace } from "@workspace/interfaces";

export class DashboardValidationError extends Error {}
export class DashboardConflictError extends Error {}
export class DashboardAccessError extends Error {}

/** One person's pages, candidates and layout within one workspace. */
export class Dashboard {
  private constructor(
    readonly workspaceId: string,
    readonly ownerId: string,
    private readonly state: DashboardWorkspace,
    readonly id?: string,
  ) {}

  static create(
    workspaceId: string,
    ownerId: string,
    state: DashboardWorkspace,
    id?: string,
  ): Dashboard {
    if (!workspaceId || !ownerId)
      throw new DashboardValidationError("Dashboard identity is required");
    if (!Number.isSafeInteger(state.revision) || state.revision < 0)
      throw new DashboardValidationError("Invalid dashboard revision");
    if (state.pages.length > 100 || state.candidates.length > 2000)
      throw new DashboardValidationError("Too many dashboard items");
    const pages = new Set<string>();
    const candidates = new Set(state.candidates);
    if (candidates.size !== state.candidates.length)
      throw new DashboardValidationError("Duplicate candidates");
    let count = 0;
    for (const page of state.pages) {
      if (
        !page.id ||
        pages.has(page.id) ||
        !page.name.trim() ||
        page.name.length > 80
      )
        throw new DashboardValidationError("Invalid dashboard page");
      pages.add(page.id);
      const widgets = new Set<string>();
      const nodes = new Set<string>();
      for (const widget of page.widgets) {
        if (
          !widget.id ||
          !widget.nodeId ||
          widgets.has(widget.id) ||
          nodes.has(widget.nodeId)
        )
          throw new DashboardValidationError("Duplicate or invalid widget");
        widgets.add(widget.id);
        nodes.add(widget.nodeId);
        if (
          ![widget.x, widget.y, widget.w, widget.h].every(
            Number.isSafeInteger,
          ) ||
          widget.x < 0 ||
          widget.y < 0 ||
          widget.w < 2 ||
          widget.x + widget.w > 12 ||
          widget.h < 4 ||
          widget.h > 1000 ||
          widget.y > 100000
        )
          throw new DashboardValidationError("Invalid widget geometry");
        count++;
      }
    }
    if (count > 2000) throw new DashboardValidationError("Too many widgets");
    if (state.activePageId !== null && !pages.has(state.activePageId))
      throw new DashboardValidationError("Active page does not exist");
    return new Dashboard(workspaceId, ownerId, structuredClone(state), id);
  }

  toDTO(): DashboardWorkspace {
    return structuredClone(this.state);
  }

  replace(state: DashboardWorkspace): Dashboard {
    if (state.revision !== this.state.revision)
      throw new DashboardConflictError("Dashboard changed on another device");
    return Dashboard.create(this.workspaceId, this.ownerId, {
      ...state,
      revision: this.state.revision + 1,
    });
  }
}
