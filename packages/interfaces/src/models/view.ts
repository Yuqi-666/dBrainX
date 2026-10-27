// SPDX-License-Identifier: AGPL-3.0-only

import type { FilterConfig } from "./filter";

export type ViewId = string;
export type ViewType = "Force" | "Flow";
export interface VisualConfig {
  backgroundColor?: string;
  /** Sync background and grid together; grid uses the opposite shade range. */
  colorsSyncTheme?: boolean;
  backgroundStyle?: "solid" | "grid" | "dots" | "none";
  gridSpacing?: number;
  gridColor?: string;
  snapToGrid?: boolean;
  showMinimap?: boolean;
  /**
   * Node density of the force layout's soft boundary, in nodes per px².
   * The boundary radius is `r = sqrt(n / nodeDensity)`, where `n` is the
   * node count; a larger value pulls the layout tighter. Absent means
   * "use the renderer's default" — the value is a user preference, not a
   * required input.
   */
  nodeDensity?: number;
}

export interface View {
  id: ViewId;
  name: string;
  viewType: ViewType;
  visualConfig: VisualConfig;
  filterConfig: FilterConfig;
  isPinned?: boolean;
  /**
   * True for the global view the server creates with its workspace. A default
   * view cannot be deleted; other views can.
   */
  isDefault?: boolean;
  workspaceId?: string;
}
