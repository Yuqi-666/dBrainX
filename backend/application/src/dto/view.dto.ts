// SPDX-License-Identifier: AGPL-3.0-only

import type { FilterConfig } from "@workspace/interfaces/models/filter";

export interface VisualConfigDTO {
  backgroundColor?: string;
  colorsSyncTheme?: boolean;
  backgroundStyle?: "solid" | "grid" | "dots" | "none";
  gridSpacing?: number;
  gridColor?: string;
  snapToGrid?: boolean;
  showMinimap?: boolean;
  nodeDensity?: number;
}

export interface ViewDTO {
  id: string;
  workspaceId?: string;
  name: string;
  viewType: "Force" | "Flow";
  visualConfig: VisualConfigDTO;
  filterConfig: FilterConfig;
  isPinned: boolean;
  isDefault: boolean;
}