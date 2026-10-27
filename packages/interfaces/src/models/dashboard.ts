// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeId } from "./node";

/** Layout coordinates use the dashboard's canonical twelve-column grid. */
export interface DashboardWidget {
  id: string;
  nodeId: NodeId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardPage {
  id: string;
  name: string;
  widgets: DashboardWidget[];
}

/** Personal dashboard configuration, scoped by user and workspace. */
export interface DashboardWorkspace {
  /** Server-confirmed optimistic concurrency revision. */
  revision: number;
  candidates: NodeId[];
  pages: DashboardPage[];
  activePageId: string | null;
}
